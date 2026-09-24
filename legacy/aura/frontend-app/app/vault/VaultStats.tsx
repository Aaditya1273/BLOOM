"use client";

import { motion } from "framer-motion";
import { BarChart3, Coins, Shield, TrendingUp, Zap } from "lucide-react";

interface Props {
  tvl: string;
  utilization: number;
  maxRisk: number;
  strategyCount: number;
  userShares: string;
  userAssets: string;
  isLoading: boolean;
  apy: string;
}

export default function VaultStats({
  tvl,
  utilization,
  maxRisk,
  strategyCount,
  userShares,
  userAssets,
  isLoading,
  apy,
}: Props) {
  const safetyScore = Math.max(0, 100 - utilization * 0.4 - (100 - maxRisk) * 0.2);
  const safetyColor = safetyScore > 75 ? "text-neon-green" : safetyScore > 50 ? "text-neon-yellow" : "text-neon-pink";

  const stats = [
    {
      label: "Total Value Locked",
      value: `$${tvl}`,
      sub: "aUSD reserve",
      icon: Coins,
      border: "border-neon-green/25",
      rail: "bg-neon-green/10",
      iconColor: "text-neon-green",
    },
    {
      label: "Estimated APY",
      value: `${apy}%`,
      sub: "Projected yield",
      icon: TrendingUp,
      border: "border-neon-cyan/25",
      rail: "bg-neon-cyan/10",
      iconColor: "text-neon-cyan",
    },
    {
      label: "Safety Score",
      value: `${safetyScore.toFixed(0)}/100`,
      sub: `Risk cap ${maxRisk}`,
      icon: Shield,
      border: "border-neon-pink/25",
      rail: "bg-neon-pink/10",
      iconColor: "text-neon-pink",
      gauge: true,
    },
    {
      label: "Strategies Executed",
      value: `${strategyCount}`,
      sub: `Util ${utilization.toFixed(1)}%`,
      icon: Zap,
      border: "border-neon-yellow/25",
      rail: "bg-neon-yellow/10",
      iconColor: "text-neon-yellow",
    },
    {
      label: "Your Deposit",
      value: `$${userAssets}`,
      sub: `${userShares.includes('e') ? userShares : (Number(userShares.replace(/,/g, '')) > 1000000 ? Number(userShares.replace(/,/g, '')).toExponential(2) : userShares)} ivAUSD`,
      icon: BarChart3,
      border: "border-white/10",
      rail: "bg-white/[0.06]",
      iconColor: "text-white/70",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-5">
      {stats.map((s, i) => {
        const Icon = s.icon;

        return (
          <motion.div
            key={s.label}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className={`group relative overflow-hidden rounded-none border border-[#00f0ff] bg-[#050505] p-5 transition-all hover:bg-[#00f0ff]/5 hover:shadow-[0_0_15px_rgba(0,240,255,0.15)]`}
          >
            <div className={`absolute inset-x-0 -top-px h-px bg-[#00f0ff]/50`} />
            <div className="mb-4 flex items-start justify-between">
              <div className={`flex h-10 w-10 items-center justify-center rounded-none border border-[#00f0ff]/30 bg-[#00f0ff]/10 text-[#00f0ff]`}>
                <Icon className="h-4 w-4" />
              </div>
              {s.gauge && (
                <div className="relative h-10 w-10">
                  <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                    <path d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" fill="none" stroke="rgba(0,240,255,0.1)" strokeWidth="1.5" />
                    <path
                      d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeDasharray={`${safetyScore}, 100`}
                      className={"text-[#00f0ff]"}
                      strokeLinecap="butt"
                    />
                  </svg>
                </div>
              )}
            </div>
            <div className="font-mono text-xl font-bold tracking-wider text-[#00f0ff]">
              {isLoading ? <span className="inline-block h-6 w-20 animate-pulse bg-[#00f0ff]/20" /> : s.value}
            </div>
            <div className="mt-3 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/60 border-t border-[#00f0ff]/20 pt-2">{s.label}</div>
            <div className="mt-1 font-mono text-[9px] uppercase text-[#00f0ff]/40">[{s.sub}]</div>
          </motion.div>
        );
      })}
    </div>
  );
}
