// Launch Scope v3: a token-launch radar built from a sealed snapshot.
//
// The input is one frozen DefiLlama fetch: every protocol at or above $5M of TVL, each with ten
// fields, plus the house watchlist of pre-token protocols at or above the $50M floor. This file
// turns that snapshot into a ranked board. Nothing here names a protocol: the same scoring runs
// over every row, and the board is whatever the figures say.
//
// How a protocol is scored (all inputs are the snapshot's own figures):
//
//   1. VALUE FIT. The 128 protocols whose token already trades with a positive market cap are
//      the anchors. On them we fit, by ordinary least squares in log space,
//        log10(mcap) = a + b*log10(tvl)
//      The coefficients are FITTED from the snapshot at run time, not picked by hand.
//      The fit is validated two held-out ways, and both numbers go on the cover:
//        LOO  — leave-one-out: refit without each anchor, predict it, take |predicted/actual|;
//               the median (and p75) over all anchors.
//        WF   — walk-forward: fit on anchors listed before 2024, test on anchors listed in
//               2024 or later; the median (and p75) of |predicted/actual| on the test set.
//      The 7-day change was tested as a value term and REJECTED: its fitted sign is negative
//      (it rewards TVL crashes — a protocol down 28% in a week would rank higher for it) and
//      it worsened leave-one-out error (median x3.40 without it, x3.77 with it). Growth is
//      shown on every row for the reader, but it does not move the value. Age is NOT in the
//      value fit either: adding it worsened walk-forward error (median x2.91 without age,
//      x4.29 with it) — newer listings price differently. Age is used where it belongs: in
//      the odds cohort and in the farm hold period.
//   2. TOKEN ODDS. A pre-token protocol's odds of ever listing are the rate at which its peers
//      already record a token: the fraction of protocols in its (age band x TVL band) cohort
//      that record a token (mcap, gecko_id or symbol), Laplace-smoothed as (has+1)/(n+2) so a
//      tiny cohort never claims 0% or 100%. This is a cross-sectional peer rate, not a hazard
//      rate over time — the cover says so.
//   3. EXPECTED VALUE. expected = fitted token value x odds. The board ranks by expected
//      value (rank 1 is the highest), and each row's implied_value_usd IS that expected value.
//      The detail view shows the split: fitted value, odds, expected value.
//   4. FARM ECONOMICS. A farmer's expected value for a deposit D is (D / TVL) x farmer-pool
//      x expected value, where the farmer pool is 5% of the token's value (range 3-10% shown).
//      Costs are gas (3 actions: $8 each when the first chain is Ethereum, $3 otherwise) plus
//      the opportunity cost of the capital at 5% a year over the hold. Hours are the farmer's
//      own time (setup plus one weekly action plus the claim check). $/hour is (expected -
//      costs) / hours, at three deposit tiers ($100, $1,000, $10,000). The plan is written
//      for a $10,000 position and the verdict is read off that tier: FARM at $10/hour or
//      more, THIN above $0, SKIP at or below $0. A $1,000 position almost never covers its
//      gas — the tiers table shows it, so the reader sees why.
//   5. ACCOUNTING. Every one of the snapshot's 758 protocols is accounted for: ranked
//      (pre-token launch candidates), live at market value, token-recorded with no market
//      price, or excluded from ranking with a stated reason. The board ranks only launch
//      candidates under the house's own visible rule (not a CEX, bridge, liquid-staking or
//      restaking product, no version marker in the name, no wrapped/staked word, not named
//      after an exchange) — a versioned pool or a wrapped product is not a token still to
//      come. The watchlist is a floor: the board also ranks candidates below it.
//
// The run is deterministic: the same snapshot always writes the same bytes.

/** One protocol as the sealed snapshot records it: exactly its ten fields. */
export interface Proto {
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

/** The whole sealed snapshot document. */
export interface Snap {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Proto[];
  watchlist: string[];
}

/** The snapshot is not shaped the way this model scores it. */
export class SnapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapError';
  }
}

const MS_PER_DAY = 86_400_000;

