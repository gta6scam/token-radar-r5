// The token-radar challenger's model library (fifth build): snapshot in,
// ranked board + evidence out.
//
// Two fitted models, both derived from the snapshot's own numbers and both
// tested held-out in lib/validate.ts before a single board row is priced:
//
//   VALUE  — what a token would be worth if the protocol launched one.
//            k-nearest-neighbour regression (k=5) over the log market-cap/TVL
//            ratios of the traded anchors, in standardised feature space,
//            with a distance penalty when a neighbour's category differs
//            from the row's. Two learners share the work: learner A reads
//            winsorised 7-day momentum, log age, log size and chain reach;
//            learner B adds an Ethereum-presence flag. Which blend of them
//            prices the board is NOT hand-picked: lib/validate.ts runs the
//            printed candidate tournament (global and category references,
//            the two learners, blends, a distance-weighted form, ridge
//            log-linear forms, residual and support-shrunk forms) and the
//            production model is the admitted candidate that first clears
//            the declared leave-one-out gate on the fit universe and then
//            posts the best leave-one-out on all fit-eligible anchors.
//   ODDS   — the launch-odds model in lib/odds.ts: of the protocols that
//            look like this one, how many already record a token?
//
//   implied value = value if it launches x launch odds
//
// The value model is fitted on a DECLARED fit universe: traded anchors whose
// recorded market cap is positive, whose launch is material (cap >= $1M),
// and whose category carries at least three such anchors, so a category
// effect is estimable at all. Every validation number is also disclosed for
// all 128 fit-eligible anchors beside it — see lib/validate.ts.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export const med = (xs: number[]): number => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
export const quantile = (xs: number[], q: number): number => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]!; };
export const foldErr = (pred: number, actual: number) => Math.exp(Math.abs(Math.log(pred / actual)));
export const medFold = (pairs: [number, number][]) => med(pairs.map(([p, a]) => foldErr(p, a)));

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) throw new Error('snapshot: protocols/watchlist missing');
  return raw;
}

// ---------- universes & accounting ----------
export interface Accounting {
  scanned: number;
  tradedAnchors: number;
  fitEligible: number;
  fitUniverse: number;
  preToken: number;
  watchlist: number;
  offList: number;
  belowFloor: number;
  ranked: number;
  notRanked: number;
  parentRuleRanked: number;
  rankExcluded: { label: string; count: number }[];
  reasons: { label: string; count: number }[];
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const BAD_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const PRODUCT_CATS = BAD_CATS; // exactly the house's own product-category set, applied snapshot-wide
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** The first house-rule reason a pre-token protocol at/above the floor is off the watchlist. */
export function offListReason(p: Protocol): string {
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked name';
  if (p.category !== null && BAD_CATS.has(p.category)) return 'bridge/staking/CEX category';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return 'parent protocol (house record; field not in snapshot)';
}

/**
 * Board eligibility: a pre-token protocol is ranked unless the snapshot
 * itself marks it as a product of another token or a non-issuer — a wrapped
 * or staked product of a token that already trades is not a launch that has
 * not happened yet (the snapshot's own warning). Returns the exclusion
 * reason, or null when the protocol is a rankable launch candidate. The
 * house's parent-protocol rule is NOT applied: that field is not in the
 * snapshot, so the 20 off-list protocols it alone excludes are ranked and
 * the fact is disclosed in the accounting.
 */
export function rankExclusion(p: Protocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked name';
  if (p.category !== null && PRODUCT_CATS.has(p.category)) return 'product category (bridge/staking/CEX)';
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return 'exchange product';
  return null;
}

export const isPreToken = (p: Protocol) => p.gecko_id === null && p.symbol === null;
export const tradedAnchors = (s: Snapshot) => s.protocols.filter((p) => p.mcap_usd !== null);
export const fitEligible = (s: Snapshot) => s.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);

/** Declared fit universe: fit-eligible anchors with a material cap in a category of >= 3 anchors. */
export function fitUniverse(s: Snapshot): Protocol[] {
  const elig = fitEligible(s);
  const counts = new Map<string, number>();
  for (const p of elig) counts.set(p.category ?? '', (counts.get(p.category ?? '') ?? 0) + 1);
  return elig.filter((p) => p.mcap_usd !== null && p.mcap_usd >= 1_000_000 && (counts.get(p.category ?? '') ?? 0) >= 3);
}

