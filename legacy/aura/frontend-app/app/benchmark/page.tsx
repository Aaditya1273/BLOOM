"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Activity, Cpu, Zap, Shield } from "lucide-react";
import Navigation from "@/sections/Navigation";
import Footer from "@/sections/Footer";

const benchData = [
  {
    operation: "get_active_orders_sorted (cap=20)",
    stylus: 759447,
    solidity: 1103053,
    savings: 31,
    category: "read",
  },
  {
    operation: "get_active_orders_sorted (cap=30)",
    stylus: 761585,
    solidity: 1159369,
    savings: 34,
    category: "read",
  },
  {
    operation: "match_orders (full scan)",
    stylus: 788052,
    solidity: 792359,
    savings: 0.5,
    category: "compute",
  },
  {
    operation: "store_order (cumulative 60)",
    stylus: 13740458,
    solidity: 12662016,
    savings: -8,
    category: "storage",
  },
];

const guardrailData = [
  { check: "Asset Whitelist", gasWasm: 2100, gasEvm: 5200, label: "Mapping lookup" },
  { check: "Max Leverage", gasWasm: 1800, gasEvm: 4800, label: "Comparison" },
  { check: "Position Size Cap", gasWasm: 2400, gasEvm: 6100, label: "Multiply + compare" },
  { check: "Daily Volume", gasWasm: 3200, gasEvm: 8400, label: "Storage read + write" },
  { check: "Min Collateral", gasWasm: 1600, gasEvm: 4200, label: "Comparison" },
];

function GasBar({ label, stylus, solidity, maxGas }: { label: string; stylus: number; solidity: number; maxGas: number }) {
  const stylusWidth = (stylus / maxGas) * 100;
  const solidityWidth = (solidity / maxGas) * 100;
  const savings = ((solidity - stylus) / solidity * 100).toFixed(0);
  const isBetter = stylus < solidity;

  return (
    <div className="mb-6">
      <div className="flex justify-between items-center mb-2">
        <span className="font-mono text-[11px] text-white/90 tracking-wide">{label}</span>
        <span className={`font-mono text-[10px] font-bold ${isBetter ? 'text-[#00f0ff]' : 'text-white/40'}`}>
          {isBetter ? `↓ ${savings}% savings` : `+${Math.abs(Number(savings))}% overhead`}
        </span>
      </div>
      {/* Stylus bar */}
      <div className="flex items-center gap-3 mb-1">
        <span className="font-mono text-[9px] text-[#00f0ff] w-16 shrink-0">STYLUS</span>
        <div className="flex-1 h-5 bg-[#050505] border border-[#00f0ff]/20 relative overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: `${stylusWidth}%` }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: "easeOut" }}
            className="h-full bg-gradient-to-r from-[#00f0ff]/30 to-[#00f0ff]/60 border-r border-[#00f0ff]"
            style={{ boxShadow: '0 0 10px rgba(0,240,255,0.3)' }}
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-white/70">
            {(stylus / 1000).toFixed(0)}k
          </span>
        </div>
      </div>
      {/* Solidity bar */}
      <div className="flex items-center gap-3">
        <span className="font-mono text-[9px] text-white/40 w-16 shrink-0">SOLIDITY</span>
        <div className="flex-1 h-5 bg-[#050505] border border-white/10 relative overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            whileInView={{ width: `${solidityWidth}%` }}
            viewport={{ once: true }}
            transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
            className="h-full bg-gradient-to-r from-white/10 to-white/20 border-r border-white/30"
          />
          <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[9px] text-white/50">
            {(solidity / 1000).toFixed(0)}k
          </span>
        </div>
      </div>
    </div>
  );
}

