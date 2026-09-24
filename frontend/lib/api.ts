import type {
  Account,
  ActivityItem,
  ApiErrorBody,
  BorrowCheck,
  ChatResponse,
  Claim,
  Config,
  ConfirmResult,
  DepositResult,
  ErrorCode,
  FaucetResult,
  Goal,
  GoalCreated,
  GoalParams,
  Health,
  History,
  InvestResult,
  LearnState,
  LessonResult,
  RiskSnapshot,
  Scenario,
  SimulateResult,
  TxResult,
} from "./types";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001").replace(/\/$/, "");

/** Thrown for any failed call. `code` is "NETWORK" when the backend could not be reached. */
export class ApiError extends Error {
  constructor(
    public code: ErrorCode | "NETWORK",
    message: string,
    public status = 0,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
  } catch {
    throw new ApiError("NETWORK", "We can't reach Bloom right now. Check that the backend is running and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? `Request failed (${res.status}).`, res.status, err?.details);
  }
  return data as T;
}

const enc = encodeURIComponent;

// Every `owner` is optional: the backend defaults to its testnet demo owner.
export const api = {
  health: () => request<Health>("/api/health"),
  config: () => request<Config>("/api/config"),

  account: () => request<Account>("/api/account"),
  history: () => request<History>("/api/account/history"),
  faucet: () => request<FaucetResult>("/api/faucet", {}),
  deposit: (amount: string) => request<DepositResult>("/api/deposit", { amount }),
  invest: (amount: string, allocation?: { symbol: string; bps: number }[]) =>
    request<InvestResult>("/api/invest", { amount, allocation }),

  previewGoal: (text: string) => request<{ goal: GoalParams }>("/api/goals/preview", { text }),
  createGoal: (goal: GoalParams) => request<GoalCreated>("/api/goals", { goal }),
  goals: () => request<Goal[]>("/api/goals"),
  revokeGoal: (id: string | number) => request<TxResult>(`/api/goals/${enc(String(id))}/revoke`, {}),

  chat: (message: string) => request<ChatResponse>("/api/chat", { message }),
  confirm: (actionId: string) => request<ConfirmResult>("/api/chat/confirm", { actionId }),

  risk: () => request<RiskSnapshot>("/api/risk"),
  simulate: (symbol: string, scenario: Scenario) =>
    request<SimulateResult>("/api/risk/simulate", { symbol, scenario }),
  borrowCheck: (symbol: string) => request<BorrowCheck>(`/api/risk/borrow-check?symbol=${enc(symbol)}`),

  claim: (id: string) => request<Claim>(`/api/claims/${enc(id)}`),
  redeem: (id: string, recipient: string, code: string) =>
    request<TxResult>(`/api/claims/${enc(id)}/redeem`, { recipient, code }),

  learn: () => request<LearnState>("/api/learn"),
  completeLesson: (lessonId: string | number, answerIndex: number) =>
    request<LessonResult>("/api/learn/complete", { lessonId, answerIndex }),

  activity: () => request<ActivityItem[]>("/api/activity"),
};