export function accounting(s: Snapshot, rankedCount: number): Accounting {
  const wl = new Set(s.watchlist);
  const pre = s.protocols.filter(isPreToken);
  const off = pre.filter((p) => p.tvl_usd >= s.floor_usd && !wl.has(p.slug));
  const reasonCounts = new Map<string, number>();
  for (const p of off) reasonCounts.set(offListReason(p), (reasonCounts.get(offListReason(p)) ?? 0) + 1);
  const exclCounts = new Map<string, number>();
  for (const p of pre) {
    const r = rankExclusion(p);
    if (r !== null) exclCounts.set(r, (exclCounts.get(r) ?? 0) + 1);
  }
  return {
    scanned: s.protocols.length,
    tradedAnchors: tradedAnchors(s).length,
    fitEligible: fitEligible(s).length,
    fitUniverse: fitUniverse(s).length,
    preToken: pre.length,
    watchlist: s.watchlist.length,
    offList: off.length,
    belowFloor: pre.filter((p) => p.tvl_usd < s.floor_usd).length,
    ranked: rankedCount,
    notRanked: pre.length - rankedCount,
    parentRuleRanked: off.filter((p) => offListReason(p).startsWith('parent protocol') && rankExclusion(p) === null).length,
    rankExcluded: [...exclCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    reasons: [...reasonCounts.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
  };
}

// ---------- features ----------
export interface FeatureCtx {
  winsorLo: number;
  winsorHi: number;
  ageMedianYears: number;
  asOfMs: number;
}

export function featureCtx(anchors: Protocol[], asOf: string): FeatureCtx {
  const chg = anchors.map((p) => p.change_7d).filter((x): x is number => x !== null);
  const asOfMs = new Date(asOf + 'T00:00:00Z').getTime();
  const ages = anchors.map((p) => ageYears(p, asOfMs)).filter((x): x is number => x !== null);
  return { winsorLo: quantile(chg, 0.05), winsorHi: quantile(chg, 0.95), ageMedianYears: med(ages), asOfMs };
}

export const ageYears = (p: Protocol, asOfMs: number): number | null =>
  p.listed_at ? Math.max(0, (asOfMs - new Date(p.listed_at + 'T00:00:00Z').getTime()) / 86_400_000 / 365.25) : null;

export const winsorise = (ctx: FeatureCtx, x: number | null) => (x === null ? 0 : Math.min(ctx.winsorHi, Math.max(ctx.winsorLo, x)));

/** The five value terms, in the order every learner reads them. */
export type Term = 'mom' | 'age' | 'size' | 'reach' | 'eth';
export const ALL_TERMS: Term[] = ['mom', 'age', 'size', 'reach', 'eth'];
export const TERM_LABELS: Record<Term, string> = {
  mom: 'momentum (change_7d, winsorised)',
  age: 'age (log years listed)',
  size: 'size (log TVL)',
  reach: 'chain reach (log2 chains)',
  eth: 'Ethereum presence flag',
};
const TERMS_A: Term[] = ['mom', 'age', 'size', 'reach'];
const TERMS_B: Term[] = ['mom', 'age', 'size', 'reach', 'eth'];

export function termValue(ctx: FeatureCtx, term: Term, p: Protocol): number {
  switch (term) {
    case 'mom': return winsorise(ctx, p.change_7d) / 100;
    case 'age': return Math.log1p(ageYears(p, ctx.asOfMs) ?? ctx.ageMedianYears);
    case 'size': return Math.log10(p.tvl_usd / 1e6);
    case 'reach': return Math.log2(1 + p.chains.length);
    case 'eth': return p.chains.includes('Ethereum') ? 1 : 0;
  }
}
export const features = (ctx: FeatureCtx, p: Protocol, terms: Term[]): number[] => terms.map((t) => termValue(ctx, t, p));

// ---------- value learners ----------
export interface ValueModel {
  /** Predicted mcap/TVL ratio for a protocol profile. */
  ratio: (p: Protocol) => number;
}
export type FitFn = (rows: Protocol[]) => ValueModel;

/** Category prior: per-category median log-ratio, shrunk toward the global median with weight K. */
export function catPrior(rows: Protocol[], K = 4): { logRatio: (p: Protocol) => number; global: number } {
  const ly = rows.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd));
  const g = med(ly);
  const by = new Map<string, number[]>();
  rows.forEach((p, i) => { const c = p.category ?? ''; if (!by.has(c)) by.set(c, []); by.get(c)!.push(ly[i]!); });
  const eff = new Map([...by].map(([c, rs]) => [c, (rs.length * med(rs) + K * g) / (rs.length + K)]));
  return { logRatio: (p) => eff.get(p.category ?? '') ?? g, global: g };
}

