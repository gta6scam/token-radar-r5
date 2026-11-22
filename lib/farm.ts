// Farm plans and verdicts for the token-radar challenger.
//
// Every row of the board carries a farm plan whose cost is BUILT, not flat:
// a category base (what the work actually is), a chain tier (what the
// interactions cost on the cheapest chain the protocol runs on), and a chase
// surcharge when the crowd is already moving in (7-day TVL growth). The
// verdict is netted at the row's own LOW band — the pessimistic end of its
// calibrated 80% value band — under one declared capture assumption:
//
//   capture = low_band x CAPTURE_SHARE
//
// CAPTURE_SHARE is built from two stated parts: a launch is assumed to
// distribute 8% of its value to farmers, and one prepared wallet's expected
// share of that distribution is 0.05% — together 0.004% of the low band. It
// is printed on the dashboard, and the last farm step of every row restates
// the arithmetic (capture - cost = net) so the verdict can be re-derived
// from the row alone.

export interface FarmProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
}

export interface FarmResult {
  steps: string[];
  cost_usd: number;
  days: number;
  capture_usd: number;
  net_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
}

export const CAPTURE_SHARE = 0.00004; // 0.004% of the low band: 8% distributed x 0.05% per prepared wallet
export const FARM_NET_MIN = 500; // net at or above this (USD) earns a FARM verdict

const CHAIN_TIER: Record<string, { gas: number; label: string }> = {
  Ethereum: { gas: 14, label: 'Ethereum mainnet gas' },
  Solana: { gas: 0.4, label: 'Solana fees' },
  BSC: { gas: 0.3, label: 'BSC fees' },
  BNB: { gas: 0.3, label: 'BNB Chain fees' },
  Avalanche: { gas: 0.8, label: 'Avalanche fees' },
  Polygon: { gas: 0.2, label: 'Polygon fees' },
  Bitcoin: { gas: 6, label: 'Bitcoin fees' },
};
const L2 = { gas: 0.35, label: 'L2 gas' };
const DEFAULT_TIER = { gas: 1.5, label: 'chain fees' };

/** The cheapest interaction route among the chains the protocol runs on. */
export function chainTier(chains: string[]): { gas: number; label: string; chain: string } {
  let best: { gas: number; label: string; chain: string } | null = null;
  for (const c of chains) {
    const t = CHAIN_TIER[c] ?? (/(arbitrum|optimism|base|zksync|linea|scroll|mantle|blast|mode|taiko|starknet)/i.test(c) ? L2 : DEFAULT_TIER);
    if (best === null || t.gas < best.gas) best = { ...t, chain: c };
  }
  return best ?? { ...DEFAULT_TIER, chain: 'Ethereum' };
}

interface CatPlan { open: string; work: string; cadence: string; interactions: number; capital: number; weeks: number }
const CAT_PLANS: Record<string, CatPlan> = {
  Lending: { open: 'Supply a blue-chip collateral asset and open a small borrow against it', work: 'Keep the health factor above 1.6 and roll the borrow weekly so the position reads as organic credit use', cadence: 'one roll per week', interactions: 14, capital: 500, weeks: 8 },
  Dexs: { open: 'Swap across the main pairs and post a narrow liquidity position', work: 'Rebalance the LP range when price walks out of it and keep swap volume spread across days, not in one burst', cadence: 'two sessions per week', interactions: 18, capital: 400, weeks: 8 },
  'Liquid Staking': { open: 'Stake a modest amount and hold the liquid staking token in the same wallet', work: 'Restake or lend the LST in one partner market so the wallet shows a second, distinct use', cadence: 'one check per week', interactions: 8, capital: 500, weeks: 10 },
  Yield: { open: 'Deposit into the flagship vault and leave the position untouched', work: 'Compound the yield back into the same vault on a fixed weekday so the history reads as patient capital', cadence: 'one compound per week', interactions: 10, capital: 400, weeks: 8 },
  Bridge: { open: 'Bridge a round trip between the two busiest routes and keep the destination balance', work: 'Repeat the route monthly with varied amounts; one-way bridge-and-abandon histories are the first filtered out', cadence: 'one round trip per month', interactions: 8, capital: 300, weeks: 10 },
  RWA: { open: 'Onboard, pass the KYC the asset requires and buy the smallest lot', work: 'Hold through at least one full distribution cycle; RWA launches reward holders of record, not traders', cadence: 'one check per month', interactions: 5, capital: 1000, weeks: 12 },
  CDP: { open: 'Open a vault, mint a conservative amount of the stablecoin against it', work: 'Keep collateral ratio above 220% and repay/re-mint in small steps to build a long position history', cadence: 'one adjustment per week', interactions: 12, capital: 600, weeks: 8 },
  Derivatives: { open: 'Fund the account and trade small, hedged perpetual positions', work: 'Trade on several days each week with tight size; volume spread over time is what points systems count', cadence: 'three sessions per week', interactions: 22, capital: 500, weeks: 6 },
  Restaking: { open: 'Restake an LST position and pick one operator set deliberately', work: 'Leave the restake untouched; churn reads as mercenary and restaking points accrue to duration', cadence: 'one check per fortnight', interactions: 6, capital: 500, weeks: 12 },
};
const GENERIC_PLAN: CatPlan = { open: 'Make the protocol\u2019s core action once with a meaningful amount', work: 'Repeat the core action on a steady cadence and keep the position open between sessions', cadence: 'one session per week', interactions: 10, capital: 400, weeks: 8 };

