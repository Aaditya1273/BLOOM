import { readFileSync } from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { NextConfig } from "next";

// The repo keeps one env file at the root (.env.local, then .env). Read ONLY the public values the frontend needs;
// secrets in that file (e.g. PRIVATE_KEY) are never loaded into the frontend process.
const PUBLIC_KEYS = ["NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID", "WALLET_CONNECT_PROJECT_ID", "NEXT_PUBLIC_CHAIN_ID"];
const rootEnv: Record<string, string> = {};
for (const file of [".env", ".env.local"]) {
  try {
    const parsed = parseEnv(readFileSync(path.resolve(process.cwd(), "..", file), "utf8"));
    for (const k of PUBLIC_KEYS) if (parsed[k]) rootEnv[k] = parsed[k]; // .env.local wins
  } catch {
    // file is optional
  }
}
const pub = (k: string) => process.env[k] || rootEnv[k];

const nextConfig: NextConfig = {
  // Only public, non-secret values are exposed to the browser.
  env: {
    NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: pub("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID") || pub("WALLET_CONNECT_PROJECT_ID") || "",
    NEXT_PUBLIC_CHAIN_ID: pub("NEXT_PUBLIC_CHAIN_ID") || "46630",
  },
};

export default nextConfig;
