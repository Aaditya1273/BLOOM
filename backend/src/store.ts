// Tiny JSON file store for runtime demo data (backend/data/*.json, gitignored).
// ponytail: whole-file rewrite per update, fine for a demo; use a DB if this sees real traffic.
import { accessSync, constants, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, LOCAL, chainId, deployment } from "./ctx.ts";

mkdirSync(DATA_DIR, { recursive: true });
// fail at startup, not on the first faucet/claim write (e.g. a hosting disk mounted read-only or root-owned)
try {
  accessSync(DATA_DIR, constants.W_OK);
} catch {
  throw new Error(`BLOOM_DATA_DIR ${DATA_DIR} is not writable by this process`);
}

export function jsonStore<T>(name: string, initial: T) {
  // one file per chain: a local chain's data must never mix with testnet data (faucet ledger, claims, history)
  // (a restarted Hardhat node redeploys to the SAME addresses, so local files are tied to the deploy time instead)
  const scope = LOCAL ? `${chainId}-${String(deployment.deployedAt ?? "").replace(/\D/g, "")}` : String(chainId);
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
