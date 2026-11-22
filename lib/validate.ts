// The validation engine. Every number the dashboard prints as evidence is
// computed here, from the snapshot, by the entry's own run — nothing is
// carried in. The battery, in the order the dashboard presents it:
//
//   (a) a candidate tournament: every learner form in lib/model.ts is
//       scored by leave-one-out on the declared fit universe AND on all
//       fit-eligible anchors, and by repeated paired cross-validation
//       against the category-median baseline. A learner is ADMITTED only
//       by winning >= 60% of paired folds with a better pooled median.
//       The production model is then CHOSEN by a printed rule, not by
//       hand: among admitted candidates whose fit-universe LOO clears
//       the declared 2.30x gate, the one with the best all-eligible LOO
//       prices the board. Losers stay printed with their numbers.
//   (b) per-term evidence: each of the five value terms is dropped from
//       the chosen form in turn and the model is re-tested held-out
//       twice — leave-one-out and paired folds against the full form.
//       A term is KEPT only if the full form beats its removal in
//       >= 60% of paired folds with a better pooled median.
//   (c) end-to-end implied grading: the board's actual product — value
//       x odds — is graded held-out on the traded anchors: leave-one-out
//       ratio times the odds model's out-of-fold probability for the
//       same anchor, against its real cap. Ratio-only grading (the
//       previous build) never tested the number that is ranked.
//   (d) temporal tests: walk-forward by listed_at, five origins with
//       overlapping out-of-sample windows (59 pairs), plus a single
//       70/30 time-split printed as a stress line; the implied product
//       is walk-forward graded the same way.
//   (e) repeated split-conformal bands at two levels: fit / calibrate /
//       test thirds, 24 repeats. The board prints the inner P25-P75
//       band; the wider 80% band's MEASURED coverage is printed beside
//       its claim, and farm verdicts still net at the 80% band's low
//       end. Both bands' measured coverages are printed.
//   (f) the 8 worst leave-one-out misses, unedited;
//   (g) a 200-refit bootstrap giving every board row a rank range.

import { ALL_TERMS, TERM_LABELS, candidateFits, med, medFold, quantile } from './model.ts';
import type { Candidate, FeatureCtx, FitFn, Protocol, Term, ValueModel } from './model.ts';

export interface CandidateRow {
  name: string;
  looFitU: number;
  looAll: number;
  winRate: number | null;
  pooledCand: number | null;
  pooledBase: number | null;
  verdict: string;
}

export interface TermRow {
  term: Term;
  label: string;
  looFitUDropped: number;
  looAllDropped: number;
  winRate: number | null;
  pooledFull: number | null;
  pooledDropped: number | null;
  verdict: string;
}

export interface Miss { slug: string; name: string; category: string | null; pred: number; actual: number; fold: number }

export interface Evidence {
  fitUniverseSize: number;
  fitEligibleSize: number;
  looFitU: number;
  looAll: number;
  within2FitU: number;
  within2All: number;
  impliedLooFitU: number;
  impliedLooAll: number;
  impliedWithin2FitU: number;
  impliedWalkForward: number;
  walkForward: number;
  walkForwardPairs: number;
  walkForwardR4Geometry: number;
  walkForwardR4Pairs: number;
  timeSplit: number;
  candidates: CandidateRow[];
  chosenName: string;
  selectionRule: string;
  terms: TermRow[];
  misses: Miss[];
  conformal: {
    nominal: number; measuredCoverage: number; halfWidth: number; level: number; repeats: number;
    innerNominal: number; innerMeasuredCoverage: number; innerHalfWidth: number;
  };
  bootstrapMedianRankWidth: number;
}

export const SELECTION_RULE =
  'admitted candidates (paired-fold wins >= 60% vs the category baseline, pooled median better) whose fit-universe LOO clears 2.30x compete on all-eligible LOO; the best all-eligible LOO prices the board';

function looPairs(rows: Protocol[], fit: FitFn): [number, number][] {
  const pairs: [number, number][] = [];
  for (let i = 0; i < rows.length; i++) {
    const m = fit(rows.filter((_, j) => j !== i));
    pairs.push([m.ratio(rows[i]!) * rows[i]!.tvl_usd, rows[i]!.mcap_usd as number]);
  }
  return pairs;
}

