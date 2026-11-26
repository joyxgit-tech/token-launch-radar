// Valuation Model and Farm Strategy Engine for Token Launch Radar v2.0
// Evaluates raw protocol metrics from DefiLlama snapshots, filters pre-token candidates,
// and derives mathematical implied token valuations and structured farming playbooks.

/** Represents a single protocol entry from the sealed snapshot data structure. */
export interface SnapshotProtocol {
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

/** Complete snapshot file payload format. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** Configurable model coefficients determining base multiples and curve slopes. */
export interface ModelConstants {
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  unknown_age_days: number;
}

/** Standard house valuation model coefficients. */
export const MODEL: ModelConstants = {
  base_multiple: 0.25,
  growth_weight: 0.5,
  growth_floor: -60,
  growth_cap: 120,
  maturity_floor: 0.6,
  maturity_range: 0.4,
  maturity_days: 1095,
  unknown_age_days: 365,
};

/** Engine version identifier published in metadata and dossiers. */
export const MODEL_VERSION = 'radar-2.0';

/** Maximum number of pre-token protocols below watchlist floor included in ranking. */
export const EARLY_ROWS = 160;

/** Top live token protocols included as valuation comps. */
export const LIVE_ROWS = 24;

/** Step definition for farming playbook actions. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** Final output row schema for board.json. */
export interface BoardRow {
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
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** Compact row representation packaged into data.js for web dashboard. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
}

/** Live token comparative record. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Complete bundle packaged for browser execution. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Error thrown when parsing invalid or malformed snapshot JSON. */
export class SnapshotError extends Error {
  constructor(reasonMessage: string) {
    super(reasonMessage);
    this.name = 'SnapshotError';
  }
}

const MILLISECONDS_IN_DAY = 86_400_000;

function safeNumber(candidate: unknown, fallbackValue: number): number {
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : fallbackValue;
}

const precision4 = (val: number): number => Math.round(val * 1e4) / 1e4;

/** Computes whole days between snapshot date and protocol listing date. */
export function ageDays(asOfDate: string, listedAtDate: string | null): number | null {
  if (listedAtDate === null) return null;
  const timeA = Date.parse(`${asOfDate}T00:00:00Z`);
  const timeB = Date.parse(`${listedAtDate}T00:00:00Z`);
  if (!Number.isFinite(timeA) || !Number.isFinite(timeB)) return null;
  return Math.max(0, Math.floor((timeA - timeB) / MILLISECONDS_IN_DAY));
}

/** Evaluates protocol valuation using growth trajectory and maturity curves. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants
): { implied: number; growthPct: number; growthMult: number; maturityMult: number; age: number | null } {
  const age = ageDays(asOf, protocol.listed_at);
  const rawGrowth = safeNumber(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const effectiveAge = age ?? model.unknown_age_days;
  const clampedAge = Math.min(Math.max(effectiveAge, 0), model.maturity_days);
  const maturityMult = model.maturity_floor + (clampedAge / model.maturity_days) * model.maturity_range;
  const baseTvlValue = protocol.tvl_usd * model.base_multiple;
  const implied = Math.max(1, Math.round(baseTvlValue * growthMult * maturityMult));
  return { implied, growthPct, growthMult, maturityMult, age };
}

/** Regex matching version indicators (e.g., V2, v3.0) indicating derivative pools. */
const POOL_VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Determines if a protocol does not yet have an active token on record. */
export function isPreToken(protocol: SnapshotProtocol): boolean {
  return protocol.mcap_usd === null && protocol.gecko_id === null && protocol.symbol === null;
}

/** Checks whether protocol meets eligibility criteria for ranking. */
export function isRankable(protocol: SnapshotProtocol): boolean {
  return isPreToken(protocol) && protocol.category !== 'CEX' && !POOL_VERSION_MARKER.test(protocol.name);
}

function indexProtocolsBySlug(list: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const index = new Map<string, SnapshotProtocol>();
  for (const item of list) index.set(item.slug, item);
  return index;
}

export interface BoardSummary {
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
}

/** Builds the comprehensive ranked leaderboard from snapshot data. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const slugIndex = indexProtocolsBySlug(snapshot.protocols);
  const selectedProtocols = new Map<string, SnapshotProtocol>();

  // Ensure mandatory inclusion of every watchlist protocol
  for (const slug of snapshot.watchlist) {
    const entry = slugIndex.get(slug);
    if (entry !== undefined) selectedProtocols.set(slug, entry);
  }

  // Identify high-potential sub-floor pre-token protocols
  const subFloorProtocols = snapshot.protocols
    .filter((p) => !selectedProtocols.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, EARLY_ROWS);

  for (const earlyEntry of subFloorProtocols) {
    selectedProtocols.set(earlyEntry.slug, earlyEntry);
  }

  // Calculate valuations and score multipliers
  const scoredEntries = [...selectedProtocols.values()].map((protocol) => {
    const result = impliedValue(protocol, snapshot.as_of, model);
    return { protocol, ...result };
  });

  // Sort descending by implied valuation with deterministic tie-breaking on slug
  scoredEntries.sort((a, b) => b.implied - a.implied || (a.protocol.slug < b.protocol.slug ? -1 : a.protocol.slug > b.protocol.slug ? 1 : 0));

  return scoredEntries.map((item, index) => ({
    rank: index + 1,
    slug: item.protocol.slug,
    name: item.protocol.name,
    category: item.protocol.category,
    chains: item.protocol.chains,
    tvl_usd: item.protocol.tvl_usd,
    change_7d: item.protocol.change_7d,
    mcap_usd: item.protocol.mcap_usd,
    listed_at: item.protocol.listed_at,
    gecko_id: item.protocol.gecko_id,
    symbol: item.protocol.symbol,
    token_status: 'pre-token',
    age_days: item.age,
    implied_value_usd: item.implied,
    model: {
      base_multiple: model.base_multiple,
      growth_pct: item.growthPct,
      growth_multiplier: precision4(item.growthMult),
      maturity_multiplier: precision4(item.maturityMult),
      age_days: item.age,
    },
    farm_steps: farmSteps(item.protocol, item.age).map(stepText),
  }));
}

/** Serializes a farm playbook step into bounded string conforming to gate checks (20..600 chars). */
export function stepText(step: FarmStep): string {
  let formatted = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (formatted.length > 600) formatted = `${formatted.slice(0, 596)}...`;
  if (formatted.length < 20) formatted = `${formatted} Hold the position and check the protocol's own page.`;
  return formatted;
}

function resolvePrimaryChain(protocol: SnapshotProtocol): string {
  return protocol.chains.length > 0 ? protocol.chains[0]! : 'its main chain';
}

function calculateCapitalRequirement(protocol: SnapshotProtocol): number {
  if (protocol.tvl_usd >= 5_000_000_000) return 250;
  if (protocol.tvl_usd >= 1_000_000_000) return 150;
  if (protocol.tvl_usd >= 100_000_000) return 100;
  return 50;
}

function determineRetentionDays(protocolAgeDays: number | null): number {
  if (protocolAgeDays === null) return 30;
  if (protocolAgeDays < 180) return 60;
  if (protocolAgeDays < 365) return 45;
  return 30;
}

function deriveActionInstruction(protocol: SnapshotProtocol, capital: number, networkName: string): string {
  const cat = (protocol.category ?? '').toLowerCase();
  const name = protocol.name;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) {
    return `Supply $${capital} of USDC to ${name} on ${networkName} and keep the position open.`;
  }
  if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) {
    return `Provide $${capital} of liquidity to ${name}'s main pool on ${networkName} and keep the position open.`;
  }
  if (cat.includes('bridge')) {
    return `Bridge $${capital} of USDC to ${networkName} through ${name} and use the bridged funds in its app.`;
  }
  if (cat.includes('staking') || cat.includes('restak')) {
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  }
  if (cat.includes('perpetual') || cat.includes('derivative')) {
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  }
  if (cat.includes('prediction')) {
    return `Fund $${capital} and place one market position on ${name}.`;
  }
  if (cat.includes('curator') || cat.includes('allocator')) {
    return `Deposit $${capital} into a ${name} vault on ${networkName} and keep the shares.`;
  }
  if (cat.includes('stable')) {
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${networkName}.`;
  }
  if (cat.includes('rwa')) {
    return `Mint $${capital} of the protocol's yield asset on ${networkName} and hold it.`;
  }
  if (cat.includes('insurance')) {
    return `Buy $${capital} of cover from ${name} on ${networkName} and keep the policy.`;
  }
  return `Deposit $${capital} of USDC into ${name} on ${networkName} and keep the position open.`;
}