export const fitGlobalMedian: FitFn = (rows) => {
  const g = med(rows.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd)));
  return { ratio: () => Math.exp(g) };
};

export const fitCategoryBaseline: FitFn = (rows) => {
  const prior = catPrior(rows);
  return { ratio: (p) => Math.exp(prior.logRatio(p)) };
};

export interface KnnOpts {
  k?: number;
  terms?: Term[];
  /** Distance-weighted median instead of the plain median of neighbour log-ratios. */
  weighted?: boolean;
  /** Category-mismatch distance penalty (standardised units). */
  catPenalty?: number;
  /** Predict the deviation from the category prior instead of the ratio itself. */
  residual?: boolean;
  /**
   * Support-aware shrinkage: pull the prediction toward the category prior
   * as the row's mean neighbour distance leaves the support the anchors
   * themselves show (their leave-one-out distances' third quartile).
   * 'ramp' grows linearly past that quartile; 'pow4' grows with its fourth
   * power. Inside the support the prediction is untouched.
   */
  shrink?: { mode: 'ramp' | 'pow4'; s: number } | null;
}

export function fitKnn(ctx: FeatureCtx, opts: KnnOpts = {}): FitFn {
  const k = opts.k ?? 5;
  const terms = opts.terms ?? TERMS_B;
  const catPenalty = opts.catPenalty ?? 0.75;
  return (rows) => {
    const F = rows.map((p) => features(ctx, p, terms));
    const dims = terms.length;
    const mu = Array.from({ length: dims }, (_, j) => F.reduce((s, f) => s + f[j]!, 0) / F.length);
    const sd = Array.from({ length: dims }, (_, j) => Math.sqrt(F.reduce((s, f) => s + (f[j]! - mu[j]!) ** 2, 0) / F.length) || 1);
    const Z = F.map((f) => f.map((v, j) => (v - mu[j]!) / sd[j]!));
    const ly = rows.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd));
    const prior = (opts.residual || opts.shrink) ? catPrior(rows) : null;
    const base = opts.residual && prior ? ly.map((v, i) => v - prior.logRatio(rows[i]!)) : ly;
    const neighbours = (p: Protocol, selfIdx = -1): [number, number][] => {
      const zp = features(ctx, p, terms).map((v, j) => (v - mu[j]!) / sd[j]!);
      const ds: [number, number][] = [];
      for (let i = 0; i < rows.length; i++) {
        if (i === selfIdx) continue;
        let d = 0;
        for (let j = 0; j < dims; j++) d += (Z[i]![j]! - zp[j]!) ** 2;
        ds.push([Math.sqrt(d) + (rows[i]!.category === p.category ? 0 : catPenalty), i]);
      }
      ds.sort((a, b) => a[0] - b[0]);
      return ds.slice(0, k);
    };
    // Support scale from the training rows' own leave-one-out distances.
    let supportQ75 = 1;
    if (opts.shrink) {
      const bars = rows.map((p, i) => { const nb = neighbours(p, i); return nb.reduce((s, [d]) => s + d, 0) / nb.length; });
      supportQ75 = quantile(bars, 0.75);
    }
    const queryCache = new Map<string, [number, number][]>();
    const nbOf = (p: Protocol) => {
      let hit = queryCache.get(p.slug);
      if (hit === undefined) { hit = neighbours(p); queryCache.set(p.slug, hit); }
      return hit;
    };
    const localLog = (p: Protocol): number => {
      const nb = nbOf(p);
      if (!opts.weighted) return med(nb.map(([, i]) => base[i]!));
      const pairs = nb.map(([d, i]) => [base[i]!, 1 / (0.25 + d)] as [number, number]).sort((a, b) => a[0] - b[0]);
      const tot = pairs.reduce((s, [, w]) => s + w, 0);
      let acc = 0;
      for (const [v, w] of pairs) { acc += w; if (acc >= tot / 2) return v; }
      return pairs[pairs.length - 1]![0];
    };
    return {
      ratio: (p) => {
        let out = localLog(p);
        if (opts.residual && prior) out += prior.logRatio(p);
        if (opts.shrink && prior) {
          const nb = nbOf(p);
          const dbar = nb.reduce((s, [d]) => s + d, 0) / nb.length;
          const lam = opts.shrink.mode === 'ramp'
            ? opts.shrink.s * Math.min(1, Math.max(0, (dbar - supportQ75) / 1.5))
            : opts.shrink.s * (dbar ** 4) / (dbar ** 4 + supportQ75 ** 4);
          out = (1 - lam) * out + lam * prior.logRatio(p);
        }
        return Math.exp(out);
      },
    };
  };
}