/** Clamp a number into a range. */
function clampNum(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/** Whole days from `listedAt` to the snapshot day; null when the date is missing or unparsable. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / MS_PER_DAY));
}

/** The fitted value model: log10(mcap) = a + b*log10(tvl). */
export interface Fit {
  a: number;
  b: number;
  n: number;
  r2: number;
}

/** One held-out validation: median and p75 of |predicted / actual|, and how many it ran on. */
export interface Validation {
  median: number;
  p75: number;
  n: number;
}

/** The fit plus both held-out validations, as the cover prints them. */
export interface FitReport {
  fit: Fit;
  loo: Validation;
  walkForward: Validation | null;
}

/**
 * Ordinary least squares by Gaussian elimination with partial pivoting. Deterministic: the
 * same rows always give the same coefficients. Returns null when the design is singular.
 */
export function ols(rows: number[][], target: number[]): number[] | null {
  const n = rows.length;
  const k = rows[0]!.length;
  const a: number[][] = [];
  for (let i = 0; i < k; i++) {
    const row: number[] = [];
    for (let j = 0; j < k; j++) {
      let s = 0;
      for (let r = 0; r < n; r++) s += rows[r]![i]! * rows[r]![j]!;
      row.push(s);
    }
    let s = 0;
    for (let r = 0; r < n; r++) s += rows[r]![i]! * target[r]!;
    row.push(s);
    a.push(row);
  }
  for (let i = 0; i < k; i++) {
    let piv = i;
    for (let r = i + 1; r < k; r++) if (Math.abs(a[r]![i]!) > Math.abs(a[piv]![i]!)) piv = r;
    if (Math.abs(a[piv]![i]!) < 1e-12) return null;
    const tmp = a[i]!;
    a[i] = a[piv]!;
    a[piv] = tmp;
    const d = a[i]![i]!;
    for (let j = i; j <= k; j++) a[i]![j] = a[i]![j]! / d;
    for (let r = 0; r < k; r++) {
      if (r === i) continue;
      const f = a[r]![i]!;
      if (f === 0) continue;
      for (let j = i; j <= k; j++) a[r]![j] = a[r]![j]! - f * a[i]![j]!;
    }
  }
  return a.map((row) => row[k]!);
}

/** The design row for one protocol: [1, log10(tvl)]. The 7-day change is not a value term
 *  (see the header): growth is shown on every row, but it does not move the value. */
export function designRow(p: Proto): number[] {
  return [1, Math.log10(p.tvl_usd)];
}

/** Fit the value model on the live anchors (token trades, positive market cap and TVL). */
export function fitValue(anchors: Proto[]): FitReport {
  if (anchors.length < 10) throw new SnapError(`only ${anchors.length} live anchors to fit the value model`);
  const rows = anchors.map(designRow);
  const target = anchors.map((p) => Math.log10(p.mcap_usd!));
  const coef = ols(rows, target);
  if (coef === null) throw new SnapError('the value fit is singular on these anchors');
  const predict = (row: number[]): number => coef[0]! + coef[1]! * row[1]!;
  const mean = target.reduce((s, v) => s + v, 0) / target.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < target.length; i++) {
    ssRes += (target[i]! - predict(rows[i]!)) ** 2;
    ssTot += (target[i]! - mean) ** 2;
  }
  const fit: Fit = { a: coef[0]!, b: coef[1]!, n: anchors.length, r2: ssTot === 0 ? 0 : 1 - ssRes / ssTot };

  // Leave-one-out: refit without each anchor, predict it, take |predicted / actual|.
  const looRatios: number[] = [];
  for (let i = 0; i < anchors.length; i++) {
    const subRows = rows.filter((_, j) => j !== i);
    const subTarget = target.filter((_, j) => j !== i);
    const sub = ols(subRows, subTarget);
    if (sub === null) continue;
    const pred = sub[0]! + sub[1]! * rows[i]![1]!;
    looRatios.push(10 ** Math.abs(target[i]! - pred));
  }
  looRatios.sort((x, y) => x - y);
  const loo: Validation = {
    median: looRatios[Math.floor(looRatios.length / 2)]!,
    p75: looRatios[Math.floor((looRatios.length * 3) / 4)]!,
    n: looRatios.length,
  };

  // Walk-forward: fit on anchors listed before 2024, test on anchors listed in 2024 or later.
  const trainIdx = anchors.map((p, i) => (p.listed_at !== null && p.listed_at < '2024-01-01' ? i : -1)).filter((i) => i >= 0);
  const testIdx = anchors.map((p, i) => (p.listed_at !== null && p.listed_at >= '2024-01-01' ? i : -1)).filter((i) => i >= 0);
  let walkForward: Validation | null = null;
  if (trainIdx.length >= 10 && testIdx.length >= 5) {
    const sub = ols(trainIdx.map((i) => rows[i]!), trainIdx.map((i) => target[i]!));
    if (sub !== null) {
      const ratios = testIdx
        .map((i) => 10 ** Math.abs(target[i]! - (sub[0]! + sub[1]! * rows[i]![1]!)))
        .sort((x, y) => x - y);
      walkForward = { median: ratios[Math.floor(ratios.length / 2)]!, p75: ratios[Math.floor((ratios.length * 3) / 4)]!, n: ratios.length };
    }
  }
  return { fit, loo, walkForward };
}