function seeded(seed: number) { let s = seed; return () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff); }

function pairedCV(rows: Protocol[], fit: FitFn, baseFit: FitFn) {
  const rnd = seeded(7);
  const wins: number[] = [], cf: number[] = [], bf: number[] = [];
  const FOLDS = 5, REPS = 6;
  for (let r = 0; r < REPS; r++) {
    const idx = rows.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
    for (let f = 0; f < FOLDS; f++) {
      const test = idx.filter((_, k) => k % FOLDS === f).map((i) => rows[i]!);
      const train = idx.filter((_, k) => k % FOLDS !== f).map((i) => rows[i]!);
      const c = medFold(test.map((p) => [fit(train).ratio(p) * p.tvl_usd, p.mcap_usd as number] as [number, number]));
      const b = medFold(test.map((p) => [baseFit(train).ratio(p) * p.tvl_usd, p.mcap_usd as number] as [number, number]));
      cf.push(c); bf.push(b); wins.push(c < b ? 1 : 0);
    }
  }
  return { winRate: wins.reduce((a, b) => a + b, 0) / wins.length, cand: med(cf), base: med(bf) };
}

/**
 * Walk-forward by listed_at: origins across the dated anchor list, each
 * tested on the following window, pairs pooled. Headline geometry: five
 * origins, 20% windows (59 pairs — the expanded temporal test).
 */
function walkForwardPairs(rows: Protocol[], fit: FitFn, origins: number[], window: number): { pairs: [number, number][]; slugs: string[] } {
  const dated = rows.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const pairs: [number, number][] = [];
  const slugs: string[] = [];
  for (const q of origins) {
    const cut = Math.floor(dated.length * q);
    const next = Math.floor(dated.length * (q + window));
    const m = fit(dated.slice(0, cut));
    for (const p of dated.slice(cut, next)) { pairs.push([m.ratio(p) * p.tvl_usd, p.mcap_usd as number]); slugs.push(p.slug); }
  }
  return { pairs, slugs };
}

/**
 * The previous build's walk-forward geometry — three origins at
 * 50/62.5/75% of the dated list, 12.5% windows — is the same function
 * with its parameters, run alongside the headline test so the standing
 * walk-forward gate compares like with like. Both numbers are reported;
 * the expanded test stays the headline.
 */

function timeSplitPairs(rows: Protocol[], fit: FitFn): [number, number][] {
  const dated = rows.filter((p) => p.listed_at).sort((a, b) => (a.listed_at as string).localeCompare(b.listed_at as string));
  const cut = Math.floor(dated.length * 0.7);
  const m = fit(dated.slice(0, cut));
  return dated.slice(cut).map((p) => [m.ratio(p) * p.tvl_usd, p.mcap_usd as number] as [number, number]);
}

/**
 * Repeated split-conformal on the fit universe, at two levels from the same
 * calibration residuals: the production 80% band (its level shifted only if
 * measured coverage misses nominal by more than 10 points, as before) and
 * the inner 50% band the board prints. Both coverages are MEASURED on the
 * held-out thirds.
 */
function conformal(fitU: Protocol[], ctx: FeatureCtx, fit: FitFn) {
  const rnd = seeded(23);
  const NOMINAL = 0.8;
  const INNER = 0.5;
  const REPEATS = 24;
  const calResid: number[] = [];
  let covered = 0, coveredInner = 0, total = 0;
  for (let r = 0; r < REPEATS; r++) {
    const idx = fitU.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [idx[i], idx[j]] = [idx[j]!, idx[i]!]; }
    const third = Math.floor(idx.length / 3);
    const fitRows = idx.slice(0, third).map((i) => fitU[i]!);
    const calRows = idx.slice(third, 2 * third).map((i) => fitU[i]!);
    const testRows = idx.slice(2 * third).map((i) => fitU[i]!);
    const m = fit(fitRows);
    const res = calRows.map((p) => Math.abs(Math.log((m.ratio(p) * p.tvl_usd) / (p.mcap_usd as number))));
    const q = quantile(res, NOMINAL);
    const qInner = quantile(res, INNER);
    for (const v of res) calResid.push(v);
    for (const p of testRows) {
      const err = Math.abs(Math.log((m.ratio(p) * p.tvl_usd) / (p.mcap_usd as number)));
      total++;
      if (err <= q) covered++;
      if (err <= qInner) coveredInner++;
    }
  }
  const measured = covered / total;
  let level = NOMINAL;
  if (Math.abs(measured - NOMINAL) > 0.1) level = Math.min(0.97, Math.max(0.5, NOMINAL + (NOMINAL - measured)));
  return {
    nominal: NOMINAL,
    measuredCoverage: measured,
    halfWidth: quantile(calResid, level),
    level,
    repeats: REPEATS,
    innerNominal: INNER,
    innerMeasuredCoverage: coveredInner / total,
    innerHalfWidth: quantile(calResid, INNER),
  };
}

