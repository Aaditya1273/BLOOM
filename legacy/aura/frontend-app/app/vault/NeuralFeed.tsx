"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Activity, Brain, Cpu, Loader2, RefreshCcw, Shield, Zap } from "lucide-react";

type NeuralLog = {
  id: number;
  time: string;
  agent: string;
  message: string;
  type: "analyst" | "risk" | "execution" | "guardrail" | "system" | "alert";
  txHash?: string;
};

const AGENT_CONFIG: Record<string, { icon: React.ElementType; color: string; bg: string; border: string; label: string }> = {
  "Analyst Agent": {
    icon: Brain,
    color: "text-neon-cyan",
    bg: "bg-neon-cyan/10",
    border: "border-neon-cyan/25",
    label: "Signal",
  },
  "Risk Officer": {
    icon: Shield,
    color: "text-neon-pink",
    bg: "bg-neon-pink/10",
    border: "border-neon-pink/25",
    label: "Risk",
  },
  Execution: {
    icon: Zap,
    color: "text-neon-green",
    bg: "bg-neon-green/10",
    border: "border-neon-green/25",
    label: "Exec",
  },
  Guardrail: {
    icon: Activity,
    color: "text-neon-yellow",
    bg: "bg-neon-yellow/10",
    border: "border-neon-yellow/25",
    label: "Guard",
  },
  System: {
    icon: Cpu,
    color: "text-white/60",
    bg: "bg-white/[0.06]",
    border: "border-white/10",
    label: "Core",
  },
};

interface Props {
  logs: NeuralLog[];
  onAnalyze: () => void;
  isAnalyzing: boolean;
}

export default function NeuralFeed({ logs, onAnalyze, isAnalyzing }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, [logs.length]);

  return (
    <div className="rounded-none border border-[#00f0ff] p-0 flex h-full min-h-[640px] flex-col overflow-hidden bg-[#050505]">
      <div className="flex flex-col gap-3 border-b border-[#00f0ff]/30 bg-[#0a0a0a] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <div className="relative flex h-9 w-9 items-center justify-center rounded-none border border-[#00f0ff]/50 bg-[#00f0ff]/10">
            <Cpu className="h-4 w-4 text-[#00f0ff]" />
            <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-none bg-[#00f0ff] shadow-[0_0_10px_rgba(0,240,255,0.7)] animate-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#00f0ff]">LIVE_INTELLIGENCE_TRACE</span>
            </div>
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/50">[{logs.length} EVENTS_INDEXED]</span>
          </div>
        </div>
        <button
          onClick={onAnalyze}
          disabled={isAnalyzing}
          className="flex h-9 items-center justify-center gap-2 rounded-none border border-[#00f0ff] bg-[#00f0ff]/10 px-4 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff] transition-all hover:bg-[#00f0ff]/20 hover:shadow-[0_0_15px_rgba(0,240,255,0.2)] disabled:opacity-50"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ANALYZING...
            </>
          ) : (
            <>
              <span className="h-2 w-2 rounded-none bg-[#00f0ff] animate-pulse" />
              AUTO_PILOT
            </>
          )}
        </button>
      </div>

      <div ref={scrollRef} className="custom-scrollbar flex-1 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="flex min-h-[500px] items-center justify-center px-6">
            <div className="max-w-sm text-center">
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-none border border-[#00f0ff] bg-[#00f0ff]/10">
                <Brain className="h-5 w-5 text-[#00f0ff]" />
              </div>
              <h3 className="font-mono text-lg font-bold uppercase tracking-[0.2em] text-[#00f0ff]">AWAITING_VAULT_EVENTS</h3>
              <p className="mt-2 text-xs font-mono uppercase leading-6 text-[#00f0ff]/50">The audit stream will populate with strategy proposals, risk checks and execution receipts.</p>
            </div>
          </div>
        ) : (
          <AnimatePresence initial={false}>
            {logs.map((log, i) => {
              const cfgIconColor = log.type === "alert" || log.message.includes("REJECTED") ? "text-[#FF2A6D]" : "text-[#00f0ff]";
              const cfgBorderColor = log.type === "alert" || log.message.includes("REJECTED") ? "border-[#FF2A6D]" : "border-[#00f0ff]";
              const cfgBgColor = log.type === "alert" || log.message.includes("REJECTED") ? "bg-[#FF2A6D]/10" : "bg-[#00f0ff]/10";
              const isExecutionOk = log.type === "execution" && log.message.toLowerCase().includes("ok");

              return (
                <motion.div
                  key={log.id}
                  initial={{ opacity: 0, x: -16, height: 0 }}
                  animate={{ opacity: 1, x: 0, height: "auto" }}
                  exit={{ opacity: 0, x: 16, height: 0 }}
                  transition={{ duration: 0.25 }}
                  className="border-b border-[#00f0ff]/20 transition-colors hover:bg-[#00f0ff]/5"
                >
                  <div className="grid gap-3 px-5 py-4 sm:grid-cols-[auto_1fr_auto]">
                    <div className="flex flex-row items-center gap-3 sm:flex-col sm:gap-1">
                      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-none border ${cfgBorderColor} ${cfgBgColor}`}>
                         <Activity className={`h-3.5 w-3.5 ${cfgIconColor}`} />
                      </div>
                      {i < logs.length - 1 && <div className="hidden w-px flex-1 bg-[#00f0ff]/20 sm:block" />}
                    </div>

                    <div className="min-w-0">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className={`font-mono text-[10px] font-bold uppercase tracking-widest ${cfgIconColor}`}>{log.agent}</span>
                        <span className="font-mono text-[9px] uppercase tracking-widest text-[#00f0ff]/50">[{log.time}]</span>
                      </div>
                      <p className="break-words font-mono text-[10px] uppercase leading-5 text-[#00f0ff]/80">&gt;_ {log.message}</p>
                      {log.type === "guardrail" && (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <span className="border border-[#FF2A6D] bg-[#FF2A6D]/10 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-[#FF2A6D]">STYLUS_WASM</span>
                          <span className="font-mono text-[9px] uppercase tracking-widest text-[#FF2A6D]/50">&lt;ON_CHAIN_VALIDATION&gt;</span>
                        </div>
                      )}
                      {isExecutionOk && !log.txHash && (
                        <div className="mt-2">
                          <span className="border border-[#00f0ff] bg-[#00f0ff]/10 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-[#00f0ff]">CONFIRMED</span>
                        </div>
                      )}
                      {log.txHash && (
                        <div className="mt-2 flex items-center gap-2">
                          <a href={`https://explorer.testnet.chain.robinhood.com/tx/${log.txHash}`} target="_blank" rel="noopener noreferrer" className="border border-[#00f0ff] bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-[#00f0ff] transition-all flex items-center gap-1 cursor-pointer">
                            [ VIEW_ON_EXPLORER ]
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="hidden items-start pt-1 font-mono text-[9px] uppercase tracking-widest text-[#00f0ff]/40 md:flex">
                      #{String(log.id).slice(-4)}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-white/10 px-5 py-3 font-mono text-[0.62rem] uppercase tracking-widest text-white/30 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 bg-neon-green" />Solidity Guard</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 bg-neon-pink" />Stylus WASM</span>
          <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 bg-neon-cyan" />AI Committee</span>
        </div>
        <span>Robinhood Chain / Arbitrum Orbit</span>
      </div>
    </div>
  );
}
