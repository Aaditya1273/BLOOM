"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Config } from "@/lib/types";

/**
 * Minimal fetch hook. `fn` must be stable (e.g. a method of `api`).
 * With `intervalMs`, keeps polling; the last good data is kept on transient errors.
 */
export function useQuery<T>(fn: () => Promise<T>, intervalMs?: number) {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const d = await fn();
      setData(d);
      setError(null);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [fn]);

  useEffect(() => {
    // Initial fetch; all state updates happen after the awaited request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    if (!intervalMs) return;
    const id = setInterval(load, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);

  return { data, error, loading, reload: load, setData };
}

let configPromise: Promise<Config> | null = null;
const getConfig = () => {
  configPromise ??= api.config().catch((e) => {
    configPromise = null; // allow retry
    throw e;
  });
  return configPromise;
};

export function useConfig() {
  return useQuery(getConfig).data;
}

export const MAINNET_CHAIN_ID = 4663;
