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
  SignRequest,
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

/** The connected wallet (set by the app shell). Every request acts for this owner's Bloom wallet. */
let currentOwner: string | undefined;
export function setApiOwner(owner: string | undefined) {
  currentOwner = owner;
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  let url = `${API_URL}${path}`;
  let payload = body;
  if (currentOwner) {
    if (body === undefined) url += `${path.includes("?") ? "&" : "?"}owner=${encodeURIComponent(currentOwner)}`;
    else payload = { ...(body as Record<string, unknown>), owner: currentOwner };
  }
  try {
    res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: payload === undefined ? undefined : JSON.stringify(payload),
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

// `owner` is added automatically for the connected wallet (see setApiOwner).
export const api = {
  health: () => request<Health>("/api/health"),
  config: () => request<Config>("/api/config"),

  account: () => request<Account>("/api/account"),
  history: () => request<History>("/api/account/history"),
  faucet: () => request<FaucetResult>("/api/faucet", {}),
  deposit: (amount: string) => request<DepositResult | SignRequest>("/api/deposit", { amount }),
  invest: (amount: string, allocation?: { symbol: string; bps: number }[]) =>
    request<InvestResult | SignRequest>("/api/invest", { amount, allocation }),

  previewGoal: (text: string) => request<{ goal: GoalParams }>("/api/goals/preview", { text }),
  createGoal: (goal: GoalParams) => request<GoalCreated | SignRequest>("/api/goals", { goal }),
  activateGoal: (txHash: string) => request<SignRequest & { goalId: string; sessionKey: string }>("/api/goals/activate", { txHash }),
  goals: () => request<Goal[]>("/api/goals"),
  revokeGoal: (id: string | number) => request<TxResult | SignRequest>(`/api/goals/${enc(String(id))}/revoke`, {}),

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
