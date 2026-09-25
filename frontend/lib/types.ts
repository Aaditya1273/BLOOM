// Types mirror docs/API.md (Bloom backend v1). Amounts are decimal strings in human units.

export type ErrorCode =
  | "RISK_BLOCKED"
  | "POLICY_REJECTED"
  | "UNSUPPORTED_ASSET"
  | "INSUFFICIENT_BALANCE"
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "TESTNET_ONLY"
  | "CHAIN_ERROR"
  | "INTERNAL";

export interface ApiErrorBody {
  error: { code: ErrorCode; message: string; details?: Record<string, unknown> };
}

// ── System
export interface Health {
  ok: boolean;
  chainId: number;
  network: string;
  block: number;
  riskEngineImpl: "stylus" | "evm-reference";
  demoMode: boolean;
}

export interface AssetConfig {
  symbol: string;
  token: string;
  decimals: number;
  kind: "STABLE" | "STOCK_TOKEN";
}

export interface Config {
  chainId: number;
  explorer: string | null;
  demoOwner?: string;
  contracts: Record<string, string>;
  assets: AssetConfig[];
}

// ── Risk
export const RISK_STATE_NAMES = [
  "NORMAL",
  "HALTED",
  "STALE",
  "DEVIATION",
  "CORP_ACTION_PAUSED",
  "SEQUENCER_DOWN",
  "INVALID_PRICE",
  "UNSUPPORTED",
] as const;
export type RiskStateName = (typeof RISK_STATE_NAMES)[number];

export interface RiskAsset {
  symbol: string;
  token: string;
  priceUsd: string;
  oracleUpdatedAt: number;
  oracleAgeSec: number;
  halted: boolean;
  corporateActionPaused: boolean;
  uiMultiplier: string;
  deviationBps: number;
  referencePriceUsd: string;
  state: number;
  stateName: RiskStateName;
  borrowingAllowed: boolean;
  liquidationAllowed: boolean;
  maxLtvBps: number;
  reason: string;
  lastReport: { observedAt: number; nonce: number | string } | null;
}

export interface RiskSnapshot {
  sequencer: { up: boolean; required: boolean; sinceSec: number };
  assets: RiskAsset[];
}

export type Scenario = "HALT" | "STALE" | "DEVIATION" | "CORP_ACTION" | "SEQUENCER_DOWN" | "RESET";

export interface SimulateResult {
  txHashes: string[];
  state: number;
  stateName: RiskStateName;
}

export interface BorrowCheck {
  borrowingAllowed: boolean;
  maxLtvBps: number;
  state: number;
  stateName: RiskStateName;
  message: string;
}

// ── Account
export interface StockHolding {
  symbol: string;
  balance: string;
  priceUsd: string;
  valueUsd: string;
  /** API doc does not pin the encoding; accept the numeric state or its name. */
  riskState: number | RiskStateName;
}

export interface Account {
  owner: string;
  account: string;
  deployed: boolean;
  usdg: { balance: string; valueUsd: string };
  savings: { shares: string; valueUsd: string; apyBps: number; earnedTodayUsd: string };
  stocks: StockHolding[];
  totalUsd: string;
  streak: { days: number; lastLessonAt: number | string | null; completedToday: boolean };
}

export interface TxResult {
  txHash: string;
}
export interface FaucetResult extends TxResult {
  amount: string;
}
export interface DepositResult extends TxResult {
  shares: string;
}
export interface InvestResult {
  steps: { label: string; txHash: string; status: string }[];
}

// ── Goals
export interface GoalParams {
  name: string;
  targetAmount: string;
  asset: "USDG";
  deadline: string;
  maxDailySpend: string;
  maxPerTx: string;
  maxStockAllocationBps: number;
  allowedAssets: string[];
}

export interface GoalCreated {
  goalId: string | number;
  txHashes: string[];
  sessionKey: string;
  expiresAt: number | string;
}

export interface Goal {
  goalId: string | number;
  name: string;
  targetAmount: string;
  progressUsd: string;
  deadline: string | number;
  maxDailySpend: string;
  spentTodayUsd: string;
  maxStockAllocationBps: number;
  allowedAssets: string[];
  active: boolean;
  agent: string;
  maxPerTx?: string;
}

// ── Chat
export type IntentAction =
  | "SEND"
  | "CREATE_GOAL"
  | "INVEST"
  | "DEPOSIT"
  | "EXPLAIN_RISK"
  | "EXPLAIN_BORROW"
  | "BALANCE"
  | "UNKNOWN";

/** `risk` cards only carry `asset` + `riskCheck`; everything else is optional. */
export interface ActionCard {
  kind: "send" | "goal" | "invest" | "deposit" | "risk";
  asset?: string;
  amount?: string;
  amountUsd?: string;
  recipient?: { name: string; address?: string; viaClaimLink: boolean };
  network?: string;
  policyCheck?: { ok: boolean; reason?: string; message: string };
  riskCheck?: { ok: boolean; state?: number | RiskStateName; message?: string };
  steps?: string[];
  goal?: GoalParams;
}

export interface ChatResponse {
  reply: string;
  intent: { action: IntentAction; [k: string]: unknown };
  card?: ActionCard;
  actionId?: string;
}

export interface ClaimSecret {
  claimId: string;
  url: string;
  code: string;
  expiresAt: number | string;
}

export interface ConfirmResult {
  status: "executed" | "rejected" | "reverted" | "sign_required";
  sign?: SignRequest["sign"];
  txHashes: string[];
  reason?: string;
  policyReason?: string;
  stateName?: RiskStateName;
  message: string;
  claim?: ClaimSecret;
  goalId?: string | number;
}

// ── Claims
export interface Claim {
  claimId: string;
  token: string;
  symbol: string;
  amount: string;
  sender: string;
  expiresAt: number | string;
  status: "OPEN" | "CLAIMED" | "EXPIRED" | "CANCELLED";
}

// ── Learn
export interface Lesson {
  id: string | number;
  title: string;
  body: string;
  quiz: { question: string; options: string[]; answerIndex?: number };
}

export interface LearnState {
  lessons: Lesson[];
  todayLessonId: string | number;
  streak: { days: number; completedToday: boolean };
}

export interface LessonResult {
  correct: boolean;
  streak: { days: number; completedToday: boolean } | number;
  reward: { amount: string; label: string } | null;
}

// ── Activity
export interface ActivityItem {
  type: string;
  title: string;
  detail: string;
  /** contact name when the counterparty is a known contact */
  counterpartyName?: string;
  txHash: string;
  blockNumber: number;
  timestamp: number | string;
}

// ── Portfolio history
export interface History {
  points: { t: number; totalUsd: number }[];
  /** Change in total value (includes deposits/withdrawals) over up to 30 days. */
  windowChangeUsd: number | null;
  windowSinceSec: number | null;
  assetChanges: Record<string, { changeBps: number | null; sinceSec: number | null }>;
}

// ── Wallet-signed owner actions
/** Returned instead of a result when the connected wallet must sign the owner transactions itself. */
export interface SignRequest {
  sign: {
    chainId: number;
    label: string;
    txs: { to: `0x${string}`; data: `0x${string}`; value: "0" }[];
    next?: "activate-goal";
  };
}
export const isSignRequest = (r: unknown): r is SignRequest => typeof r === "object" && r !== null && "sign" in r;
