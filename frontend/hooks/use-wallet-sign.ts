"use client";

import { useCallback } from "react";
import { useAccount, useConfig, useSwitchChain, useSendTransaction } from "wagmi";
import { waitForTransactionReceipt } from "wagmi/actions";
import { api, ApiError } from "@/lib/api";
import { isSignRequest, type SignRequest } from "@/lib/types";
import { APP_CHAIN } from "@/lib/wallet";

/**
 * Completes owner actions with the connected wallet. When the backend returns a SignRequest (it never holds user keys),
 * this switches to the app chain if needed, has the wallet sign each transaction in order and waits for confirmation.
 * Goal creation continues with the agent-activation transaction once the new goal id is known.
 */
export function useWalletSign() {
  const config = useConfig();
  const { chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { sendTransactionAsync } = useSendTransaction();

  const signAll = useCallback(
    async (req: SignRequest): Promise<string[]> => {
      const target = req.sign.chainId;
      // chain safety: only ever sign for the chain this app is configured for, never silently for another
      if (target !== APP_CHAIN.id) throw new ApiError("CHAIN_ERROR", `Refusing to sign for chain ${target}: Bloom runs on ${APP_CHAIN.name}.`, 0);
      if (chainId !== target) await switchChainAsync({ chainId: target });
      const hashes: string[] = [];
      for (const tx of req.sign.txs) {
        const hash = await sendTransactionAsync({ to: tx.to, data: tx.data, value: 0n, chainId: target });
        // bounded, so a stalled RPC can't leave the UI "confirming" forever
        const rc = await waitForTransactionReceipt(config, { hash, chainId: target, timeout: 120_000 });
        if (rc.status !== "success") throw new ApiError("CHAIN_ERROR", "The transaction reverted onchain.", 0);
        hashes.push(hash);
      }
      return hashes;
    },
    [chainId, config, sendTransactionAsync, switchChainAsync],
  );

  /** Pass any owner-action response through this. Returns tx hashes for signed flows, or null if nothing to sign. */
  const complete = useCallback(
    async (res: unknown): Promise<{ txHashes: string[]; goalId?: string; sessionKey?: string } | null> => {
      if (!isSignRequest(res)) return null;
      const txHashes = await signAll(res);
      if (res.sign.next === "activate-goal") {
        const activation = await api.activateGoal(txHashes[txHashes.length - 1]);
        txHashes.push(...(await signAll(activation)));
        return { txHashes, goalId: activation.goalId, sessionKey: activation.sessionKey };
      }
      return { txHashes };
    },
    [signAll],
  );

  return { complete };
}