/** Ridge log-linear regression over the same standardised terms. */
export function fitRidge(ctx: FeatureCtx, opts: { terms?: Term[]; lambda?: number } = {}): FitFn {
  const terms = opts.terms ?? ALL_TERMS;
  const lambda = opts.lambda ?? 10;
  return (rows) => {
    const F = rows.map((p) => features(ctx, p, terms));
    const y = rows.map((p) => Math.log((p.mcap_usd as number) / p.tvl_usd));
    const dims = terms.length;
    const mu = Array.from({ length: dims }, (_, j) => F.reduce((s, f) => s + f[j]!, 0) / F.length);
    const sd = Array.from({ length: dims }, (_, j) => Math.sqrt(F.reduce((s, f) => s + (f[j]! - mu[j]!) ** 2, 0) / F.length) || 1);
    const ybar = y.reduce((s, v) => s + v, 0) / y.length;
    const A = Array.from({ length: dims }, () => new Array<number>(dims).fill(0));
    const b = new Array<number>(dims).fill(0);
    for (let i = 0; i < rows.length; i++) {
      const z = F[i]!.map((v, j) => (v - mu[j]!) / sd[j]!);
      for (let a = 0; a < dims; a++) { for (let c = 0; c < dims; c++) A[a]![c] += z[a]! * z[c]!; b[a]! += z[a]! * (y[i]! - ybar); }
    }
    for (let j = 0; j < dims; j++) A[j]![j]! += lambda;
    for (let c = 0; c < dims; c++) {
      let piv = c;
      for (let r = c + 1; r < dims; r++) if (Math.abs(A[r]![c]!) > Math.abs(A[piv]![c]!)) piv = r;
      [A[c], A[piv]] = [A[piv]!, A[c]!]; [b[c], b[piv]] = [b[piv]!, b[c]!];
      for (let r = 0; r < dims; r++) {
        if (r === c) continue;
        const f = A[r]![c]! / A[c]![c]!;
        for (let k2 = c; k2 < dims; k2++) A[r]![k2]! -= f * A[c]![k2]!;
        b[r]! -= f * b[c]!;
      }
    }
    const w = A.map((row, j) => b[j]! / row[j]!);
    return {
      ratio: (p) => {
        const f = features(ctx, p, terms);
        let s = ybar;
        for (let j = 0; j < dims; j++) s += w[j]! * (f[j]! - mu[j]!) / sd[j]!;
        return Math.exp(s);
      },
    };
  };
}

/** Geometric blend of fitted learners with declared weights. */
export const blendOf = (parts: { fit: FitFn; w: number }[]): FitFn => (rows) => {
  const ms = parts.map(({ fit }) => fit(rows));
  const tw = parts.reduce((s, { w }) => s + w, 0);
  return { ratio: (p) => Math.exp(parts.reduce((s, { w }, i) => s + w * Math.log(ms[i]!.ratio(p)), 0) / tw) };
};

export interface Candidate {
  name: string;
  fit: FitFn;
  /** For kNN-family candidates: the same form with one feature term removed (per-term evidence). */
  dropTerm?: (term: Term) => FitFn;
}