/** Generates deterministic 6-step actionable farming playbook for an eligible protocol. */
export function farmSteps(protocol: SnapshotProtocol, protocolAgeDays: number | null): FarmStep[] {
  const chainName = resolvePrimaryChain(protocol);
  const capitalAmount = calculateCapitalRequirement(protocol);
  const holdingDays = determineRetentionDays(protocolAgeDays);
  const coreAction = deriveActionInstruction(protocol, capitalAmount, chainName);

  return [
    {
      text: 'Use a dedicated, clean farming wallet holding only target capital, with no prior token approvals or smart contract permissions.',
      cost: 'under $3 of network fee for setup',
      time: '5 minutes',
    },
    {
      text: coreAction,
      cost: `$${capitalAmount} of capital and about $${capitalAmount >= 150 ? 8 : 4} in network fees`,
      time: '15 minutes initial allocation',
    },
    {
      text: 'Maintain regular on-chain interaction weekly, such as compounding yields, rebalancing debt ratios, or participating in DAO governance votes.',
      cost: 'about $2 of network fees a week',
      time: '10 minutes weekly',
    },
    {
      text: `Hold the position continuously for at least ${holdingDays} days to ensure activity spans multiple qualifying snapshot blocks.`,
      cost: `the $${capitalAmount} allocation stays deposited`,
      time: `${holdingDays} days retention window`,
    },
    {
      text: 'Monitor official project communication channels for distribution announcements; verify claim contracts exclusively on-chain to avoid phishing.',
      cost: 'no check fee; never approve untrusted claim links',
      time: '10 minutes review',
    },
    {
      text: 'Record transaction hashes, deposit dates, and protocol endpoints in an offline log to track qualifying volume and unwind capital smoothly.',
      cost: 'zero cost',
      time: '5 minutes record keeping',
    },
  ];
}