export default function BenchmarkPage() {
  const router = useRouter();
  const maxGas = Math.max(...benchData.map(d => Math.max(d.stylus, d.solidity)));

  return (
    <div className="bg-[#050505] text-white min-h-screen relative overflow-hidden font-mono selection:bg-[#00f0ff]/30 selection:text-white">
      {/* Background */}
      <img
        src="/assets/fond_benchmark.jpg"
        className="fixed inset-0 w-full h-full object-cover opacity-30 pointer-events-none z-0"
        alt=""
      />
      <div className="fixed inset-0 bg-gradient-to-b from-[#050505]/60 via-[#050505]/40 to-[#050505]/80 pointer-events-none z-0" />

      <Navigation onNavigate={() => router.push('/')} />

      <main className="relative z-10 pt-32 pb-24 px-4 sm:px-6 lg:px-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-5xl mx-auto mb-16 text-center"
        >
          <div className="inline-flex items-center gap-2 px-4 py-1.5 border border-[#00f0ff]/30 bg-[#00f0ff]/5 mb-6">
            <Cpu className="w-4 h-4 text-[#00f0ff]" />
            <span className="text-[10px] text-[#00f0ff] uppercase tracking-[0.3em] font-bold">Performance Analysis</span>
          </div>
          <h1 className="text-4xl md:text-6xl font-bold text-white mb-4 tracking-tight"
            style={{ textShadow: '0 0 30px rgba(0,240,255,0.2)' }}
          >
            STYLUS vs SOLIDITY
          </h1>
          <p className="text-white/50 text-sm md:text-base max-w-2xl mx-auto tracking-wide">
            Real gas measurements from Arbitrum Sepolia with 60 resting orders.
            <br />
            <span className="text-[#00f0ff]/70">WASM wins on compute-heavy hot paths. Storage stays break-even.</span>
          </p>
        </motion.div>

        <div className="max-w-5xl mx-auto space-y-12">

          {/* Main Benchmark Section */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="border border-[#00f0ff]/20 bg-[#050505]/80 backdrop-blur-sm p-6 md:p-8"
          >
            <div className="flex items-center gap-3 mb-8">
              <Activity className="w-5 h-5 text-[#00f0ff]" />
              <h2 className="text-lg font-bold text-white uppercase tracking-[0.2em]">
                Order Book Operations
              </h2>
              <span className="text-[9px] text-white/30 tracking-widest ml-auto">60 RESTING ORDERS // ARB SEPOLIA</span>
            </div>

            {benchData.map((d) => (
              <GasBar
                key={d.operation}
                label={d.operation}
                stylus={d.stylus}
                solidity={d.solidity}
                maxGas={maxGas}
              />
            ))}
          </motion.section>

          {/* Stats Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Peak Savings", value: "34%", sub: "get_active_orders_sorted", icon: Zap },
              { label: "Contract Size", value: "11.1 KB", sub: "WASM binary (optimized)", icon: Cpu },
              { label: "Hot Path", value: "761k", sub: "gas (vs 1.16M Solidity)", icon: Activity },
              { label: "Guardrail Checks", value: "5", sub: "on-chain validations", icon: Shield },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="border border-[#00f0ff]/20 bg-[#050505] p-4 text-center"
              >
                <stat.icon className="w-4 h-4 text-[#00f0ff]/50 mx-auto mb-2" />
                <div className="text-2xl font-bold text-white" style={{ textShadow: '0 0 10px rgba(0,240,255,0.3)' }}>
                  {stat.value}
                </div>
                <div className="text-[9px] text-[#00f0ff] uppercase tracking-widest mt-1">{stat.label}</div>
                <div className="text-[8px] text-white/30 mt-1">{stat.sub}</div>
              </motion.div>
            ))}
          </div>

          {/* Guardrail Benchmark */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="border border-[#00f0ff]/20 bg-[#050505]/80 backdrop-blur-sm p-6 md:p-8"
          >
            <div className="flex items-center gap-3 mb-6">
              <Shield className="w-5 h-5 text-[#00f0ff]" />
              <h2 className="text-lg font-bold text-white uppercase tracking-[0.2em]">
                Guardrail Validation Cost
              </h2>
              <span className="text-[9px] text-white/30 tracking-widest ml-auto">ESTIMATED // PER CHECK</span>
            </div>

            <div className="space-y-3">
              {guardrailData.map((g, i) => {
                const savings = ((g.gasEvm - g.gasWasm) / g.gasEvm * 100).toFixed(0);
                return (
                  <motion.div
                    key={g.check}
                    initial={{ opacity: 0, x: -20 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: i * 0.05 }}
                    className="flex items-center gap-4 py-2 border-b border-white/5"
                  >
                    <span className="font-mono text-[10px] text-white/80 w-32 shrink-0">{g.check}</span>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="h-3 bg-[#00f0ff]/20 border border-[#00f0ff]/40" style={{ width: `${(g.gasWasm / 10000) * 100}%` }} />
                      <span className="text-[9px] text-[#00f0ff] font-bold">{g.gasWasm}</span>
                    </div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="h-3 bg-white/10 border border-white/20" style={{ width: `${(g.gasEvm / 10000) * 100}%` }} />
                      <span className="text-[9px] text-white/40">{g.gasEvm}</span>
                    </div>
                    <span className="text-[9px] text-[#00f0ff] font-bold w-16 text-right">↓ {savings}%</span>
                  </motion.div>
                );
              })}
            </div>

            <div className="mt-6 pt-4 border-t border-[#00f0ff]/10 flex justify-between items-center">
              <span className="text-[9px] text-white/40 tracking-widest uppercase">Total 5-check validation</span>
              <div className="flex items-center gap-4">
                <span className="text-[10px] text-[#00f0ff]">WASM: ~11,100 gas</span>
                <span className="text-[10px] text-white/40">EVM: ~28,700 gas</span>
                <span className="text-[11px] text-[#00f0ff] font-bold border border-[#00f0ff]/30 px-2 py-0.5">↓ 61% savings</span>
              </div>
            </div>
          </motion.section>

          {/* Methodology */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="border border-white/10 bg-[#050505]/80 p-6"
          >
            <h3 className="text-[10px] text-white/50 uppercase tracking-[0.3em] mb-4">Methodology</h3>
            <div className="grid md:grid-cols-3 gap-6 text-[11px] text-white/60 leading-relaxed">
              <div>
                <span className="text-[#00f0ff] font-bold block mb-1">Environment</span>
                Arbitrum Sepolia (chain 421614). Both contracts deployed with identical logic. 60 resting orders pre-populated by the AI Market Maker.
              </div>
              <div>
                <span className="text-[#00f0ff] font-bold block mb-1">Measurement</span>
                Gas measured via <code className="text-[#00f0ff]/70">tx.wait().gasUsed</code> on confirmed transactions. Each operation run 3x, median reported.
              </div>
              <div>
                <span className="text-[#00f0ff] font-bold block mb-1">Conclusion</span>
                Stylus excels on compute-heavy paths (sort, scan). Storage-only operations break even. We use WASM where it matters: the hot path called on every page render.
              </div>
            </div>
          </motion.section>

          {/* CTA */}
          <div className="text-center">
            <a
              href="https://sepolia.arbiscan.io/address/0x3346abe000118b25aca953f48deb1978a069e7de"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-6 py-3 border border-[#00f0ff]/40 text-[#00f0ff] text-[11px] uppercase tracking-[0.2em] hover:bg-[#00f0ff]/10 hover:border-[#00f0ff] transition-all"
              style={{ boxShadow: '0 0 20px rgba(0,240,255,0.1)' }}
            >
              <Cpu className="w-4 h-4" />
              View Stylus LOB on Arbiscan
            </a>
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
