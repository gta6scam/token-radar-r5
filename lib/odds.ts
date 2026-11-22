// Launch-odds model: the second model of the radar.
//
// Question it answers: of the protocols that look like this one (size, age,
// reach, momentum, line of business), how many already record a token? The
// label is read straight off the snapshot for all 758 protocols — a protocol
// "records a token" when DefiLlama carries a gecko_id or a symbol for it —
// and a logistic regression is fitted on that label. The base rate is 54.9%:
// a reader who always guessed "already launched" would be right 54.9% of the
// time, so the model only earns its place by beating that held-out, which is
// measured with stratified cross-validation and printed on the dashboard.
//
// This build also keeps every out-of-fold prediction the cross-validation
// makes. Those held-out probabilities do two jobs the previous build could
// not do: they grade the FULL price (value x odds) end-to-end on the traded
// anchors in lib/validate.ts, and they fill a printed calibration table —
// predicted probability against the frequency that actually occurred, in
// five buckets, with a Brier score beside the base rate's own.
//
// For a pre-token protocol the fitted probability is its launch odds: the
// share of look-alike protocols that have already crossed the line. The
// board's implied value is value-if-it-launches x odds, so a row is cheap
// either because the prize is small or because the launch is unlikely, and
// the detail view shows which.

export interface OddsProtocol {
  slug: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export const recordsToken = (p: OddsProtocol) => p.gecko_id !== null || p.symbol !== null;

const FAMILIES = ['Dexs', 'Lending', 'Liquid Staking', 'Bridge', 'Yield', 'CEX'];

export interface OddsCalibrationBucket { lo: number; hi: number; n: number; predicted: number; actual: number }
export interface OddsCalibration { buckets: OddsCalibrationBucket[]; brier: number; brierBase: number }

export interface OddsModel {
  predict: (p: OddsProtocol) => number;
  baseRate: number;
  cvAccuracy: number;
  cvAuc: number;
  folds: number;
  /** Mean out-of-fold probability per protocol slug, from the same CV folds. */
  oof: Map<string, number>;
  calibration: OddsCalibration;
}

function makeFeatures(winsor: (x: number | null) => number, ageMedian: number, asOfMs: number) {
  const DAY = 86_400_000;
  return (p: OddsProtocol): number[] => {
    const ageYears = p.listed_at ? Math.max(0, (asOfMs - new Date(p.listed_at + 'T00:00:00Z').getTime()) / DAY / 365.25) : null;
    const f: Record<string, number> = {
      size: Math.log10(p.tvl_usd / 1e6),
      age: Math.log1p(ageYears ?? ageMedian),
      ageMiss: p.listed_at ? 0 : 1,
      chains: Math.log2(1 + p.chains.length),
      mom: winsor(p.change_7d) / 100,
      eth: p.chains.includes('Ethereum') ? 1 : 0,
    };
    for (const fam of FAMILIES) f['cat_' + fam] = p.category === fam ? 1 : 0;
    return [f.size, f.age, f.ageMiss, f.chains, f.mom, f.eth, ...FAMILIES.map((fam) => f['cat_' + fam])] as number[];
  };
}

function fitLogit(rows: OddsProtocol[], feat: (p: OddsProtocol) => number[], iters = 600, lr = 0.35, l2 = 0.02) {
  const X = rows.map((p) => [1, ...feat(p)]);
  const y = rows.map((p) => (recordsToken(p) ? 1 : 0));
  const n = X[0]!.length;
  const mu = new Array<number>(n).fill(0);
  const sd = new Array<number>(n).fill(1);
  for (let j = 1; j < n; j++) {
    mu[j] = X.reduce((s, r) => s + r[j]!, 0) / X.length;
    sd[j] = Math.sqrt(X.reduce((s, r) => s + (r[j]! - mu[j]!) ** 2, 0) / X.length) || 1;
  }
  const Z = X.map((r) => r.map((v, j) => (j === 0 ? 1 : (v - mu[j]!) / sd[j]!)));
  const w = new Array<number>(n).fill(0);
  for (let it = 0; it < iters; it++) {
    const grad = new Array<number>(n).fill(0);
    for (let i = 0; i < Z.length; i++) {
      let z = 0;
      for (let j = 0; j < n; j++) z += Z[i]![j]! * w[j]!;
      const pr = 1 / (1 + Math.exp(-z));
      for (let j = 0; j < n; j++) grad[j]! += (pr - y[i]!) * Z[i]![j]!;
    }
    for (let j = 0; j < n; j++) w[j]! -= (lr * grad[j]!) / Z.length + (j === 0 ? 0 : lr * l2 * w[j]!);
  }
  return (p: OddsProtocol) => {
    const r = [1, ...feat(p)];
    let z = 0;
    for (let j = 0; j < n; j++) z += (j === 0 ? r[j]! : (r[j]! - mu[j]!) / sd[j]!) * w[j]!;
    return 1 / (1 + Math.exp(-z));
  };
}

function auc(pairs: [number, number][]): number {
  const pos = pairs.filter(([, y]) => y === 1).map(([s]) => s).sort((a, b) => a - b);
  const neg = pairs.filter(([, y]) => y === 0).map(([s]) => s).sort((a, b) => a - b);
  let wins = 0, ties = 0;
  for (const a of pos) for (const b of neg) { if (a > b) wins++; else if (a === b) ties++; }
  return (wins + 0.5 * ties) / (pos.length * neg.length);
}

/** Calibration of held-out probabilities: five buckets, predicted vs occurred, plus Brier scores. */
function calibrationOf(all: OddsProtocol[], oof: Map<string, number>, baseRate: number): OddsCalibration {
  const buckets: OddsCalibrationBucket[] = [];
  for (let b = 0; b < 5; b++) {
    const lo = b / 5, hi = (b + 1) / 5;
    const inB = all.filter((p) => { const pr = oof.get(p.slug) ?? 0; return pr >= lo && (b === 4 ? pr <= hi : pr < hi); });
    if (inB.length === 0) { buckets.push({ lo, hi, n: 0, predicted: 0, actual: 0 }); continue; }
    buckets.push({
      lo, hi, n: inB.length,
      predicted: inB.reduce((s, p) => s + (oof.get(p.slug) ?? 0), 0) / inB.length,
      actual: inB.filter(recordsToken).length / inB.length,
    });
  }
  const brier = all.reduce((s, p) => s + ((oof.get(p.slug) ?? 0) - (recordsToken(p) ? 1 : 0)) ** 2, 0) / all.length;
  const brierBase = all.reduce((s, p) => s + (baseRate - (recordsToken(p) ? 1 : 0)) ** 2, 0) / all.length;
  return { buckets, brier, brierBase };
}

/** Fit the odds model on every protocol in the snapshot and measure it held-out. */
export function fitOdds(all: OddsProtocol[], winsor: (x: number | null) => number, asOfMs: number): OddsModel {
  const DAY = 86_400_000;
  const ages = all.map((p) => (p.listed_at ? (asOfMs - new Date(p.listed_at + 'T00:00:00Z').getTime()) / DAY / 365.25 : null)).filter((x): x is number => x !== null).sort((a, b) => a - b);
  const ageMedian = ages[ages.length >> 1]!;
  const feat = makeFeatures(winsor, ageMedian, asOfMs);
  const baseRate = all.filter(recordsToken).length / all.length;
  // Stratified 5-fold CV x 4 repeats, fixed seed: the held-out numbers the dashboard prints.
  let s = 11;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const accs: number[] = [], aucs: number[] = [];
  const oofLists = new Map<string, number[]>();
  const FOLDS = 5, REPS = 4;
  for (let r = 0; r < REPS; r++) {
    const pos = all.filter(recordsToken), neg = all.filter((p) => !recordsToken(p));
    for (const arr of [pos, neg]) for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j]!, arr[i]!]; }
    for (let f = 0; f < FOLDS; f++) {
      const test = [...pos.filter((_, k) => k % FOLDS === f), ...neg.filter((_, k) => k % FOLDS === f)];
      const train = [...pos.filter((_, k) => k % FOLDS !== f), ...neg.filter((_, k) => k % FOLDS !== f)];
      const m = fitLogit(train, feat);
      const pairs: [number, number][] = test.map((p) => [m(p), recordsToken(p) ? 1 : 0]);
      accs.push(pairs.filter(([pr, y]) => (pr >= 0.5 ? 1 : 0) === y).length / pairs.length);
      aucs.push(auc(pairs));
      for (const p of test) {
        if (!oofLists.has(p.slug)) oofLists.set(p.slug, []);
        oofLists.get(p.slug)!.push(m(p));
      }
    }
  }
  const oof = new Map([...oofLists].map(([slug, ps]) => [slug, ps.reduce((a, b) => a + b, 0) / ps.length] as [string, number]));
  const predict = fitLogit(all, feat);
  return {
    predict,
    baseRate,
    cvAccuracy: accs.reduce((a, b) => a + b, 0) / accs.length,
    cvAuc: aucs.reduce((a, b) => a + b, 0) / aucs.length,
    folds: FOLDS * REPS,
    oof,
    calibration: calibrationOf(all, oof, baseRate),
  };
}
