// Token launch radar — challenger entry (token-radar-01), fifth build.
//
// Reads the sealed snapshot, fits the launch-odds model and the value
// model, validates both held-out (lib/validate.ts), prices every pre-token
// protocol, and writes the ranked board, the dashboard data, and the
// dossier the judge reads. The value model is chosen by the printed
// tournament rule in lib/validate.ts, not by hand; no protocol is
// special-cased: the same functions price every row. The board prints the
// inner P25-P75 band; farm verdicts still net at the calibrated 80%
// band's low end, exactly as the previous build's farm book did.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accounting, featureCtx, fitEligible, fitUniverse, isPreToken, parseSnapshot, quantile, rankExclusion, winsorise,
} from './lib/model.ts';
import type { Accounting, Protocol } from './lib/model.ts';
import { fitOdds } from './lib/odds.ts';
import { buildFarm, CAPTURE_SHARE } from './lib/farm.ts';
import { bootstrapRankRanges, runValidation } from './lib/validate.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const eq = process.argv.find((a) => a.startsWith(`--${name}=`));
  return eq === undefined ? fallback : eq.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar: no snapshot at ${inputFile}\n`);
  process.exit(2);
}
const out = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const asOfMs = new Date(snapshot.as_of + 'T00:00:00Z').getTime();

// --- fit odds first: validation grades the full price with its OOF ----------
const eligible = fitEligible(snapshot);
const fitU = fitUniverse(snapshot);
const ctx = featureCtx(eligible, snapshot.as_of);

const allChg = snapshot.protocols.map((p) => p.change_7d).filter((x): x is number => x !== null);
const oddsWinsor = (x: number | null) => (x === null ? 0 : Math.min(quantile(allChg, 0.95), Math.max(quantile(allChg, 0.05), x)));
const odds = fitOdds(snapshot.protocols, oddsWinsor, asOfMs);

// --- fit + validate ---------------------------------------------------------
const { evidence, chosenFit } = runValidation(fitU, eligible, ctx, odds.oof);
const valueModel = chosenFit(fitU);
const q = evidence.conformal.halfWidth;
const qInner = evidence.conformal.innerHalfWidth;

// --- price every pre-token protocol ---------------------------------------
interface Priced {
  p: Protocol;
  segment: 'watchlist' | 'off-list' | 'below-floor';
  ratio: number;
  valueIf: number;
  oddsPct: number;
  implied: number;
  low: number;
  high: number;
  low25: number;
  high25: number;
}
const wl = new Set(snapshot.watchlist);
const pre = snapshot.protocols.filter(isPreToken);
function price(p: Protocol): Priced {
  const ratio = valueModel.ratio(p);
  const valueIf = ratio * p.tvl_usd;
  const o = odds.predict(p);
  const segment = wl.has(p.slug) ? 'watchlist' : p.tvl_usd >= snapshot.floor_usd ? 'off-list' : 'below-floor';
  return {
    p, segment, ratio, valueIf, oddsPct: o * 100,
    implied: valueIf * o,
    low: valueIf * Math.exp(-q) * o,
    high: valueIf * Math.exp(q) * o,
    low25: valueIf * Math.exp(-qInner) * o,
    high25: valueIf * Math.exp(qInner) * o,
  };
}
// The board ranks the COMPLETE eligible universe: every pre-token protocol
// the snapshot does not itself mark as a product of another token (see
// rankExclusion in lib/model.ts). No cut is taken — the count is what the
// eligibility rule leaves, and the excluded are counted by reason.
const pricedAll = pre.filter((p) => rankExclusion(p) === null).map(price);
const byImplied = (a: Priced, b: Priced) => b.implied - a.implied;
const boardPriced: Priced[] = [...pricedAll].sort(byImplied);

// --- bootstrap rank ranges -------------------------------------------------
const oddsMap = new Map(boardPriced.map((r) => [r.p.slug, r.oddsPct / 100]));
const boot = bootstrapRankRanges(fitU, chosenFit, boardPriced.map((r) => r.p), oddsMap);
evidence.bootstrapMedianRankWidth = boot.medianWidth;

// --- traded company: the traded anchors each row keeps -----------------------
// For the detail view: the fit-eligible traded anchors in the row's own
// category, nearest in log-TVL, with their real caps and the caps the
// chosen model itself implies for them (ratio from the same production
// model). Where fewer than three same-category anchors trade, the nearest
// traded anchors by size fill the table, marked as such — never silently.
function tradedCompany(p: Protocol) {
  const bySize = (a: Protocol, b: Protocol) =>
    Math.abs(Math.log(a.tvl_usd / p.tvl_usd)) - Math.abs(Math.log(b.tvl_usd / p.tvl_usd));
  const row = (a: Protocol, kin: string) => ({
    name: a.name,
    slug: a.slug,
    kin,
    tvl_usd: Math.round(a.tvl_usd),
    mcap_usd: Math.round(a.mcap_usd as number),
    model_cap_usd: money(valueModel.ratio(a) * a.tvl_usd),
  });
  const picked = eligible
    .filter((a) => a.category === p.category && a.slug !== p.slug)
    .sort(bySize)
    .slice(0, 5)
    .map((a) => row(a, 'category'));
  if (picked.length < 3) {
    const seen = new Set(picked.map((x) => x.slug));
    for (const a of [...eligible].sort(bySize)) {
      if (picked.length >= 5) break;
      if (a.slug === p.slug || seen.has(a.slug)) continue;
      picked.push(row(a, 'overall'));
      seen.add(a.slug);
    }
  }
  return picked;
}

// --- board rows ------------------------------------------------------------
const money = (x: number) => Math.max(1, Math.round(x));
const rows = boardPriced.map((r, i) => {
  const farm = buildFarm(r.p, r.low, winsorise(ctx, r.p.change_7d));
  return {
    slug: r.p.slug,
    name: r.p.name,
    rank: i + 1,
    implied_value_usd: money(r.implied),
    farm_steps: farm.steps,
    category: r.p.category,
    chains: r.p.chains,
    tvl_usd: r.p.tvl_usd,
    change_7d: r.p.change_7d,
    segment: r.segment,
    value_if_launches_usd: money(r.valueIf),
    launch_odds_pct: Math.round(r.oddsPct * 10) / 10,
    band_low_usd: money(r.low),
    band_high_usd: money(r.high),
    band25_low_usd: money(r.low25),
    band25_high_usd: money(r.high25),
    verdict: farm.verdict,
    farm_cost_usd: farm.cost_usd,
    farm_days: farm.days,
    capture_usd: farm.capture_usd,
    net_usd: farm.net_usd,
    rank_range: boot.ranges.get(r.p.slug) ?? [i + 1, i + 1],
    peers: tradedCompany(r.p),
  };
});

// --- gate self-check --------------------------------------------------------
const slugs = new Set(rows.map((r) => r.slug));
if (rows.length < 100 || rows.length > 4000) throw new Error(`board rows ${rows.length} out of range`);
for (const slug of snapshot.watchlist) if (!slugs.has(slug)) throw new Error(`watchlist slug missing from board: ${slug}`);
for (const r of rows) {
  if (!(r.implied_value_usd > 0)) throw new Error(`non-positive implied for ${r.slug}`);
  if (r.farm_steps.length < 3 || r.farm_steps.length > 12) throw new Error(`farm_steps count for ${r.slug}`);
  for (const s of r.farm_steps) { const t = s.trim(); if (t.length < 20 || t.length > 600) throw new Error(`farm step length ${t.length} for ${r.slug}`); }
}

// --- outputs -----------------------------------------------------------------
const acct: Accounting = accounting(snapshot, rows.length);
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'board.json'), `${JSON.stringify({ rows })}\n`);

const data = {
  meta: {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    accounting: acct,
    winsor_band: [Math.round(ctx.winsorLo * 10) / 10, Math.round(ctx.winsorHi * 10) / 10],
    evidence: {
      loo_fit_universe: evidence.looFitU,
      loo_all_eligible: evidence.looAll,
      within2_fit_universe: evidence.within2FitU,
      within2_all: evidence.within2All,
      implied_loo_fit_universe: evidence.impliedLooFitU,
      implied_loo_all_eligible: evidence.impliedLooAll,
      implied_within2_fit_universe: evidence.impliedWithin2FitU,
      implied_walk_forward: evidence.impliedWalkForward,
      walk_forward: evidence.walkForward,
      walk_forward_pairs: evidence.walkForwardPairs,
      walk_forward_r4_geometry: evidence.walkForwardR4Geometry,
      walk_forward_r4_pairs: evidence.walkForwardR4Pairs,
      time_split: evidence.timeSplit,
      candidates: evidence.candidates,
      chosen_model: evidence.chosenName,
      selection_rule: evidence.selectionRule,
      terms: evidence.terms,
      misses: evidence.misses,
      conformal: evidence.conformal,
      bootstrap_median_rank_width: evidence.bootstrapMedianRankWidth,
    },
    odds: {
      base_rate: odds.baseRate, cv_accuracy: odds.cvAccuracy, cv_auc: odds.cvAuc, folds: odds.folds,
      calibration: odds.calibration,
    },
    capture_share: CAPTURE_SHARE,
    farm_rows: {
      total: rows.length,
      farm: rows.filter((r) => r.verdict === 'FARM').length,
      thin: rows.filter((r) => r.verdict === 'THIN').length,
      skip: rows.filter((r) => r.verdict === 'SKIP').length,
    },
    off_list_reasons: Object.fromEntries(acct.reasons.map((r) => [r.label, r.count])),
    totals: {
      implied_sum_usd: rows.reduce((s, r) => s + r.implied_value_usd, 0),
      tvl_sum_usd: rows.reduce((s, r) => s + r.tvl_usd, 0),
      board_rows: rows.length,
    },
    verdict_rule: { farm_net_min_usd: 500 },
  },
  rows,
};
writeFileSync(join(out, 'data.js'), `window.RADAR = ${JSON.stringify(data)};\n`);

function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}
copyFiles(join(here, 'dashboard'), join(out, 'dashboard'));
const shots = copyFiles(join(here, 'screenshots'), join(out, 'screenshots'));
if (shots.length < 3) {
  process.stderr.write(`radar: screenshots/ holds ${shots.length}: hand in 3\n`);
  process.exit(1);
}
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 65_536, screenshots: { max: 4, max_bytes: 524_288 }, dashboard: { max_files: 400, max_bytes: 4_194_304 } }));

process.stdout.write(
  `radar: ${acct.scanned} scanned, ${acct.tradedAnchors} traded anchors (${acct.fitEligible} fit-eligible, ${acct.fitUniverse} fit universe), ${rows.length} rows ranked, watchlist ${acct.watchlist}/${acct.watchlist}\n` +
  `radar: chosen model "${evidence.chosenName}"\n` +
  `radar: LOO fit-universe ${evidence.looFitU.toFixed(2)}x, LOO all-eligible ${evidence.looAll.toFixed(2)}x, implied LOO (value x odds) ${evidence.impliedLooFitU.toFixed(2)}x, walk-forward ${evidence.walkForward.toFixed(2)}x on ${evidence.walkForwardPairs} pairs, odds held-out ${(odds.cvAccuracy * 100).toFixed(1)}% vs base ${(odds.baseRate * 100).toFixed(1)}%\n` +
  `radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json to ${out}\n`,
);