const knnCandidate = (ctx: FeatureCtx, name: string, opts: KnnOpts): Candidate => ({
  name,
  fit: fitKnn(ctx, opts),
  dropTerm: (term) => fitKnn(ctx, { ...opts, terms: (opts.terms ?? TERMS_B).filter((t) => t !== term) }),
});
const blendCandidate = (ctx: FeatureCtx, name: string, parts: { opts: KnnOpts; w: number }[]): Candidate => ({
  name,
  fit: blendOf(parts.map(({ opts, w }) => ({ fit: fitKnn(ctx, opts), w }))),
  dropTerm: (term) => blendOf(parts.map(({ opts, w }) => ({ fit: fitKnn(ctx, { ...opts, terms: (opts.terms ?? TERMS_B).filter((t) => t !== term) }), w }))),
});

/**
 * The printed candidate tournament. Every form the rebuild tried is here —
 * references, the two learners, blends, a distance-weighted form, ridge
 * forms, a residual form, the support-shrunk form and a penalty variant —
 * and lib/validate.ts scores each one the same way and prints the losers
 * beside the winner.
 */
export function candidateFits(ctx: FeatureCtx): Candidate[] {
  const A: KnnOpts = { terms: TERMS_A };
  const B: KnnOpts = { terms: TERMS_B };
  return [
    { name: 'global median ratio (no features)', fit: fitGlobalMedian },
    { name: 'category median, shrunk K=4 (baseline)', fit: fitCategoryBaseline },
    knnCandidate(ctx, 'kNN-5, no Ethereum flag (learner A)', A),
    knnCandidate(ctx, 'kNN-5, with Ethereum flag (learner B)', B),
    blendCandidate(ctx, 'ensemble of both kNN learners (previous build)', [{ opts: A, w: 1 }, { opts: B, w: 1 }]),
    blendCandidate(ctx, 'weighted ensemble, learner A x2', [{ opts: A, w: 2 }, { opts: B, w: 1 }]),
    blendCandidate(ctx, 'B-heavy blend, learner B x3', [{ opts: A, w: 1 }, { opts: B, w: 3 }]),
    knnCandidate(ctx, 'kNN-3, with Ethereum flag', { ...B, k: 3 }),
    knnCandidate(ctx, 'kNN-7, with Ethereum flag', { ...B, k: 7 }),
    blendCandidate(ctx, 'distance-weighted ensemble of both kNN learners', [{ opts: { ...A, weighted: true }, w: 1 }, { opts: { ...B, weighted: true }, w: 1 }]),
    { name: 'ridge log-linear, lambda 10', fit: fitRidge(ctx, { lambda: 10 }), dropTerm: (term) => fitRidge(ctx, { lambda: 10, terms: ALL_TERMS.filter((t) => t !== term) }) },
    { name: 'ridge log-linear, lambda 30', fit: fitRidge(ctx, { lambda: 30 }), dropTerm: (term) => fitRidge(ctx, { lambda: 30, terms: ALL_TERMS.filter((t) => t !== term) }) },
    blendCandidate(ctx, 'residual ensemble (category prior + local deviation)', [{ opts: { ...A, residual: true }, w: 1 }, { opts: { ...B, residual: true }, w: 1 }]),
    blendCandidate(ctx, 'ensemble + support shrinkage past the anchors\u2019 q75 distance', [{ opts: { ...A, shrink: { mode: 'ramp', s: 1 } }, w: 1 }, { opts: { ...B, shrink: { mode: 'ramp', s: 1 } }, w: 1 }]),
    blendCandidate(ctx, 'ensemble, category penalty 0.4', [{ opts: { ...A, catPenalty: 0.4 }, w: 1 }, { opts: { ...B, catPenalty: 0.4 }, w: 1 }]),
  ];
}

/** The r4 production form, kept as the tournament's reference ensemble. */
export function fitValueModel(rows: Protocol[], ctx: FeatureCtx): ValueModel {
  return blendOf([{ fit: fitKnn(ctx, { terms: TERMS_A }), w: 1 }, { fit: fitKnn(ctx, { terms: TERMS_B }), w: 1 }])(rows);
}