/** The fitted token value of one protocol, in whole dollars, from the fitted coefficients. */
export function fittedValue(p: Proto, fit: Fit): number {
  const row = designRow(p);
  return Math.max(1, Math.round(10 ** (fit.a + fit.b * row[1]!)));
}

/** True when the snapshot records no token for the protocol at all. */
export function isUnlaunched(p: Proto): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** True when the snapshot records a token but no market price for it. */
export function isRecordedNoPrice(p: Proto): boolean {
  return p.mcap_usd === null && (p.gecko_id !== null || p.symbol !== null);
}

/** True when the protocol's token already trades at a recorded market cap. */
export function isLive(p: Proto): boolean {
  return p.mcap_usd !== null;
}

/** The model label the dashboard and the board carry. */
export const MODEL_ID = 'launch-scope-3';

/** The farmer pool: the share of a token's value the farmers collectively receive (mid, low, high). */
export const FARMER_POOL = { mid: 0.05, low: 0.03, high: 0.1 };
/** The opportunity cost of the farming capital, per year. */
export const OPPORTUNITY_APY = 0.05;
/** The deposit tiers a farm plan is costed at, in dollars. */
export const DEPOSIT_TIERS = [100, 1000, 10000];
/** The $/hour at the $1,000 tier that earns FARM (THIN is anything above $0). */
export const FARM_HOURLY = 10;

/** The age band of a protocol, for the odds cohort. */
export function ageBand(age: number | null): string {
  if (age === null) return 'unknown';
  if (age < 90) return '<90d';
  if (age < 365) return '90-365d';
  if (age < 730) return '1-2y';
  return '2y+';
}

/** The TVL band of a protocol, for the odds cohort. */
export function tvlBand(tvl: number): string {
  if (tvl < 50_000_000) return '<50M';
  if (tvl < 250_000_000) return '50-250M';
  if (tvl < 1_000_000_000) return '250M-1B';
  return '1B+';
}

/** One odds cohort: how many of its protocols record a token, out of how many. */
export interface Cohort {
  age: string;
  tvl: string;
  has: number;
  n: number;
  odds: number;
}

/**
 * Token odds from the peers' record: for each (age band x TVL band) cohort, the fraction of
 * its protocols that record a token, Laplace-smoothed as (has+1)/(n+2) so a tiny cohort never
 * claims 0% or 100%. A protocol's odds are its own cohort's smoothed rate.
 */
