// Tiny JSON file store for runtime demo data (backend/data/*.json, gitignored).
// ponytail: whole-file rewrite per update, fine for a demo; use a DB if this sees real traffic.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, LOCAL, addr, chainId } from "./ctx.ts";

mkdirSync(DATA_DIR, { recursive: true });

export function jsonStore<T>(name: string, initial: T) {
  // one file per chain: a local chain's data must never mix with testnet data (faucet ledger, claims, history)
  // (a local Hardhat chain restarts from scratch, so its files are also tied to the deployment)
  const scope = LOCAL ? `${chainId}-${addr.BloomVault.slice(2, 10).toLowerCase()}` : String(chainId);
  const file = join(DATA_DIR, `${name}.${scope}.json`);
  const legacy = join(DATA_DIR, `${name}.json`); // pre-scoping files belong to the testnet deployment
  let data: T;
  try {
    data = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    try {
      data = chainId === 46630 ? JSON.parse(readFileSync(legacy, "utf8")) : initial;
    } catch {
      data = initial;
    }
  }
  return {
    get: (): T => data,
    update(fn: (d: T) => void): T {
      fn(data);
      writeFileSync(file + ".tmp", JSON.stringify(data, null, 2));
      renameSync(file + ".tmp", file);
      return data;
    },
  };
}