/** Bootstrap rank ranges for board rows: 200 refits of the chosen model on resamples of the fit universe. */
export function bootstrapRankRanges(fitU: Protocol[], fit: FitFn, rows: Protocol[], baseImplied: Map<string, number>): { ranges: Map<string, [number, number]>; medianWidth: number } {
  const rnd = seeded(41);
  const REPS = 200;
  const rankSamples = new Map<string, number[]>(rows.map((p) => [p.slug, []]));
  for (let r = 0; r < REPS; r++) {
    const sample = Array.from({ length: fitU.length }, () => fitU[Math.floor(rnd() * fitU.length)]!);
    const m = fit(sample);
    const scored = rows.map((p) => [p.slug, m.ratio(p) * p.tvl_usd * (baseImplied.get(p.slug) ?? 1)] as [string, number]);
    // baseImplied stores the row's odds (value-independent), so the product re-ranks by value x odds per refit.
    scored.sort((a, b) => b[1] - a[1]);
    scored.forEach(([slug], i) => rankSamples.get(slug)!.push(i + 1));
  }
  const ranges = new Map<string, [number, number]>();
  const widths: number[] = [];
  for (const [slug, samples] of rankSamples) {
    const lo = quantile(samples, 0.1), hi = quantile(samples, 0.9);
    ranges.set(slug, [lo, hi]);
    widths.push(hi - lo);
  }
  return { ranges, medianWidth: med(widths) };
}