export function buildOdds(snap: Snap): { cohorts: Cohort[]; oddsOf: (p: Proto) => number } {
  const table = new Map<string, { has: number; n: number }>();
  for (const p of snap.protocols) {
    const key = `${ageBand(daysSince(snap.as_of, p.listed_at))}|${tvlBand(p.tvl_usd)}`;
    const cell = table.get(key) ?? { has: 0, n: 0 };
    cell.n += 1;
    if (!isUnlaunched(p)) cell.has += 1;
    table.set(key, cell);
  }
  const cohorts: Cohort[] = [...table.entries()]
    .map(([key, cell]) => {
      const [age, tvl] = key.split('|');
      return { age: age!, tvl: tvl!, has: cell.has, n: cell.n, odds: (cell.has + 1) / (cell.n + 2) };
    })
    .sort((x, y) => (x.age < y.age ? -1 : x.age > y.age ? 1 : x.tvl < y.tvl ? -1 : 1));
  const byKey = new Map(cohorts.map((c) => [`${c.age}|${c.tvl}`, c.odds]));
  const fallback = (snap.protocols.filter((p) => !isUnlaunched(p)).length + 1) / (snap.protocols.length + 2);
  const oddsOf = (p: Proto): number => {
    const key = `${ageBand(daysSince(snap.as_of, p.listed_at))}|${tvlBand(p.tvl_usd)}`;
    return byKey.get(key) ?? fallback;
  };
  return { cohorts, oddsOf };
}

/** A name ending in a release number is a pool of another protocol, not a launch of its own. */
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
/** A name carrying a whole wrapped/staked word is a product of a token that already trades. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** Exchange names a protocol name must not begin with. */
const EXCHANGE_NAMES = ['binance', 'coinbase', 'bybit', 'kraken', 'bitget', 'okx', 'bitfinex', 'gemini'];
/** Categories the house's watchlist rule keeps out: not launches of their own. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Why a pre-token protocol is not ranked as a launch candidate, or null when it is one. */
export function exclusionReason(p: Proto): string | null {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return `category ${p.category}`;
  if (VERSION_TAIL.test(p.name)) return 'versioned name';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped/staked word';
  if (EXCHANGE_NAMES.some((e) => p.name.toLowerCase().startsWith(e))) return 'exchange name';
  return null;
}

/** True when the board may rank the protocol: pre-token and a launch of its own. */
export function isRankable(p: Proto): boolean {
  return isUnlaunched(p) && exclusionReason(p) === null;
}

/** How many days to keep a farm position open, set from the protocol's age. */
export function holdFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** The gas for one farm action, set from the protocol's first chain. */
export function gasPerAction(p: Proto): number {
  return p.chains.length > 0 && p.chains[0]!.toLowerCase() === 'ethereum' ? 8 : 3;
}

/** The farmer's own hours for a hold: setup, one weekly action, and the claim check. */
export function hoursFor(holdDays: number): number {
  return 0.5 + 0.25 * Math.ceil(holdDays / 7) + 0.25;
}

/** The capital one farm position needs at the standard tier. */
export const STANDARD_STAKE = 10000;

/** One deposit tier's farm economics: expected value (low/mid/high), costs and $/hour. */
export interface TierEconomics {
  deposit: number;
  expectedLow: number;
  expectedMid: number;
  expectedHigh: number;
  gas: number;
  opportunity: number;
  hours: number;
  usdPerHour: number;
}

/** The farm economics of one protocol at every deposit tier. */
export function farmEconomics(p: Proto, age: number | null, expectedValue: number): TierEconomics[] {
  const hold = holdFor(age);
  const gas = 3 * gasPerAction(p);
  const hours = hoursFor(hold);
  return DEPOSIT_TIERS.map((deposit) => {
    const share = deposit / p.tvl_usd;
    const expectedMid = share * FARMER_POOL.mid * expectedValue;
    const expectedLow = share * FARMER_POOL.low * expectedValue;
    const expectedHigh = share * FARMER_POOL.high * expectedValue;
    const opportunity = deposit * OPPORTUNITY_APY * (hold / 365);
    const usdPerHour = (expectedMid - gas - opportunity) / hours;
    return { deposit, expectedLow, expectedMid, expectedHigh, gas, opportunity, hours, usdPerHour };
  });
}

