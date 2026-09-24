"use client";

import { useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Terminal, TrendingUp, Shield, Brain, CheckCircle, Loader2 } from 'lucide-react';
import type { ReasoningStep } from '@/types';

interface ReasoningTerminalProps {
  steps: ReasoningStep[];
  isStreaming: boolean;
}

const PHASE_ICONS: Record<string, React.ElementType> = {
  INTENT_PARSER: Terminal,
  MACRO_AUDIT: TrendingUp,
  STYLUS_SIM: Shield,
  COMMITTEE: Brain,
};

const PHASE_COLORS: Record<string, string> = {
  INTENT_PARSER: 'text-white',
  MACRO_AUDIT: 'text-white',
  STYLUS_SIM: 'text-white',
  COMMITTEE: 'text-white',
};

export default function ReasoningTerminal({ steps, isStreaming }: ReasoningTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [steps]);

  if (!isStreaming && steps.length === 0) return null;

  return (
    <div className="flex gap-3 max-w-[85%]">
      <div className="flex-1">
        <span className="font-display font-semibold text-xs text-white">
          Aura Agent
        </span>
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-1 rounded-2xl rounded-tl-sm overflow-hidden border border-[#1a2340]/80 shadow-[0_0_25px_rgba(0,240,255,0.08)]"
          style={{ background: 'linear-gradient(135deg, #0a0e1a 0%, #0d1525 100%)' }}
        >
          {/* Terminal Header */}
          <div className="flex items-center justify-between px-4 py-2 border-b border-white/5" style={{ background: 'rgba(0,240,255,0.03)' }}>
            <div className="flex items-center gap-2">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-yellow-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              </div>
              <span className="font-mono text-[0.6rem] text-white/30 ml-2">aura-neural-trace v2.1</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="flex h-1.5 w-1.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-cyan-400" />
              </span>
              <span className="font-mono text-[0.5rem] text-cyan-400 uppercase tracking-wider">LIVE TRACE</span>
            </div>
          </div>

          {/* Steps */}
          <div ref={containerRef} className="p-3 space-y-1 max-h-[220px] overflow-y-auto">
            <AnimatePresence>
              {steps.map((step, index) => {
                const Icon = PHASE_ICONS[step.phase] || Terminal;
                const color = PHASE_COLORS[step.phase] || 'text-white/60';
                const isDone = step.status === 'done';
                const isActive = step.status === 'active';
                
                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.3, delay: index * 0.05 }}
                    className={`flex items-start gap-2 py-1.5 px-2 rounded-lg transition-colors duration-300 ${
                      isActive ? 'bg-white/[0.03]' : ''
                    }`}
                  >
                    {/* Status Icon */}
                    <div className="mt-0.5 shrink-0">
                      {isDone ? (
                        <CheckCircle size={13} className="text-green-400" />
                      ) : isActive ? (
                        <Loader2 size={13} className={`${color} animate-spin`} />
                      ) : (
                        <div className="w-[13px] h-[13px] rounded-full border border-white/10" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`font-mono text-[0.65rem] font-bold ${isDone ? 'text-green-400/80' : isActive ? color : 'text-white/20'}`}>
                          [{step.phase}]
                        </span>
                        <span className={`font-mono text-[0.65rem] ${isDone ? 'text-white/60' : isActive ? 'text-white/80' : 'text-white/20'}`}>
                          {step.label}
                        </span>
                        {isDone && step.durationMs && (
                          <span className="font-mono text-[0.5rem] text-green-400/60 ml-auto shrink-0">
                            {step.durationMs}ms
                          </span>
                        )}
                      </div>
                      {isActive && step.detail && (
                        <motion.p
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          className="font-mono text-[0.55rem] text-white/30 mt-0.5 leading-relaxed"
                        >
                          → {step.detail}
                        </motion.p>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>

            {/* Blinking cursor */}
            {isStreaming && (
              <div className="flex items-center gap-1 px-2 mt-1">
                <span className="font-mono text-[0.6rem] text-white/20">{'>'}</span>
                <span className="w-1.5 h-3.5 bg-cyan-400/70 animate-pulse" />
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