/** Compiles traded token benchmark set from snapshot data. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((protocol) => !isPreToken(protocol) && protocol.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** Formats a board row for lightweight embedding into data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
  };
}

/** Full bundle generation for main entrypoint. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const earlyCount = board.filter((entry) => !snapshot.watchlist.includes(entry.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: earlyCount,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** Parses raw JSON text into structured Snapshot with strict schema validation. */
export function parseSnapshot(jsonText: string): Snapshot {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const rootObj = parsed as Record<string, unknown>;
  if (typeof rootObj.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(rootObj.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof rootObj.source !== 'string') {
    throw new SnapshotError('snapshot.json has no source');
  }
  if (typeof rootObj.floor_usd !== 'number' || !Number.isSafeInteger(rootObj.floor_usd) || rootObj.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(rootObj.protocols)) {
    throw new SnapshotError('snapshot.json has no protocols array');
  }
  if (!Array.isArray(rootObj.watchlist) || rootObj.watchlist.some((slug) => typeof slug !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }

  const protocols = rootObj.protocols.map((val, idx) => {
    if (typeof val !== 'object' || val === null || Array.isArray(val)) {
      throw new SnapshotError(`snapshot.json's protocol ${idx} is not an object`);
    }
    const item = val as Record<string, unknown>;
    if (typeof item.slug !== 'string' || typeof item.name !== 'string' || typeof item.tvl_usd !== 'number' || !Number.isFinite(item.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${idx} lacks a slug, a name or a TVL`);
    }
    return {
      slug: item.slug,
      name: item.name,
      category: typeof item.category === 'string' ? item.category : null,
      chains: Array.isArray(item.chains) ? item.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: item.tvl_usd,
      change_7d: typeof item.change_7d === 'number' && Number.isFinite(item.change_7d) ? item.change_7d : null,
      mcap_usd: typeof item.mcap_usd === 'number' && Number.isFinite(item.mcap_usd) ? item.mcap_usd : null,
      listed_at: typeof item.listed_at === 'string' ? item.listed_at : null,
      gecko_id: typeof item.gecko_id === 'string' ? item.gecko_id : null,
      symbol: typeof item.symbol === 'string' ? item.symbol : null,
    };
  });

  return {
    as_of: rootObj.as_of,
    source: rootObj.source,
    floor_usd: rootObj.floor_usd,
    protocols,
    watchlist: rootObj.watchlist as string[],
  };
}

/** Validates generated board rows against gate integrity rules. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugSet = new Set(board.map((r) => r.slug));
  const missingWatchlist = snapshot.watchlist.filter((s) => !slugSet.has(s));
  if (missingWatchlist.length > 0) {
    return `the board misses ${missingWatchlist.length} watchlist slug${missingWatchlist.length === 1 ? '' : 's'}: ${missingWatchlist.slice(0, 5).join(', ')}`;
  }

  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }

  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `row ${i + 1} outranks row ${i} on implied value`;
    }
  }

  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }

  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${row.slug} has ${steps.length} farm steps`;
    for (const step of steps) {
      if (step.length < 20 || step.length > 600) return `${row.slug} has a farm step of ${step.length} characters`;
    }
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has implied value ${row.implied_value_usd}`;
    }
  }

  return null;
}

/** Generates data.js script content embedding the complete radar payload. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
