"use client";

import { useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { api } from "@/lib/api";
import { useAuth } from "@/hooks/use-auth";
import type { Claim } from "@/lib/types";
import { errorMessage, kindFromError, num, shortDate, shortHash, usd, type ResultKind } from "@/lib/format";
import { BloomCard } from "./card";
import { BloomButton } from "./button";
import { ActionResult, Details } from "./states";

const CLOSED: Record<Exclude<Claim["status"], "OPEN">, string> = {
  CLAIMED: "This claim has already been claimed.",
  EXPIRED: "This claim has expired.",
  CANCELLED: "This claim was cancelled by the sender.",
};

const input = "h-12 w-full rounded-control border border-line bg-cream px-4 outline-none transition-colors focus:border-ink disabled:opacity-60";

/** Recipient view of a claim link. The asset is paid to the connected, signed-in wallet (never a typed address). */
export function ClaimCard({ claim, priceUsd, onClaimed }: { claim: Claim; priceUsd?: number; onClaimed?: () => void }) {
  const auth = useAuth();
  const { openConnectModal } = useConnectModal();
  const [code, setCode] = useState("");
  const [result, setResult] = useState<{ kind: ResultKind; message?: string; txHash?: string } | null>(null);
  const signedIn = auth.status === "authenticated";
  const validCode = /^\d{6}$/.test(code);
  const pending = result?.kind === "pending";
  const done = result?.kind === "success";
  const valueUsd = priceUsd ? Number(claim.amount) * priceUsd : null;
  const closed = claim.status !== "OPEN" && !done;

  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (!signedIn || !validCode || pending || done) return;
    setResult({ kind: "pending" });
    try {
      const r = await api.redeem(claim.claimId, code);
      setResult({ kind: "success", txHash: r.txHash });
      onClaimed?.();
    } catch (err) {
      setResult({ kind: kindFromError(err), message: errorMessage(err) });
    }
  }

  return (
    <BloomCard className="p-6 sm:p-10">
      <p className="text-[17px] text-muted">Someone sent you</p>
      <p className="display mt-3 text-5xl sm:text-6xl">
        {num(claim.amount, 6)} <span className="text-ink/45">{claim.symbol}</span>
      </p>
      <p className="mt-3 text-[17px] text-muted">
        {valueUsd !== null && <span className="tabular text-ink">≈ {usd(valueUsd)} today · </span>}
        through Bloom.
      </p>

      {closed ? (
        <p role="status" className="mt-8 rounded-control bg-sunken/70 p-4 font-medium">
          {CLOSED[claim.status as keyof typeof CLOSED]}
        </p>
      ) : (
        <form onSubmit={redeem} className="mt-8 space-y-4">
          <div className="rounded-control bg-sunken/60 p-4 text-sm">
            <p className="font-medium">Paid to your connected wallet</p>
            {signedIn ? (
              <p className="mt-0.5 font-mono text-xs text-muted">{auth.wallet}</p>
            ) : auth.status === "disconnected" ? (
              <button type="button" onClick={openConnectModal} className="mt-2 font-medium text-ink underline underline-offset-4">
                Connect a wallet to claim
              </button>
            ) : (
              <>
                {auth.error && <p className="mt-1 text-danger-text">{auth.error}</p>}
                <button type="button" onClick={() => void auth.signIn()} disabled={auth.status === "signing"} className="mt-2 font-medium text-ink underline underline-offset-4">
                  {auth.status === "signing" ? "Check your wallet…" : "Sign in with your wallet to claim"}
                </button>
              </>
            )}
          </div>
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium">6-digit code</span>
            <input
              className={`${input} tabular text-center text-2xl font-semibold tracking-[0.4em]`}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="••••••"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              disabled={done}
            />
            <span className="mt-1.5 block text-sm text-muted">The sender shared this code with you separately.</span>
          </label>
          {result && result.kind !== "pending" && !done && <ActionResult kind={result.kind} message={result.message} />}
          {done && (
            <p role="status" className="font-medium">
              Claimed. The {claim.symbol} is on its way to your wallet.
            </p>
          )}
          <BloomButton type="submit" size="lg" className="w-full" disabled={!signedIn || !validCode} loading={pending} success={done && "Claimed"}>
            {pending ? "Claiming…" : "Claim asset"}
          </BloomButton>
        </form>
      )}

      <dl className="mt-8 divide-y divide-line border-t border-line text-sm">
        {[
          ["Network", "Robinhood Chain"],
          ["Asset", `${claim.symbol} · Robinhood Stock Token`],
          ["Amount", `${num(claim.amount, 6)} ${claim.symbol}`],
          ...(claim.status === "OPEN" ? [["Expires", shortDate(claim.expiresAt)]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3">
            <dt className="text-muted">{k}</dt>
            <dd className="text-right">{v}</dd>
          </div>
        ))}
      </dl>
      <Details summary="Details" txHashes={result?.txHash ? [result.txHash] : []} className="mt-2">
        <div className="flex justify-between gap-3">
          <span className="text-xs">From</span>
          <span className="font-mono text-xs text-ink">A Bloom user · {shortHash(claim.sender)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-xs">Claim ID</span>
          <span className="font-mono text-xs text-ink">{shortHash(claim.claimId)}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-xs">Token</span>
          <span className="font-mono text-xs text-ink">{shortHash(claim.token)}</span>
        </div>
      </Details>
      <p className="mt-6 text-xs leading-relaxed text-muted">
        Robinhood Stock Tokens provide economic exposure to the underlying equity. Availability is jurisdiction-dependent. Testnet demo.
      </p>
    </BloomCard>
  );
}