const money = (x: number) => '$' + Math.round(x).toLocaleString('en-US');

/** Build the farm plan + verdict for one board row. lowBand is the row's calibrated 80%-band low (USD). */
export function buildFarm(p: FarmProtocol, lowBand: number, winsorChange: number): FarmResult {
  const plan = CAT_PLANS[p.category ?? ''] ?? GENERIC_PLAN;
  const tier = chainTier(p.chains);
  // Chase surcharge: hot 7-day growth means the crowd is already here — more
  // competition for the same distribution, more weeks of work to stand out.
  const hot = winsorChange > 10;
  const cold = winsorChange < -15;
  const surcharge = hot ? 1.5 : cold ? 0.8 : 1;
  const interactions = Math.round(plan.interactions * (hot ? 1.25 : 1));
  const weeks = Math.round(plan.weeks * surcharge);
  const gasCost = interactions * tier.gas;
  const bridgeCost = tier.chain === 'Ethereum' ? 0 : 9; // one bridge in from mainnet, amortised
  const capitalCost = plan.capital * 0.02; // opportunity + slippage drag on the working capital, stated flat
  const cost = gasCost + bridgeCost + capitalCost;
  const days = weeks * 7;
  const capture = lowBand * CAPTURE_SHARE;
  const net = capture - cost;
  const verdict: FarmResult['verdict'] = net >= FARM_NET_MIN ? 'FARM' : net >= 0 ? 'THIN' : 'SKIP';
  const crowd = hot
    ? `The crowd is already here (TVL ${winsorChange > 0 ? '+' : ''}${winsorChange.toFixed(1)}% in 7 days): budget a 50% chase surcharge in time and expect the distribution to be split more ways.`
    : cold
      ? `The crowd is leaving (TVL ${winsorChange.toFixed(1)}% in 7 days): the same work buys a larger share of any distribution, but the launch itself is less certain.`
      : 'TVL is steady over 7 days: no chase surcharge, the plan below is the plain cost of the work.';
  const steps = [
    `Set up: fund one wallet with about ${money(plan.capital)} of working capital and route it to ${tier.chain} (${tier.label} about ${money(tier.gas)} per interaction${bridgeCost ? `, plus about ${money(bridgeCost)} to bridge in` : ''}). Cost so far about ${money(bridgeCost + tier.gas)}; time about 25 minutes.`,
    `Open the position: ${plan.open}. Cost about ${money(tier.gas * 2)} in fees; time about 20 minutes. ${crowd}`,
    `Work it: ${plan.work} — ${plan.cadence}, roughly ${interactions} interactions over ${weeks} weeks. Fees about ${money(gasCost)} in total; time about 15 minutes per session.`,
    `Stay eligible: keep the position open for the full ${weeks} weeks, never empty the wallet between sessions, and keep every transaction signed from the same address — split or churned histories are what launch filters remove first. Cost ${money(0)}; time is the holding period itself.`,
    `Prepare the claim: watch the protocol\u2019s own channels for a snapshot or claim announcement, keep ${money(plan.capital)} of capital uncommitted in the final two weeks, and be ready to pay one claim transaction at ${tier.label} rates (about ${money(tier.gas)}).`,
    `Verdict ${verdict}: capture ${money(capture)} (declared share 0.004% of this row\u2019s low band: 8% of value distributed to farmers \u00d7 0.05% per prepared wallet) \u2212 total cost ${money(cost)} (fees ${money(gasCost + bridgeCost)} + capital drag ${money(capitalCost)}) = net ${money(net)} over about ${days} days.`,
  ];
  return { steps, cost_usd: Math.round(cost), days, capture_usd: Math.round(capture), net_usd: Math.round(net), verdict };
}
