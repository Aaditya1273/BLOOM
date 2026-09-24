"use client";

import { Briefcase, PlayCircle, PauseCircle, Clock, Settings2, CheckCircle2, XCircle, Trash2 } from 'lucide-react';
import type { Strategy } from '@/types';

interface StrategiesAreaProps {
  strategies: Strategy[];
  onPause: (id: string) => void;
  onCancel?: (id: string) => void;
  onEdit: (strategy: Strategy) => void;
}

export default function StrategiesArea({ strategies, onPause, onCancel, onEdit }: StrategiesAreaProps) {
  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 pt-20 lg:pt-24 space-y-6">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8">
          <div className="p-3 bg-navy rounded-2xl shadow-lg">
            <Briefcase className="text-green w-6 h-6" />
          </div>
          <div>
            <h2 className="font-display font-bold text-2xl text-white">My Strategies</h2>
            <p className="font-body text-sm text-white/70">
              {strategies.length} automated {strategies.length !== 1 ? 'strategies' : 'strategy'} recorded
            </p>
          </div>
        </div>

        {strategies.length === 0 ? (
          <div className="bg-white rounded-[24px] border border-border p-12 text-center shadow-sm">
            <div className="w-16 h-16 bg-surface rounded-full flex items-center justify-center mx-auto mb-4">
              <Clock className="text-text-muted w-8 h-8" />
            </div>
            <h3 className="font-display font-bold text-lg text-navy">No active strategies</h3>
            <p className="font-body text-text-secondary mt-2 max-w-xs mx-auto">
              Use the &quot;Custom Schedule&quot; option in the Chat to set up an automated DCA strategy.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {strategies.map((strategy) => {
              const isCompleted = strategy.status === 'completed';
              const isPaused = strategy.status === 'paused';
              const isActive = strategy.status === 'active';
              const isCancelled = strategy.status === 'cancelled';
              const isFinished = isCompleted || isCancelled;
              const uniqueKey = `${strategy.id}-${strategy.status}`;

              return (
                <div key={uniqueKey} className={`bg-white rounded-[20px] border ${isFinished ? 'border-border/50 opacity-80' : 'border-border'} p-6 shadow-sm hover:shadow-md transition-shadow flex flex-col justify-between`}>
                  <div>
                    <div className="flex justify-between items-start mb-4">
                      <h3 className={`font-display font-bold text-lg ${isFinished ? 'text-navy/60' : 'text-navy'}`}>{strategy.name}</h3>
                      
                      {isActive && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-green/10 text-green rounded-full">
                          <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse" />
                          <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Active</span>
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
                          <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Completed</span>
                        </div>
                      )}
                      {isCancelled && (
                        <div className="flex items-center gap-1.5 px-2.5 py-1 bg-coral/10 text-coral/80 rounded-full">
                          <XCircle size={12} />
                          <span className="font-mono-label text-[0.6rem] uppercase tracking-wider font-bold">Cancelled</span>
                        </div>
                      )}
                    </div>

                    <div className={`flex items-center gap-4 mb-6 ${isFinished ? 'opacity-70' : ''}`}>
                      <div className="p-3 bg-surface rounded-xl">
                        <span className="font-display font-bold text-navy">{strategy.amount} {strategy.from}</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="w-8 h-px bg-border"></span>
                        <PlayCircle size={14} className={isFinished ? 'text-navy/30 my-1' : 'text-green my-1'} />
                        <span className="w-8 h-px bg-border"></span>
                      </div>
                      <div className={`p-3 rounded-xl border ${isFinished ? 'bg-surface border-border text-navy/60' : 'bg-green/10 border-green/20 text-green'}`}>
                        <span className="font-display font-bold">{strategy.to}</span>
                      </div>
                    </div>

                    <div className="space-y-2 mb-6 bg-navy/5 p-4 rounded-xl border border-border">
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-xs text-text-muted">Frequency</span>
                        <span className={`font-mono text-xs font-semibold ${isFinished ? 'text-navy/50' : 'text-navy'}`}>{strategy.frequency}</span>
                      </div>
                      {typeof strategy.completedSwaps === 'number' && typeof strategy.totalSwaps === 'number' && (
                        <div className="flex justify-between items-center">
                          <span className="font-mono text-xs text-text-muted">Progress</span>
                          <span className={`font-mono text-xs font-semibold ${isFinished ? 'text-navy/50' : 'text-navy'}`}>
                            {strategy.completedSwaps}/{strategy.totalSwaps}
                          </span>
                        </div>
                      )}
                      <div className="flex justify-between items-center">
                        <span className="font-mono text-xs text-text-muted">{isFinished ? 'Status' : 'Next Execution'}</span>
                        <span className={`font-mono text-xs font-semibold ${isActive ? 'text-green' : isPaused ? 'text-coral' : 'text-navy/50'}`}>
                          {strategy.nextExecution}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 mt-auto">
                    {!isFinished && (
                      <button
                        onClick={() => onPause(strategy.id)}
                        className={`flex-1 font-display font-semibold text-sm py-2.5 rounded-xl transition-colors flex items-center justify-center gap-2 ${
                          isPaused 
                            ? 'bg-green/10 text-green hover:bg-green/20' 
                            : 'bg-surface text-navy hover:bg-surface-alt'
                        }`}
                      >
                        {isPaused ? <PlayCircle size={16} /> : <PauseCircle size={16} />}
                        {isPaused ? 'Resume' : 'Pause'}
                      </button>
                    )}
                    {!isFinished && onCancel && (
                      <button
                        onClick={() => {
                          if (window.confirm('Cancel this strategy? The agent will stop running it immediately. This cannot be undone.')) {
                            onCancel(strategy.id);
                          }
                        }}
                        className="px-4 rounded-xl bg-coral/10 text-coral hover:bg-coral/20 transition-colors flex items-center justify-center gap-1.5 font-display font-semibold text-sm py-2.5"
                        title="Cancel strategy"
                      >
                        <Trash2 size={16} />
                        Cancel
                      </button>
                    )}
                    <button
                      onClick={() => onEdit(strategy)}
                      className={`px-4 rounded-xl transition-colors flex items-center justify-center ${
                        isFinished 
                          ? 'flex-1 bg-surface text-navy hover:bg-surface-alt py-2.5 font-display font-semibold text-sm gap-2' 
                          : 'bg-surface text-navy hover:bg-surface-alt'
                      }`}
                    >
                      {isFinished ? <PlayCircle size={16} /> : <Settings2 size={16} />}
                      {isFinished ? 'Run Again' : ''}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

