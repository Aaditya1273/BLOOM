"use client";

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Bot,
  PlayCircle,
  PauseCircle,
  ChevronDown,
  ChevronUp,
  Shield,
  ExternalLink,
  Zap,
  Clock,
  CheckCircle2,
  XCircle,
  Trash2,
} from 'lucide-react';
import type { Strategy } from '@/types';

interface AgentWorkspaceProps {
  strategies: Strategy[];
  executions: any[];
  onPause: (id: string) => void;
  onCancel?: (id: string) => void;
  onAction: (text: string) => void;
}

function getTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function AgentWorkspace({ strategies, executions, onPause, onCancel, onAction }: AgentWorkspaceProps) {
  const [expandedAgent, setExpandedAgent] = useState<string | null>(null);

  // Match executions to strategies
  const getExecutionsForStrategy = (strategyId: string) => {
    return executions
      .filter((e) => e.strategyId === strategyId)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 8);
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 pt-20 lg:pt-24 space-y-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-purple-600/20 rounded-2xl shadow-lg border border-purple-500/20">
            <Bot className="text-purple-400 w-6 h-6" />
          </div>
          <div>
            <h2 className="font-display font-bold text-2xl text-white">Active Autonomous Agents</h2>
            <p className="font-body text-sm text-white/70">
              {strategies.length} deployed wealth {strategies.length !== 1 ? 'agents' : 'agent'} — working for you 24/7
            </p>
          </div>
        </div>

        {strategies.length === 0 ? (
          <div className="bg-white rounded-[24px] border border-border p-12 text-center shadow-sm">
            <div className="w-16 h-16 bg-purple-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <Bot className="text-purple-300 w-8 h-8" />
            </div>
            <h3 className="font-display font-bold text-lg text-navy">No agents deployed</h3>
            <p className="font-body text-text-secondary mt-2 max-w-xs mx-auto">
              Create a DCA or recurring strategy in the Chat to deploy your first autonomous agent.
            </p>
            <button
              onClick={() => onAction('Daily ETH → AMZN')}
              className="mt-4 px-4 py-2 bg-purple-600/10 text-purple-600 rounded-xl font-display font-semibold text-sm hover:bg-purple-600/20 transition-colors cursor-pointer"
            >
              + Deploy First Agent
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            {strategies.map((agent, idx) => {
              const isActive = agent.status === 'active';
              const isPaused = agent.status === 'paused';
              const isCompleted = agent.status === 'completed';
              const isCancelled = agent.status === 'cancelled';
              const isFinished = isCompleted || isCancelled;
              const isExpanded = expandedAgent === agent.id;
              const agentExecs = getExecutionsForStrategy(agent.id);

              // Parse progress from frequency
              const freqMatch = agent.frequency.match(/(\d+)\s*Executions/i);
              const totalSwaps = freqMatch ? parseInt(freqMatch[1], 10) : 0;
              const completedSwaps =
                typeof agent.completedSwaps === 'number'
                  ? agent.completedSwaps
                  : agentExecs.filter((e) => e.status === 'confirmed').length;
              const progress = totalSwaps > 0 ? Math.min((completedSwaps / totalSwaps) * 100, 100) : 0;

              return (
                <motion.div
                  key={agent.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.1 }}
                  className={`bg-white rounded-[20px] border ${isFinished ? 'border-border/50 opacity-75' : 'border-border'} shadow-sm hover:shadow-md transition-shadow overflow-hidden`}
                >
                  {/* Agent Header */}
                  <div className="p-6 pb-4">
                    <div className="flex justify-between items-start">
                      <div className="flex items-center gap-3">
                        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${
                          isActive ? 'bg-green/10' : isPaused ? 'bg-coral/10' : 'bg-navy/5'
                        }`}>
                          <Bot size={20} className={isActive ? 'text-green' : isPaused ? 'text-coral' : 'text-navy/40'} />
                        </div>
                        <div>
                          <h3 className={`font-display font-bold text-lg ${isFinished ? 'text-navy/60' : 'text-navy'}`}>
                            {agent.name}
                          </h3>
                          <p className="font-mono text-[0.65rem] text-text-muted">
                            Agent #{agent.id.slice(0, 8)} • {agent.frequency}
                          </p>
                        </div>
                      </div>

                      {/* Status Badge */}
                      <div className="flex items-center gap-2">
                        {/* Stylus Shield Badge */}
                        <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded-full">
                          <Shield size={10} className="text-emerald-500" />
                          <span className="font-mono text-[0.5rem] text-emerald-600 font-bold uppercase">Stylus</span>
                        </div>

                        {isActive && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green/10 text-green rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                            <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Live</span>
                          </div>
                        )}
                        {isPaused && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-coral/10 text-coral rounded-full">
                            <span className="w-1.5 h-1.5 rounded-full bg-coral" />
                            <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Paused</span>
                          </div>
                        )}
                        {isCompleted && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-navy/5 text-navy/40 rounded-full">
                            <CheckCircle2 size={12} />
                            <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Complete</span>
                          </div>
                        )}
                        {isCancelled && (
                          <div className="flex items-center gap-1.5 px-2.5 py-1 bg-coral/10 text-coral/80 rounded-full">
                            <XCircle size={12} />
                            <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Cancelled</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Mandate */}
                    <div className="mt-4 bg-navy/[0.03] border border-navy/5 rounded-xl p-3">
                      <div className="flex items-center gap-2 mb-1.5">
                        <Zap size={12} className="text-purple-500" />
                        <span className="font-mono text-[0.55rem] text-purple-500 uppercase tracking-wider font-bold">Agent Mandate</span>
                      </div>
                      <p className="font-body text-sm text-navy">
                        Accumulate <strong className="text-green">{agent.to}</strong> with{' '}
                        <strong>{agent.amount} {agent.from}</strong> • {agent.frequency}
                      </p>
                    </div>

                    {/* Progress Bar */}
                    {totalSwaps > 0 && (
                      <div className="mt-4">
                        <div className="flex justify-between items-center mb-1.5">
                          <span className="font-mono text-[0.6rem] text-text-muted">Execution Progress</span>
                          <span className="font-mono text-[0.6rem] text-navy font-bold">{completedSwaps}/{totalSwaps}</span>
                        </div>
                        <div className="h-2 bg-navy/5 rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{ width: `${progress}%` }}
                            transition={{ duration: 1, ease: 'easeOut' }}
                            className={`h-full rounded-full ${isActive ? 'bg-green' : isPaused ? 'bg-coral' : 'bg-navy/30'}`}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Expandable Execution History */}
                  <div className="border-t border-border/50">
                    <button
                      onClick={() => setExpandedAgent(isExpanded ? null : agent.id)}
                      className="w-full flex items-center justify-between px-6 py-3 hover:bg-navy/[0.02] transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <Clock size={14} className="text-text-muted" />
                        <span className="font-body text-xs text-text-secondary">
                          Execution History ({agentExecs.length})
                        </span>
                      </div>
                      {isExpanded ? <ChevronUp size={14} className="text-text-muted" /> : <ChevronDown size={14} className="text-text-muted" />}
                    </button>

                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-6 pb-4 space-y-2">
                            {agentExecs.length === 0 ? (
                              <p className="font-mono text-[0.65rem] text-text-muted text-center py-3">No executions yet</p>
                            ) : (
                              agentExecs.map((exec) => (
                                <div
                                  key={exec.id}
                                  className="flex items-center justify-between bg-surface rounded-lg p-2.5"
                                >
                                  <div className="flex items-center gap-2">
                                    {exec.status === 'confirmed' ? (
                                      <CheckCircle2 size={14} className="text-green shrink-0" />
                                    ) : (
                                      <XCircle size={14} className="text-coral shrink-0" />
                                    )}
                                    <div>
                                      <span className="font-mono text-[0.65rem] text-navy block">
                                        Swap {exec.current}/{exec.total}
                                      </span>
                                      <span className="font-mono text-[0.55rem] text-text-muted">
                                        {exec.timestamp ? getTimeSince(exec.timestamp) : 'Unknown'}
                                        {exec.blockNumber && ` • Block #${exec.blockNumber}`}
                                      </span>
                                    </div>
                                  </div>
                                  {exec.txHash && (
                                    <a
                                      href={`https://explorer.testnet.chain.robinhood.com/tx/${exec.txHash}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-text-muted hover:text-navy transition-colors"
                                    >
                                      <ExternalLink size={12} />
                                    </a>
                                  )}
                                </div>
                              ))
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Actions */}
                  {!isFinished && (
                    <div className="px-6 pb-4 flex gap-3">
                      <button
                        onClick={() => onPause(agent.id)}
                        className={`flex-1 font-display font-semibold text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer ${
                          isPaused
                            ? 'bg-green/10 text-green hover:bg-green/20'
                            : 'bg-surface text-navy hover:bg-surface-alt'
                        }`}
                      >
                        {isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                        {isPaused ? 'Resume Agent' : 'Pause Agent'}
                      </button>
                      {onCancel && (
                        <button
                          onClick={() => {
                            if (window.confirm('Cancel this agent? It will stop executing immediately. This cannot be undone.')) {
                              onCancel(agent.id);
                            }
                          }}
                          className="px-4 rounded-xl bg-coral/10 text-coral hover:bg-coral/20 transition-colors flex items-center justify-center gap-1.5 font-display font-semibold text-sm py-2.5 cursor-pointer"
                          title="Cancel agent"
                        >
                          <Trash2 size={16} />
                          Cancel
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
