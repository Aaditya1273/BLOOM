// End-to-end check of the connected-wallet flow against a running backend (testnet or local).
// A throwaway wallet plays the RainbowKit user: the backend never holds its key, so every owner action comes back as a
// sign request that this script signs, exactly like the frontend's useWalletSign hook.
//   BLOOM_DEPLOYMENT=robinhood-testnet node scripts/wallet-flow-smoke.ts
// The testnet FAUCET key (which already sponsors new Bloom users) funds the throwaway wallet with a little gas.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { FetchRequest, JsonRpcProvider, Wallet, parseEther, formatEther } from "ethers";
import { installFetchTransport } from "../../offchain/ethers-fetch.ts";

installFetchTransport(FetchRequest);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
dotenv.config({ path: join(ROOT, ".env.local"), quiet: true });
dotenv.config({ path: join(ROOT, ".env"), quiet: true });
const API = process.env.API_URL ?? "http://localhost:3001";
const dep = JSON.parse(readFileSync(join(ROOT, "deployments", `${process.env.BLOOM_DEPLOYMENT ?? "localhost"}.json`), "utf8"));
const rpc = dep.chainId === 31337 ? "http://127.0.0.1:8545" : process.env.RH_TESTNET_RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const provider = new JsonRpcProvider(rpc, dep.chainId, { staticNetwork: true, cacheTimeout: -1 }); // no cached nonces between fast sends
// local chain: public Hardhat dev account #0 (like the backend); testnet: the faucet key
const rawKey = dep.chainId === 31337 ? "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" : process.env.FAUCET_PRIVATE_KEY;
if (!rawKey) throw new Error("Set FAUCET_PRIVATE_KEY (testnet gas sponsor) to fund the test wallet");
const funder = new Wallet(rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`, provider);
const user = Wallet.createRandom().connect(provider);

let n = 0;
let token = "";
const ok = (label: string, detail = "") => console.log(`✔ ${String(++n).padStart(2)} ${label}${detail ? `  — ${detail}` : ""}`);
async function call(path: string, body?: object) {
  // identity comes only from the signed-in session token (no owner field)
  const res = await fetch(`${API}${path}`, {
    method: body ? "POST" : "GET",
    headers: { ...(body ? { "content-type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(json)}`);
  return json;
}
async function sign(req: any): Promise<string[]> {
  if (!req?.sign) throw new Error(`expected a sign request, got ${JSON.stringify(req).slice(0, 200)}`);
  if (req.sign.chainId !== dep.chainId) throw new Error("sign request is for the wrong chain");
  const hashes: string[] = [];
  for (const tx of req.sign.txs) {
    const sent = await user.sendTransaction({ to: tx.to, data: tx.data, value: 0n });
    const rc = await sent.wait();
    if (rc?.status !== 1) throw new Error(`${req.sign.label}: reverted`);
    hashes.push(sent.hash);
  }
  return hashes;
}

(async () => {
  console.log(`user wallet ${user.address} on chain ${dep.chainId}`);
  // ~6 wallet txs cost ~0.000007 ETH at testnet gas prices; WALLET_FLOW_GAS_ETH overrides
  await (await funder.sendTransaction({ to: user.address, value: parseEther(process.env.WALLET_FLOW_GAS_ETH ?? (dep.chainId === 31337 ? "0.05" : "0.00005")) })).wait();
  ok("gas for the test wallet", `${formatEther(await provider.getBalance(user.address))} ETH`);

  const nonce = await call(`/api/auth/nonce?wallet=${user.address}`);
  if (nonce.domain.chainId !== dep.chainId) throw new Error("sign-in challenge is for the wrong chain");
  const signed = await call("/api/auth/verify", { message: nonce.message, signature: await user.signTypedData(nonce.domain, nonce.types, nonce.message) });
  token = signed.token;
  ok("wallet signed in (EIP-712 challenge)", `session for ${signed.wallet.slice(0, 10)}…, role ${signed.role}`);

  const f = await call("/api/faucet", {});
  ok("faucet (backend sponsors the Bloom account, mints test USDG)", `tx ${f.txHash.slice(0, 10)}…`);

  const d = await call("/api/deposit", { amount: "25" });
  const dh = await sign(d);
  const acct = await call("/api/account");
  if (Number(acct.savings.valueUsd) < 24.99) throw new Error(`savings not credited: ${acct.savings.valueUsd}`);
  ok("deposit signed by the wallet", `savings $${acct.savings.valueUsd}, tx ${dh[0].slice(0, 10)}…`);

  const { goal } = await call("/api/goals/preview", { text: "Save $500 for my laptop by December 15." });
  const g = await call("/api/goals", { goal });
  const gh = await sign(g);
  const act = await call("/api/goals/activate", { txHash: gh[gh.length - 1] });
  await sign(act);
  const goals = await call("/api/goals");
  if (!goals.some((x: any) => String(x.goalId) === String(act.goalId) && x.active)) throw new Error("goal not active");
  ok("goal created + agent activated, both signed by the wallet", `goal #${act.goalId}, session key ${act.sessionKey.slice(0, 10)}…`);

  const chat = await call("/api/chat", { message: "Send Sarah $5 of QQQ." });
  if (!chat.actionId) throw new Error(`no action to confirm: ${chat.reply}`);
  const conf = await call("/api/chat/confirm", { actionId: chat.actionId });
  if (conf.status !== "executed") throw new Error(`agent send not executed: ${conf.message}`);
  ok("agent sent $5 of QQQ to Sarah within the wallet's goal rules", `${conf.txHashes.length} agent txs`);

  const r = await call("/api/deposit", { amount: "1" });
  if (!r.sign) throw new Error("backend signed for a wallet owner — it must never do that");
  ok("backend never signs for wallet owners", "owner actions always come back as sign requests");
  console.log(`\nWALLET FLOW OK — ${n} checks passed`);
})().catch((e) => {
  console.error(`\nWALLET FLOW FAILED: ${e.message}`);
  process.exitCode = 1;
});
