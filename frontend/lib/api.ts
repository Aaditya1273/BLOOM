import type {
  Account,
  ActivityItem,
  ApiErrorBody,
  AuthChallenge,
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

// Production default is same-origin ("/api/..." behind your reverse proxy). Set NEXT_PUBLIC_API_URL to point elsewhere.
// Only local development falls back to the local backend.
export const API_URL = (process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3001")).replace(/\/$/, "");

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

/** Session token from wallet sign-in (see hooks/use-auth). The backend derives the wallet from it. */
let authToken: string | undefined;
export function setApiToken(token: string | undefined) {
  authToken = token;
}
let unauthorizedHandler: (() => void) | undefined;
/** Called when an authenticated request gets 401 (expired session). Returns an unsubscribe function. */
export function onUnauthorized(fn: () => void) {
  unauthorizedHandler = fn;
  return () => {
    if (unauthorizedHandler === fn) unauthorizedHandler = undefined;
  };
}

async function request<T>(path: string, body?: unknown): Promise<T> {
  let res: Response;
  const url = `${API_URL}${path}`;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  try {
    res = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    if ((e as Error)?.name === "TimeoutError") throw new ApiError("NETWORK", "Bloom is taking too long to respond. The network may be busy; please try again.");
    throw new ApiError("NETWORK", "We can't reach Bloom right now. Check that the backend is running and try again.");
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data as ApiErrorBody | null)?.error;
    if (res.status === 401 && authToken) unauthorizedHandler?.();
    throw new ApiError(err?.code ?? "INTERNAL", err?.message ?? `Request failed (${res.status}).`, res.status, err?.details);
  }
  return data as T;
}

const enc = encodeURIComponent;

// Identity comes from the session token (wallet sign-in); requests never carry an owner field.
export const api = {
  health: () => request<Health>("/api/health"),
  authNonce: (wallet: string) => request<AuthChallenge>(`/api/auth/nonce?wallet=${encodeURIComponent(wallet)}`),
  authVerify: (message: AuthChallenge["message"], signature: string) =>
    request<{ token: string; wallet: string; role: "user" | "admin"; expiresAt: number }>("/api/auth/verify", { message, signature }),
  authMe: () => request<{ wallet: string; role: "user" | "admin" }>("/api/auth/me"),
  authLogout: () => request<{ ok: true }>("/api/auth/logout", {}),
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
  // the claim is paid to the signed-in wallet
  redeem: (id: string, code: string) => request<TxResult>(`/api/claims/${enc(id)}/redeem`, { code }),

  learn: () => request<LearnState>("/api/learn"),
  completeLesson: (lessonId: string | number, answerIndex: number) =>
    request<LessonResult>("/api/learn/complete", { lessonId, answerIndex }),

  activity: () => request<ActivityItem[]>("/api/activity"),
};