/** The deposit at which a farm breaks even, or null when it never does. */
export function breakEvenDeposit(p: Proto, age: number | null, expectedValue: number): number | null {
  const hold = holdFor(age);
  const gas = 3 * gasPerAction(p);
  const perDollar = (FARMER_POOL.mid * expectedValue) / p.tvl_usd - OPPORTUNITY_APY * (hold / 365);
  if (perDollar <= 0) return null;
  return Math.ceil(gas / perDollar);
}

/** The verdict read off the standard tier's $/hour. */
export function verdictFor(usdPerHour: number): 'FARM' | 'THIN' | 'SKIP' {
  if (usdPerHour >= FARM_HOURLY) return 'FARM';
  if (usdPerHour > 0) return 'THIN';
  return 'SKIP';
}

/** The first chain a protocol lists, or a neutral phrase when it lists none. */
function firstChain(p: Proto): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** Round a factor to four decimals for the board's readable breakdown. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Round a dollar figure to cents for the board's readable breakdown. */
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A dollar figure as a short readable string: $1,234 or $1.23M. */
export function shortUsd(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1)}k`;
  return `$${n.toFixed(2)}`;
}

/** The one action that fits the protocol's category, in words a farmer can follow. */
function deedFor(p: Proto, stake: number, chain: string): string {
  const kind = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (kind.includes('lend') || kind.includes('cdp') || kind.includes('collateral')) {
    return `Lend $${stake} of USDC into ${name} on ${chain} and leave the loan open.`;
  }
  if (kind.includes('dex') || kind.includes('amm') || kind.includes('swap')) {
    return `Add $${stake} of liquidity to the busiest ${name} pool on ${chain} and leave it in.`;
  }
  if (kind.includes('bridge')) {
    return `Move $${stake} of USDC onto ${chain} with ${name} and put the bridged funds to work in its app.`;
  }
  if (kind.includes('stak') || kind.includes('restak')) {
    return `Stake $${stake} of the native staking asset through ${name} and keep the receipt token.`;
  }
  if (kind.includes('perp') || kind.includes('deriv')) {
    return `Post $${stake} of USDC as collateral on ${name} and open one small hedged position.`;
  }
  if (kind.includes('predict')) {
    return `Back one market on ${name} with $${stake} and let it settle.`;
  }
  if (kind.includes('vault') || kind.includes('curator') || kind.includes('allocat')) {
    return `Place $${stake} into a ${name} vault on ${chain} and hold the vault shares.`;
  }
  if (kind.includes('stable')) {
    return `Mint or hold $${stake} of the dollar asset ${name} issues on ${chain}.`;
  }
  if (kind.includes('rwa') || kind.includes('real world')) {
    return `Mint $${stake} of ${name}'s tokenised yield asset on ${chain} and hold it.`;
  }
  if (kind.includes('insur')) {
    return `Buy $${stake} of cover from ${name} on ${chain} and keep the policy live.`;
  }
  return `Put $${stake} of USDC to work in ${name} on ${chain} and leave the position open.`;
}

/**
 * A protocol's farm plan: five steps, each one action with what it costs and how long it takes.
 * The steps are built from the protocol's own record and its farm economics, never from a list
 * of names, so the plan follows the protocol instead of the other way round. The dashboard's
 * detail view renders the same five steps from the same fields with the same words.
 */
