"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useAccount, useSignTypedData } from "wagmi";
import { api, ApiError, onUnauthorized, setApiToken } from "@/lib/api";
import { APP_CHAIN } from "@/lib/wallet";

/**
 * Wallet sign-in (EIP-712). After a wallet connects, Bloom asks it to sign a typed challenge from the backend
 * (no transaction, no gas). The backend verifies the signature and returns a short-lived session token; every API
 * call then acts for that verified wallet. The token lives in memory + sessionStorage (cleared with the tab).
 */
export type AuthStatus = "disconnected" | "checking" | "needs-signin" | "signing" | "authenticated" | "error";
type Stored = { wallet: string; token: string; role: "user" | "admin"; expiresAt: number; chainId: number };
type AuthValue = {
  status: AuthStatus;
  wallet?: string;
  role?: "user" | "admin";
  error?: string;
  signIn: () => Promise<void>;
  signOut: () => void;
};

const KEY = "bloom.session.v1";
const AuthContext = createContext<AuthValue | null>(null);

const load = (): Stored | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const save = (s: Stored | null) => {
  try {
    if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
    else sessionStorage.removeItem(KEY);
  } catch {
    // storage unavailable: session stays in memory only
  }
};

function describe(e: unknown): string {
  const msg = String((e as { shortMessage?: string })?.shortMessage ?? (e as Error)?.message ?? "");
  if (/user rejected|user denied|rejected the request/i.test(msg)) return "You declined the sign-in request in your wallet.";
  if (e instanceof ApiError) return e.message;
  return "Sign-in failed. Please try again.";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { address, status: walletStatus } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [state, setState] = useState<Omit<AuthValue, "signIn" | "signOut">>({ status: "disconnected" });
  const inflight = useRef(false);

  const clear = useCallback((status: AuthStatus, error?: string) => {
    setApiToken(undefined);
    save(null);
    setState({ status, error });
  }, []);

  const signIn = useCallback(async () => {
    if (!address || inflight.current) return;
    inflight.current = true;
    setState({ status: "signing" });
    try {
      const challenge = await api.authNonce(address);
      // chain safety: never sign a sign-in for another network or another wallet
      if (Number(challenge.domain.chainId) !== APP_CHAIN.id || Number(challenge.message.chainId) !== APP_CHAIN.id) {
        throw new ApiError("BAD_REQUEST", `The backend is on chain ${challenge.domain.chainId}, but Bloom expects ${APP_CHAIN.name}.`);
      }
      if (challenge.message.wallet.toLowerCase() !== address.toLowerCase()) throw new ApiError("BAD_REQUEST", "Sign-in challenge is for a different wallet.");
      const signature = await signTypedDataAsync({
        domain: { ...challenge.domain, chainId: Number(challenge.domain.chainId) },
        types: challenge.types,
        primaryType: "BloomLogin",
        message: challenge.message,
      });
      const r = await api.authVerify(challenge.message, signature);
      const stored: Stored = { wallet: r.wallet, token: r.token, role: r.role, expiresAt: r.expiresAt, chainId: APP_CHAIN.id };
      save(stored);
      setApiToken(r.token);
      setState({ status: "authenticated", wallet: r.wallet, role: r.role });
    } catch (e) {
      clear("error", describe(e));
    } finally {
      inflight.current = false;
    }
  }, [address, signTypedDataAsync, clear]);

  const signOut = useCallback(() => {
    void api.authLogout().catch(() => undefined);
    clear("needs-signin");
  }, [clear]);

  // restore a stored session for this wallet (validated with the backend), otherwise ask to sign in
  // only a REAL disconnect (connected -> disconnected) ends the session; on page load wagmi briefly reports
  // "disconnected" before it reconnects, and that must not throw away a valid session
  const wasConnected = useRef(false);
  useEffect(() => {
    let cancelled = false;
    if (walletStatus !== "connected" || !address) {
      if (walletStatus === "disconnected") {
        if (wasConnected.current) {
          wasConnected.current = false;
          void api.authLogout().catch(() => undefined);
          setApiToken(undefined);
          save(null);
        }
        // eslint-disable-next-line react-hooks/set-state-in-effect -- mirrors external wallet state
        setState({ status: "disconnected" });
      }
      return;
    }
    wasConnected.current = true;
    const s = load();
    const now = Math.floor(Date.now() / 1000);
    if (s && s.wallet.toLowerCase() === address.toLowerCase() && s.chainId === APP_CHAIN.id && s.expiresAt > now + 30) {
      setApiToken(s.token);
      setState({ status: "checking" });
      api
        .authMe()
        .then((me) => !cancelled && setState({ status: "authenticated", wallet: me.wallet, role: me.role }))
        .catch(() => !cancelled && clear("needs-signin"));
    } else {
      setApiToken(undefined);
      save(null);
      setState({ status: "needs-signin" });
    }
    return () => {
      cancelled = true;
    };
  }, [address, walletStatus, clear]);

  // any 401 from the API (session expired / backend restarted) -> sign in again
  useEffect(() => onUnauthorized(() => clear("needs-signin", "Your session ended. Sign in again to continue.")), [clear]);

  return <AuthContext.Provider value={{ ...state, signIn, signOut }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const v = useContext(AuthContext);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
