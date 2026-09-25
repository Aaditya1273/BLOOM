// Tiny JSON file store for runtime demo data (backend/data/*.json, gitignored).
// ponytail: whole-file rewrite per update, fine for a demo; use a DB if this sees real traffic.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, chainId } from "./ctx.ts";

mkdirSync(DATA_DIR, { recursive: true });

export function jsonStore<T>(name: string, initial: T) {
  // one file per chain: a local chain's data must never mix with testnet data (faucet ledger, claims, history)
  const file = join(DATA_DIR, `${name}.${chainId}.json`);
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
