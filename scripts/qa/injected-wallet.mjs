// QA-only EIP-1193 wallet backend for browser testing (NOT MetaMask). It holds a throwaway testnet key and answers the
// JSON-RPC requests of the MetaMask-compatible provider injected by injected-provider.js. Localhost only.
//   node scripts/qa/injected-wallet.mjs            (QA_WALLET_KEY optional; a fresh key is generated otherwise)
// Controls (POST /control): {"rejectNext":true} simulates the user pressing Reject; {"chainId":1} starts on another network.
import http from "node:http";
import { FetchRequest, JsonRpcProvider, Wallet, toBeHex, getBytes, isHexString } from "ethers";
import { installFetchTransport } from "../../offchain/ethers-fetch.ts";

installFetchTransport(FetchRequest);
const RPC = process.env.QA_RPC_URL ?? "https://rpc.testnet.chain.robinhood.com";
const APP_CHAIN = Number(process.env.QA_CHAIN_ID ?? 46630);
const provider = new JsonRpcProvider(RPC, APP_CHAIN, { staticNetwork: true });
const wallet = (process.env.QA_WALLET_KEY ? new Wallet(process.env.QA_WALLET_KEY) : Wallet.createRandom()).connect(provider);
// like MetaMask: no accounts are exposed until the site requests access (eth_requestAccounts)
const state = { chainId: Number(process.env.QA_START_CHAIN ?? APP_CHAIN), rejectNext: false, authorized: false, log: [] };
const USER_ACTIONS = new Set(["eth_requestAccounts", "personal_sign", "eth_signTypedData_v4", "eth_sendTransaction", "wallet_switchEthereumChain"]);

async function handle(method, params = []) {
  if (USER_ACTIONS.has(method) && state.rejectNext) {
    state.rejectNext = false;
    throw { code: 4001, message: "User rejected the request." };
  }
  switch (method) {
    case "eth_requestAccounts":
      state.authorized = true;
      return [wallet.address];
    case "eth_accounts":
      return state.authorized ? [wallet.address] : [];
    case "wallet_revokePermissions":
      state.authorized = false;
      return null;
    case "eth_chainId":
      return toBeHex(state.chainId);
    case "net_version":
      return String(state.chainId);
    case "wallet_switchEthereumChain": {
      const id = Number(params[0]?.chainId);
      if (id !== APP_CHAIN) throw { code: 4902, message: `Unrecognized chain ${id}` };
      state.chainId = id;
      return null;
    }
    case "wallet_addEthereumChain":
      return null;
    case "personal_sign":
      return wallet.signMessage(isHexString(params[0]) ? getBytes(params[0]) : params[0]);
    case "eth_signTypedData_v4": {
      const { domain, types, message } = typeof params[1] === "string" ? JSON.parse(params[1]) : params[1];
      delete types.EIP712Domain;
      return wallet.signTypedData(domain, types, message);
    }
    case "eth_sendTransaction": {
      if (state.chainId !== APP_CHAIN) throw { code: 4901, message: "Wallet is on another chain" };
      const tx = params[0];
      const sent = await wallet.sendTransaction({ to: tx.to, data: tx.data, value: tx.value ? BigInt(tx.value) : 0n });
      return sent.hash;
    }
    default:
      return provider.send(method, params);
  }
}

http
  .createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000");
    res.setHeader("Access-Control-Allow-Headers", "content-type");
    if (req.method === "OPTIONS") return res.end();
    let body = "";
    for await (const c of req) body += c;
    const msg = body ? JSON.parse(body) : {};
    res.setHeader("content-type", "application/json");
    if (req.url === "/control") {
      Object.assign(state, msg);
      return res.end(JSON.stringify({ address: wallet.address, chainId: state.chainId, rejectNext: state.rejectNext, log: state.log.slice(-40) }));
    }
    try {
      const result = await handle(msg.method, msg.params);
      if (USER_ACTIONS.has(msg.method)) state.log.push({ method: msg.method, ok: true, result: msg.method === "eth_sendTransaction" ? result : undefined });
      res.end(JSON.stringify({ result }));
    } catch (e) {
      if (USER_ACTIONS.has(msg.method)) state.log.push({ method: msg.method, ok: false, code: e.code });
      res.end(JSON.stringify({ error: { code: e.code ?? -32603, message: e.message ?? e.shortMessage ?? String(e) } }));
    }
  })
  .listen(8787, "127.0.0.1", () => console.log(JSON.stringify({ qaWallet: wallet.address, chainId: state.chainId, rpc: RPC })));
