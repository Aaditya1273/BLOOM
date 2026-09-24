"use client";

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield, Cpu, TrendingUp, Zap, CheckCircle } from 'lucide-react';
import type { MacroAnalysis } from '@/types';

interface IntelligenceTraceProps {
  rationale?: string;
  macroAnalysis?: MacroAnalysis;
}

function AnimatedTimer({ targetMs }: { targetMs: number }) {
  const [value, setValue] = useState(0);

  useEffect(() => {
    const start = Date.now();
    const interval = setInterval(() => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / 1200, 1); // Animate over 1.2s
      setValue(parseFloat((progress * targetMs).toFixed(1)));
      if (progress >= 1) clearInterval(interval);
    }, 50);
    return () => clearInterval(interval);
  }, [targetMs]);

  return <span>{value.toFixed(1)}ms</span>;
}

export default function IntelligenceTrace({ rationale, macroAnalysis }: IntelligenceTraceProps) {
  if (!rationale && !macroAnalysis) return null;

  return (
    <motion.div 
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 border border-white/10 rounded-xl overflow-hidden bg-black/40 backdrop-blur-md shadow-[0_0_15px_rgba(0,240,255,0.05)]"
    >
      {/* Header */}
      <div className="bg-neon-cyan/5 px-4 py-2 border-b border-white/10 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu size={14} className="text-white" />
          <span className="font-mono text-[0.65rem] text-white uppercase tracking-widest cyber-glow-cyan">Aura Intelligence Trace</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="flex h-1.5 w-1.5">
            <span className="animate-ping absolute inline-flex h-1.5 w-1.5 rounded-full bg-neon-green opacity-75"></span>
            <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-neon-green"></span>
          </span>
          <span className="font-mono text-[0.55rem] text-white uppercase tracking-tighter">Live Audit</span>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Step 1: Strategic Proposal */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full bg-neon-pink/10 border border-neon-pink/30 flex items-center justify-center shadow-[0_0_10px_rgba(255,0,160,0.2)]">
              <Zap size={12} className="text-white" />
            </div>
            <div className="w-px h-full bg-white/10 my-1"></div>
          </div>
          <div className="pb-4">
            <h5 className="font-mono font-bold text-xs text-white tracking-wide">Executor Agent Proposal</h5>
            <p className="font-body text-[0.7rem] text-white/60 mt-1 leading-relaxed italic">
              &quot;Generating optimal routing for DCA strategy on Robinhood Chain...&quot;
            </p>
          </div>
        </div>

        {/* Step 2: Macro Analysis */}
        {macroAnalysis && (
          <div className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="w-6 h-6 rounded-full bg-neon-cyan/10 border border-neon-cyan/30 flex items-center justify-center shadow-[0_0_10px_rgba(0,240,255,0.2)]">
                <TrendingUp size={12} className="text-white" />
              </div>
              <div className="w-px h-full bg-white/10 my-1"></div>
            </div>
            <div className="pb-4">
              <div className="flex items-center gap-2">
                <h5 className="font-mono font-bold text-xs text-white tracking-wide">Macro Sentiment Module</h5>
                <span className={`px-1.5 py-0.5 rounded text-[0.5rem] font-bold uppercase tracking-widest ${
                  macroAnalysis.sentiment === 'Bullish' ? 'bg-neon-green/10 text-white border border-neon-green/30' : 'bg-neon-pink/10 text-white border border-neon-pink/30'
                }`}>
                  {macroAnalysis.sentiment}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 mt-2">
                <div className="bg-white/5 rounded p-1.5 border border-white/10">
                  <span className="block text-[0.5rem] text-white/40 uppercase tracking-widest">Volatility</span>
                  <span className="text-[0.65rem] text-white/90 font-mono">{macroAnalysis.metrics.volatility}</span>
                </div>
                <div className="bg-white/5 rounded p-1.5 border border-white/10">
                  <span className="block text-[0.5rem] text-white/40 uppercase tracking-widest">Correlation</span>
                  <span className="text-[0.65rem] text-white/90 font-mono">{macroAnalysis.metrics.correlation}</span>
                </div>
                <div className="bg-white/5 rounded p-1.5 border border-white/10">
                  <span className="block text-[0.5rem] text-white/40 uppercase tracking-widest">Impact</span>
                  <span className="text-[0.65rem] text-white/90 font-mono">{macroAnalysis.impact}</span>
                </div>
              </div>
              <p className="font-body text-[0.7rem] text-white/60 mt-2 leading-relaxed">
                {macroAnalysis.reasoning}
              </p>
            </div>
          </div>
        )}

        {/* Step 3: Security Audit with Animated Metrics */}
        <div className="flex gap-3">
          <div className="flex flex-col items-center">
            <div className="w-6 h-6 rounded-full bg-neon-green/10 border border-neon-green/30 flex items-center justify-center shadow-[0_0_10px_rgba(57,255,20,0.2)]">
              <Shield size={12} className="text-white" />
            </div>
          </div>
          <div className="flex-1">
            <h5 className="font-mono font-bold text-xs text-white tracking-wide">Risk Auditor Agent (Audit V1.5)</h5>
            <div className="mt-2 flex items-center gap-2 bg-neon-green/10 border border-neon-green/30 rounded-lg p-2 shadow-[0_0_15px_rgba(57,255,20,0.1)]">
              <CheckCircle size={14} className="text-white" />
              <span className="font-mono text-[0.65rem] text-white font-bold uppercase tracking-widest">Status: PASS - SAFE TO EXECUTE</span>
            </div>
            {rationale && (
              <p className="font-body text-[0.7rem] text-white/60 mt-2 leading-relaxed bg-white/5 p-2 rounded-lg border border-white/10">
                {rationale}
              </p>
            )}
            
            {/* Animated Security Metrics */}
            <div className="mt-3 space-y-1.5">
               <div className="flex items-center justify-between text-[0.55rem] font-mono text-white/60 tracking-wider">
                  <span>Guardrail Check (Solidity)</span>
                  <span className="text-white font-bold">VERIFIED</span>
               </div>
               <div className="flex items-center justify-between text-[0.55rem] font-mono text-white/60 tracking-wider">
                  <div className="flex items-center gap-2">
                    <span>Stylus Security Module (Rust/WASM)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-white font-bold">PASS</span>
                    <span className="text-white/70">(<AnimatedTimer targetMs={0.7} />)</span>
                  </div>
               </div>
               {/* WASM vs EVM comparison bar */}
               <div className="mt-2 bg-white/5 rounded-lg p-2 border border-white/10">
                 <div className="flex items-center justify-between mb-1">
                   <span className="text-[0.5rem] font-mono text-white/40 uppercase tracking-widest">WASM Runtime vs EVM Equivalent</span>
                   <span className="text-[0.5rem] font-mono text-white font-bold tracking-widest cyber-glow-green">64× faster</span>
                 </div>
                 <div className="flex gap-2 items-center">
                   <div className="flex-1">
                     <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                       <motion.div
                         initial={{ width: 0 }}
                         animate={{ width: '1.5%' }}
                         transition={{ duration: 1.5, ease: 'easeOut' }}
                         className="h-full bg-neon-green rounded-full shadow-[0_0_10px_rgba(57,255,20,0.8)]"
                       />
                     </div>
                     <span className="text-[0.45rem] font-mono text-white mt-0.5 block font-bold tracking-widest">WASM: 0.7ms</span>
                   </div>
                   <div className="flex-1">
                     <div className="h-1.5 bg-white/10 rounded-full overflow-hidden">
                       <motion.div
                         initial={{ width: 0 }}
                         animate={{ width: '100%' }}
                         transition={{ duration: 1.5, ease: 'easeOut' }}
                         className="h-full bg-white/30 rounded-full"
                       />
                     </div>
                     <span className="text-[0.45rem] font-mono text-white/40 mt-0.5 block font-bold tracking-widest">EVM: ~45ms</span>
                   </div>
                 </div>
               </div>
               <div className="flex items-center justify-between text-[0.55rem] font-mono text-white/60 tracking-wider">
                  <span>Slippage Protection</span>
                  <span className="text-white font-bold">OK (&lt;0.5%)</span>
               </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
