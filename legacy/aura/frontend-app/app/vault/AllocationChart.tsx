"use client";

import { motion } from "framer-motion";
import { Activity, PieChart } from "lucide-react";

export interface AllocationData {
  name: string;
  pct: number;
  color: string;
  accent: string;
}

interface Props {
  utilization: number;
  allocations?: AllocationData[];
}

const ALLOCATIONS = [
  { name: "aUSD Idle", pct: 58, color: "#39ff14", accent: "bg-neon-green" },
  { name: "WETH", pct: 18, color: "#00f0ff", accent: "bg-neon-cyan" },
  { name: "TSLA", pct: 12, color: "#ff00a0", accent: "bg-neon-pink" },
  { name: "BTC", pct: 8, color: "#f0e800", accent: "bg-neon-yellow" },
  { name: "AMZN", pct: 4, color: "#ffae00", accent: "bg-neon-orange" },
];

export default function AllocationChart({ utilization, allocations = ALLOCATIONS }: Props) {
  let cumulative = 0;
  const segments = allocations.map((a) => {
    const start = cumulative;
    cumulative += a.pct;
    return { ...a, start, end: cumulative };
  });

  return (
    <div className="rounded-none border border-[#00f0ff] p-5 bg-[#050505]">
      <div className="mb-5 flex items-center justify-between gap-3 border-b border-[#00f0ff]/30 pb-4">
        <div className="flex items-center gap-2">
          <PieChart className="h-4 w-4 text-[#00f0ff]" />
          <span className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-[#00f0ff]">ALLOCATION_MATRIX</span>
        </div>
        <span className="border border-[#00f0ff]/20 bg-[#00f0ff]/10 px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]">AI tuned</span>
      </div>

      <div className="mb-5 flex justify-center">
        <div className="relative h-44 w-44">
          <svg viewBox="0 0 42 42" className="h-full w-full -rotate-90">
            <circle cx="21" cy="21" r="15.9155" fill="none" stroke="rgba(0,240,255,0.07)" strokeWidth="1.5" />
            {segments.map((seg, i) => {
              const radius = 15.9155;
              const circumference = 2 * Math.PI * radius;
              const strokeDash = (seg.pct / 100) * circumference;
              const strokeOffset = -((seg.start / 100) * circumference);
              return (
                <motion.circle
                  key={seg.name}
                  cx="21"
                  cy="21"
                  r={radius}
                  fill="none"
                  stroke={seg.name.includes("Idle") ? "#00f0ff" : "#FF2A6D"}
                  strokeWidth="4"
                  strokeDasharray={`${strokeDash} ${circumference - strokeDash}`}
                  strokeDashoffset={strokeOffset}
                  strokeLinecap="butt"
                  opacity={1 - i * 0.15}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 - i * 0.15 }}
                  transition={{ delay: i * 0.12, duration: 0.45 }}
                />
              );
            })}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="font-mono text-3xl font-bold text-[#00f0ff] tracking-tighter">{utilization.toFixed(0)}%</span>
            <span className="font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/50">Deployed</span>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {allocations.map((a, i) => (
          <motion.div
            key={a.name}
            className="grid grid-cols-[1fr_auto] items-center gap-3"
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.25 + i * 0.07 }}
          >
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-2">
                <span className={`h-1.5 w-1.5 ${a.name.includes("Idle") ? "bg-[#00f0ff]" : "bg-[#FF2A6D]"}`} />
                <span className="truncate font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/70">{a.name}</span>
              </div>
              <div className="h-[2px] overflow-hidden rounded-none bg-[#00f0ff]/10">
                <motion.div
                  className="h-full rounded-none"
                  style={{ backgroundColor: a.name.includes("Idle") ? "#00f0ff" : "#FF2A6D" }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min(a.pct, 100)}%` }}
                  transition={{ delay: 0.4 + i * 0.08, duration: 0.55 }}
                />
              </div>
            </div>
            <span className="w-12 text-right font-mono text-[10px] font-bold text-[#00f0ff]">{a.pct}%</span>
          </motion.div>
        ))}
      </div>

      <div className="mt-5 flex items-center justify-between border-t border-[#00f0ff]/30 pt-3 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/50">
        <span className="flex items-center gap-2">
          <Activity className="h-3 w-3 text-[#00f0ff]" />
          SYS.BALANCES
        </span>
        <span>{allocations.length} ASSETS</span>
      </div>
    </div>
  );
}
