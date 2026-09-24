// Optional: register the Bloom Agent in an ERC-8004 Identity Registry.
// The ERC-8004 registries are maintained by the ERC-8004 team (github.com/erc-8004/erc-8004-contracts), NOT by
// Robinhood. Testnet registry: 0x8004A818BFB912233c491871b3d84c89A494BD9e. Skips unless ERC8004_IDENTITY_REGISTRY is set.
//   ERC8004_IDENTITY_REGISTRY=0x... ERC8004_RPC_URL=... ERC8004_OWNER_PRIVATE_KEY=... PUBLIC_API_URL=https://... npm run register-agent
import dotenv from "dotenv";
import { Contract, FetchRequest, JsonRpcProvider, Wallet } from "ethers";
import { installFetchTransport } from "../../offchain/ethers-fetch.ts";

installFetchTransport(FetchRequest);
dotenv.config({ path: new URL("../../.env", import.meta.url).pathname, quiet: true });
const { ERC8004_IDENTITY_REGISTRY: registry, ERC8004_RPC_URL: rpc, ERC8004_OWNER_PRIVATE_KEY: pk, PUBLIC_API_URL: base } = process.env;
if (!registry) {
  console.log("ERC8004_IDENTITY_REGISTRY not set: skipping ERC-8004 registration.");
  process.exit(0);
}
if (!rpc || !pk || !base) throw new Error("Set ERC8004_RPC_URL, ERC8004_OWNER_PRIVATE_KEY and PUBLIC_API_URL");
const provider = new JsonRpcProvider(rpc, undefined, { cacheTimeout: -1 });
if ((await provider.getCode(registry)) === "0x") throw new Error(`No contract at ${registry} on this RPC`);
const abi = [
  "function register(string agentURI) returns (uint256 agentId)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
];
const reg = new Contract(registry, abi, new Wallet(pk, provider));
const uri = `${base.replace(/\/$/, "")}/api/agent/metadata`;
const rc = await (await reg["register(string)"](uri)).wait();
const ev = rc.logs.map((l: any) => { try { return reg.interface.parseLog(l); } catch { return null; } }).find((e: any) => e?.name === "Registered");
console.log(JSON.stringify({ txHash: rc.hash, agentId: ev?.args.agentId?.toString(), agentURI: uri }));
console.log("Set ERC8004_AGENT_ID to the agentId above so /api/agent/metadata lists the registration.");