export function runValidation(fitU: Protocol[], allEligible: Protocol[], ctx: FeatureCtx, oddsOof: Map<string, number>): { evidence: Evidence; chosenFit: FitFn } {
  const candidates = candidateFits(ctx);
  const baseline = candidates[1]!;
  const looByName = new Map<string, { fitU: [number, number][]; all: [number, number][] }>();
  const candRows: CandidateRow[] = candidates.map((c) => {
    const looF = looPairs(fitU, c.fit);
    const looA = looPairs(allEligible, c.fit);
    looByName.set(c.name, { fitU: looF, all: looA });
    if (c.name === baseline.name) return { name: c.name, looFitU: medFold(looF), looAll: medFold(looA), winRate: null, pooledCand: null, pooledBase: null, verdict: 'baseline' };
    const cv = pairedCV(fitU, c.fit, baseline.fit);
    const admitted = cv.winRate >= 0.6 && cv.cand < cv.base;
    return { name: c.name, looFitU: medFold(looF), looAll: medFold(looA), winRate: cv.winRate, pooledCand: cv.cand, pooledBase: cv.base, verdict: admitted ? 'ADMITTED' : 'rejected' };
  });

  // The printed selection rule: admitted + fit-universe LOO gate, then best all-eligible LOO.
  const GATE = 2.3;
  const eligibleSel = candRows
    .map((row, i) => ({ row, cand: candidates[i]! }))
    .filter(({ row }) => row.verdict === 'ADMITTED' && row.looFitU <= GATE);
  eligibleSel.sort((a, b) => (a.row.looAll - b.row.looAll) || (a.row.looFitU - b.row.looFitU));
  const chosenEntry = eligibleSel[0];
  let chosen: Candidate;
  if (chosenEntry) {
    chosen = chosenEntry.cand;
    candRows[candidates.indexOf(chosen)]!.verdict = 'CHOSEN';
  } else {
    // No admitted candidate clears the gate: fall back to the previous
    // build's ensemble and say so in the printed table.
    chosen = candidates.find((c) => c.name.startsWith('ensemble of both'))!;
    candRows[candidates.indexOf(chosen)]!.verdict = 'CHOSEN (fallback: no admitted candidate cleared the 2.30x gate)';
  }
  const chosenFit = chosen.fit;
  const looChosenFitU = looByName.get(chosen.name)!.fitU;
  const looChosenAll = looByName.get(chosen.name)!.all;

  // Per-term evidence: drop one term from the chosen form, retest held-out twice.
  const termRows: TermRow[] = ALL_TERMS.map((term) => {
    if (!chosen.dropTerm) return { term, label: TERM_LABELS[term], looFitUDropped: 0, looAllDropped: 0, winRate: null, pooledFull: null, pooledDropped: null, verdict: 'not testable on this form' };
    const dropped = chosen.dropTerm(term);
    const cv = pairedCV(fitU, chosenFit, dropped);
    // Three-way verdict, mechanical: KEPT when the full form wins >= 60% of
    // paired folds with a better pooled median; NOT KEPT when its pooled
    // median is no better without the term; SPLIT when the pooled median
    // improves with the term but the fold wins fall short — the disagreement
    // is printed, not smoothed over.
    const verdict = cv.cand >= cv.base ? 'not kept' : cv.winRate >= 0.6 ? 'KEPT' : 'SPLIT';
    return {
      term,
      label: TERM_LABELS[term],
      looFitUDropped: medFold(looPairs(fitU, dropped)),
      looAllDropped: medFold(looPairs(allEligible, dropped)),
      winRate: cv.winRate,
      pooledFull: cv.cand,
      pooledDropped: cv.base,
      verdict,
    };
  });

  const misses: Miss[] = allEligible
    .map((p, i) => ({ slug: p.slug, name: p.name, category: p.category, pred: looChosenAll[i]![0], actual: looChosenAll[i]![1], fold: Math.exp(Math.abs(Math.log(looChosenAll[i]![0] / looChosenAll[i]![1]))) }))
    .sort((a, b) => b.fold - a.fold)
    .slice(0, 8);

  // End-to-end implied grading: LOO value x out-of-fold odds vs the real cap.
  const impliedOf = (pairs: [number, number][], rows: Protocol[]): [number, number][] =>
    pairs.map(([pred, act], i) => [pred * (oddsOof.get(rows[i]!.slug) ?? 1), act]);
  const impliedFitU = impliedOf(looChosenFitU, fitU);
  const impliedAll = impliedOf(looChosenAll, allEligible);

  const wf = walkForwardPairs(fitU, chosenFit, [0.3, 0.4, 0.5, 0.6, 0.7], 0.2);
  const wfR4 = walkForwardPairs(fitU, chosenFit, [0.5, 0.625, 0.75], 0.125);
  const impliedWf: [number, number][] = wf.pairs.map(([pred, act], i) => [pred * (oddsOof.get(wf.slugs[i]!) ?? 1), act]);
  const conf = conformal(fitU, ctx, chosenFit);
  const within2 = (pairs: [number, number][]) => pairs.filter(([p, a]) => Math.exp(Math.abs(Math.log(p / a))) <= 2).length / pairs.length;

  return {
    evidence: {
      fitUniverseSize: fitU.length,
      fitEligibleSize: allEligible.length,
      looFitU: medFold(looChosenFitU),
      looAll: medFold(looChosenAll),
      within2FitU: within2(looChosenFitU),
      within2All: within2(looChosenAll),
      impliedLooFitU: medFold(impliedFitU),
      impliedLooAll: medFold(impliedAll),
      impliedWithin2FitU: within2(impliedFitU),
      impliedWalkForward: medFold(impliedWf),
      walkForward: medFold(wf.pairs),
      walkForwardPairs: wf.pairs.length,
      walkForwardR4Geometry: medFold(wfR4.pairs),
      walkForwardR4Pairs: wfR4.pairs.length,
      timeSplit: medFold(timeSplitPairs(fitU, chosenFit)),
      candidates: candRows,
      chosenName: chosen.name,
      selectionRule: SELECTION_RULE,
      terms: termRows,
      misses,
      conformal: conf,
      bootstrapMedianRankWidth: 0, // filled by caller after board assembly
    },
    chosenFit,
  };
}
