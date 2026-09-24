"use client";
import { useState, useEffect } from "react";
import { createPublicClient, http, parseAbiItem } from "viem";

const AUDIT_TRAIL = "0x42D141CBe4aDc46B082D702C2e1bD802236348C4";
const AGENT = "0xb4DD0565207Ca66432C0BaD06b69Bb97514E033d";
const client = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com") });

const ABI = [
  { inputs: [{ name: "agent", type: "address" }], name: "getAgentReputation", outputs: [{ name: "trades", type: "uint256" }, { name: "avgScore", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [], name: "totalRecords", outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
] as const;

type AuditEvent = { action: string; score: number; timestamp: number };

export default function AuditTrailWidget() {
  const [totalRecords, setTotalRecords] = useState(0);
  const [avgScore, setAvgScore] = useState(0);
  const [totalTrades, setTotalTrades] = useState(0);
  const [events, setEvents] = useState<AuditEvent[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const [records, rep] = await Promise.all([
          client.readContract({ address: AUDIT_TRAIL, abi: ABI, functionName: "totalRecords" }),
          client.readContract({ address: AUDIT_TRAIL, abi: ABI, functionName: "getAgentReputation", args: [AGENT] }),
        ]);
        setTotalRecords(Number(records));
        setTotalTrades(Number(rep[0]));
        setAvgScore(Number(rep[1]));

        // Fetch recent events
        const currentBlock = await client.getBlockNumber();
        const logs = await client.getLogs({
          address: AUDIT_TRAIL,
          event: parseAbiItem("event ReasoningRecordedWithScore(address indexed agent, address indexed user, bytes32 reasoningHash, uint256 timestamp, string action, uint8 confidenceScore)"),
          args: { agent: AGENT },
          fromBlock: currentBlock - 500n,
          toBlock: currentBlock,
        });
        setEvents(logs.slice(-5).reverse().map(l => ({
          action: (l as any).args.action || "",
          score: Number((l as any).args.confidenceScore || 0),
          timestamp: Number((l as any).args.timestamp || 0),
        })));
      } catch {}
    };
    load();
    const i = setInterval(load, 30000);
    return () => clearInterval(i);
  }, []);

  return (
    <div className="border-t border-[#00f0ff]/20 p-3 bg-[#050505]">
      <div className="flex items-center gap-2 mb-2">
        <div className="w-1.5 h-1.5 bg-[#00f0ff] animate-pulse" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-[#00f0ff]">AI Audit Trail</span>
        <span className="text-[8px] text-white/20 ml-auto">{totalRecords} records on-chain</span>
      </div>

      <div className="flex gap-2 mb-2">
        <div className="flex-1 bg-[#0a0a0a] border border-[#00f0ff]/10 p-2 text-center">
          <p className="text-[8px] text-white/30 uppercase">Trades</p>
          <p className="text-sm font-bold text-[#00f0ff]">{totalTrades}</p>
        </div>
        <div className="flex-1 bg-[#0a0a0a] border border-[#00f0ff]/10 p-2 text-center">
          <p className="text-[8px] text-white/30 uppercase">Avg Score</p>
          <p className="text-sm font-bold text-[#00f0ff]">{avgScore}/100</p>
        </div>
      </div>

      {events.length > 0 && (
        <div className="space-y-1">
          {events.map((e, i) => (
            <div key={i} className="flex items-center gap-2 text-[9px] text-white/40">
              <span className={`px-1 py-0.5 text-[8px] font-bold ${e.score >= 70 ? "bg-[#00ff88]/10 text-[#00ff88]" : "bg-yellow-500/10 text-yellow-400"}`}>{e.score}</span>
              <span className="truncate flex-1">{e.action}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