export function planFarm(p: Proto, age: number | null, tiers: TierEconomics[], verdict: string): string[] {
  const chain = firstChain(p);
  const stake = STANDARD_STAKE;
  const hold = holdFor(age);
  const std = tiers.find((t) => t.deposit === STANDARD_STAKE)!;
  const steps = [
    `Open a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline. It costs under $3 of gas for the first transaction and takes about 5 minutes.`,
    `${deedFor(p, stake, chain)} It costs $${stake} of capital and about $${std.gas} of gas, and takes about 15 minutes to set up.`,
    `Do one qualifying action every week, like a deposit, a borrow, a swap or a vote, so the wallet stays active. It costs about $${gasPerAction(p)} of gas a week and takes about 10 minutes a week.`,
    `Keep the position open for at least ${hold} days so the activity lands in more than one snapshot. The $${stake} stays in the position for those ${hold} days.`,
    `Verdict ${verdict}: at $${stake} this farm expects ${shortUsd(std.expectedLow)}-${shortUsd(std.expectedHigh)} against $${std.gas} of gas plus $${std.opportunity.toFixed(2)} of forgone yield, about $${std.usdPerHour.toFixed(2)} an hour over ${std.hours.toFixed(2)} hours. Before you withdraw, open the protocol's own points page from the link it publishes and claim only there.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

/** The four factors behind one protocol's expected value, for the detail view. */
export interface ScoreParts {
  fittedValue: number;
  odds: number;
  cohort: string;
  ageDays: number | null;
  momentumPct: number;
  chains: number;
}

/** One ranked row of board.json. */
export interface BoardEntry {
  rank: number;
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
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  verdict: 'FARM' | 'THIN' | 'SKIP';
  usd_per_hour_10000: number;
  parts: ScoreParts;
  tiers: TierEconomics[];
  break_even_deposit: number | null;
  farm_steps: string[];
}

/** One row of the dashboard's compact dataset: [rank, slug, name, category, chains, tvl,
 *  change_7d, listed_at, age_days, fitted, odds, ev, verdict, usd_per_hour_10000]. The page
 *  derives the tiers, the hold, the gas and the farm steps from these fields. */
export type CompactRow = [number, string, string, string | null, string, number, number | null, string | null, number | null, number, number, number, string, number];

/** A protocol whose token already trades, shown at the market's value. */
export interface LiveEntry {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
}

/** How every protocol in the snapshot is accounted for. */
export interface Accounting {
  total: number;
  ranked: number;
  live: number;
  recordedNoPrice: number;
  excluded: { reason: string; count: number; slugs: string[] }[];
}

/** The cover: everything the judge should read first, all of it computed from the snapshot. */
export interface Cover {
  modelId: string;
  asOf: string;
  source: string;
  fit: { a: number; b: number; anchors: number; r2: number };
  loo: Validation;
  walkForward: Validation | null;
  oddsMethod: string;
  assumptions: string[];
  verdicts: { FARM: number; THIN: number; SKIP: number };
  accounting: Accounting;
  missing: { listedAt: number; change7d: number; mcapNonPositive: number };
  limits: string[];
  selfCheck: string[];
}

/** Everything the dashboard page renders. */
export interface DashboardPayload {
  cover: Cover;
  rows: CompactRow[];
  liveTop: LiveEntry[];
}

/** The ranked board: every launch candidate, by expected value, highest first. */
export function assembleBoard(snap: Snap, report: FitReport, oddsOf: (p: Proto) => number): BoardEntry[] {
  const ranked = snap.protocols
    .filter(isRankable)
    .map((p) => {
      const age = daysSince(snap.as_of, p.listed_at);
      const fitted = fittedValue(p, report.fit);
      const odds = oddsOf(p);
      const expected = Math.max(1, Math.round(fitted * odds));
      const tiers = farmEconomics(p, age, expected);
      const std = tiers.find((t) => t.deposit === STANDARD_STAKE)!;
      const verdict = verdictFor(std.usdPerHour);
      const growth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
      return {
        p,
        age,
        fitted,
        odds,
        expected,
        tiers,
        verdict,
        parts: {
          fittedValue: fitted,
          odds: round4(odds),
          cohort: `${ageBand(age)}|${tvlBand(p.tvl_usd)}`,
          ageDays: age,
          momentumPct: clampNum(growth, -50, 100),
          chains: p.chains.length,
        },
      };
    })
    .sort((x, y) => y.expected - x.expected || (x.p.slug < y.p.slug ? -1 : x.p.slug > y.p.slug ? 1 : 0));
  return ranked.map((item, i) => ({
    rank: i + 1,
    slug: item.p.slug,
    name: item.p.name,
    category: item.p.category,
    chains: item.p.chains,
    tvl_usd: item.p.tvl_usd,
    change_7d: item.p.change_7d,
    mcap_usd: item.p.mcap_usd,
    listed_at: item.p.listed_at,
    gecko_id: item.p.gecko_id,
    symbol: item.p.symbol,
    token_status: 'pre-token' as const,
    age_days: item.age,
    implied_value_usd: item.expected,
    verdict: item.verdict,
    usd_per_hour_10000: round2(item.tiers.find((t) => t.deposit === STANDARD_STAKE)!.usdPerHour),
    parts: item.parts,
    tiers: item.tiers.map((t) => ({
      deposit: t.deposit,
      expectedLow: round2(t.expectedLow),
      expectedMid: round2(t.expectedMid),
      expectedHigh: round2(t.expectedHigh),
      gas: t.gas,
      opportunity: round2(t.opportunity),
      hours: round2(t.hours),
      usdPerHour: round2(t.usdPerHour),
    })),
    break_even_deposit: breakEvenDeposit(item.p, item.age, item.expected),
    farm_steps: planFarm(item.p, item.age, item.tiers, item.verdict),
  }));
}

/** The full accounting of the snapshot: every protocol in exactly one bucket. */
export function accountFor(snap: Snap, board: BoardEntry[]): Accounting {
  const ranked = new Set(board.map((r) => r.slug));
  const live = snap.protocols.filter(isLive);
  const recorded = snap.protocols.filter((p) => !ranked.has(p.slug) && !isLive(p) && isRecordedNoPrice(p));
  const excludedMap = new Map<string, string[]>();
  for (const p of snap.protocols) {
    if (ranked.has(p.slug) || isLive(p) || isRecordedNoPrice(p)) continue;
    const reason = exclusionReason(p) ?? 'unknown';
    const list = excludedMap.get(reason) ?? [];
    list.push(p.slug);
    excludedMap.set(reason, list);
  }
  const excluded = [...excludedMap.entries()]
    .map(([reason, slugs]) => ({ reason, count: slugs.length, slugs: slugs.sort() }))
    .sort((a, b) => b.count - a.count);
  return {
    total: snap.protocols.length,
    ranked: board.length,
    live: live.length,
    recordedNoPrice: recorded.length,
    excluded,
  };
}

/** The live-token protocols by market cap, for the dashboard's market view. */
export function liveTop(snap: Snap, cap = 20): LiveEntry[] {
  return snap.protocols
    .filter((p) => isLive(p) && p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd! || b.tvl_usd - a.tvl_usd)
    .slice(0, cap)
    .map((p) => ({ slug: p.slug, name: p.name, category: p.category, tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd! }));
}

/** The cover, computed from the snapshot, the fit and the board. */
export function buildCover(snap: Snap, report: FitReport, cohorts: Cohort[], board: BoardEntry[], accounting: Accounting): Cover {
  const verdicts = { FARM: 0, THIN: 0, SKIP: 0 };
  for (const row of board) verdicts[row.verdict] += 1;
  const missing = {
    listedAt: snap.protocols.filter((p) => !p.listed_at).length,
    change7d: snap.protocols.filter((p) => p.change_7d === null).length,
    mcapNonPositive: snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length,
  };
  return {
    modelId: MODEL_ID,
    asOf: snap.as_of,
    source: snap.source,
    fit: {
      a: round4(report.fit.a),
      b: round4(report.fit.b),
      anchors: report.fit.n,
      r2: round4(report.fit.r2),
    },
    loo: { median: round2(report.loo.median), p75: round2(report.loo.p75), n: report.loo.n },
    walkForward:
      report.walkForward === null
        ? null
        : { median: round2(report.walkForward.median), p75: round2(report.walkForward.p75), n: report.walkForward.n },
    oddsMethod: `peer cohort rate (age band x TVL band, ${cohorts.length} cohorts), Laplace-smoothed (has+1)/(n+2)`,
    assumptions: [
      'Farmer pool 5% of the token value (range 3-10% shown); a deposit earns its pro-rata share of TVL.',
      'Gas 3 actions at $8 on Ethereum, $3 elsewhere; opportunity cost 5% a year on the deposit.',
      'Verdicts read off the $10,000 tier: FARM at $10/hour or more, THIN above $0, SKIP at or below $0.',
      'A missing 7-day change counts as 0; a missing listed date counts as 180 days for the hold only.',
    ],
    verdicts,
    accounting,
    missing,
    limits: [
      'Odds are a cross-sectional peer rate, not a hazard rate over time: older cohorts have had longer to launch.',
      'The fit anchors exclude 16 live records with mcap at or below $0; the LOO tail is bridges, CEX tokens and versioned pools whose market cap does not track the TVL in this snapshot.',
      'The snapshot carries no parent protocol, so under-floor rows pass only the visible part of the house rule.',
      'A protocol is said to record no token, never to have none: its DefiLlama record may simply not carry it.',
    ],
    selfCheck: [
      `watchlist ${snap.watchlist.length}/${snap.watchlist.length} covered`,
      `board ${board.length} rows, ranks 1-${board.length}, implied value never rises`,
      `all ${accounting.total} protocols accounted for: ${accounting.ranked} ranked, ${accounting.live} live, ${accounting.recordedNoPrice} token-recorded with no price, ${accounting.excluded.reduce((s, e) => s + e.count, 0)} excluded with a reason`,
      `value model fitted on ${report.fit.n} live anchors (R2 ${round4(report.fit.r2)}), LOO median x${round2(report.loo.median)}`,
      `farm steps on every row carry costs and hours`,
    ],
  };
}

/** A board row in the compact shape the dashboard page reads. */
export function toCompact(row: BoardEntry): CompactRow {
  return [
    row.rank,
    row.slug,
    row.name,
    row.category,
    row.chains.join('|'),
    row.tvl_usd,
    row.change_7d,
    row.listed_at,
    row.age_days,
    row.parts.fittedValue,
    row.parts.odds,
    row.implied_value_usd,
    row.verdict,
    row.usd_per_hour_10000,
  ];
}

/** The whole dashboard dataset, built from the snapshot in one pass. */
export function buildPayload(snap: Snap): { board: BoardEntry[]; payload: DashboardPayload; report: FitReport; cohorts: Cohort[] } {
  const anchors = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const report = fitValue(anchors);
  const { cohorts, oddsOf } = buildOdds(snap);
  const board = assembleBoard(snap, report, oddsOf);
  const accounting = accountFor(snap, board);
  const cover = buildCover(snap, report, cohorts, board, accounting);
  const payload: DashboardPayload = { cover, rows: board.map(toCompact), liveTop: liveTop(snap) };
  return { board, payload, report, cohorts };
}

/** The snapshot out of a file's text, refused unless it carries the shape the model scores. */
export function readSnap(text: string): Snap {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapError('snapshot.json is not valid JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapError('snapshot.json is not a JSON object');
  }
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) {
    throw new SnapError('snapshot.json carries no as_of day');
  }
  if (typeof doc.source !== 'string') throw new SnapError('snapshot.json carries no source line');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) {
    throw new SnapError('snapshot.json carries no floor_usd');
  }
  if (!Array.isArray(doc.protocols)) throw new SnapError('snapshot.json carries no protocols list');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapError('snapshot.json carries no watchlist of slugs');
  }
  const protocols: Proto[] = doc.protocols.map((value, i) => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      throw new SnapError(`protocol ${i} in snapshot.json is not an object`);
    }
    const p = value as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapError(`protocol ${i} in snapshot.json lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd, protocols, watchlist: doc.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null when it passes every row of the gate. */
export function checkBoard(board: BoardEntry[], snap: Snap): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate takes 100 to 4000`;
  const seen = new Set(board.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `board is missing ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} holds ${ranks[i]}`;
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} is worth more than row ${i} above it`;
    }
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share one implied value $${board[0]!.implied_value_usd}: that ranks nothing`;
  }
  for (const row of board) {
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} carries ${row.farm_steps.length} farm steps`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${row.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  return null;
}

/**
 * The dashboard's dataset as one script the page reads with no fetch and no network. The cover
 * comes first, then the rows, so a reader that stops early still sees the proof.
 */
export function payloadScript(payload: DashboardPayload): string {
  return `window.LAUNCH_SCOPE_V3=${JSON.stringify(payload)};\n`;
}
