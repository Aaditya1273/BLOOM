import { X, Pause, Pencil, Clock, CheckCircle } from 'lucide-react';
import type { Strategy } from '@/types';

interface StrategyPanelProps {
  strategy: Strategy | null;
  isOpen: boolean;
  onClose: () => void;
  onPause: (id: string) => void;
}

export default function StrategyPanel({ strategy, isOpen, onClose, onPause }: StrategyPanelProps) {
  if (!isOpen || !strategy) return null;

  return (
    <>
      {/* Desktop slide-in */}
      <div className="hidden lg:block fixed right-0 top-0 bottom-0 w-[320px] bg-white z-[35] shadow-[-4px_0_24px_rgba(0,0,0,0.06)] border-l border-border"
        style={{ animation: 'slideInRight 0.35s ease-out' }}
      >
        <div className="p-6 border-b border-border flex items-center justify-between">
          <h2 className="font-display font-semibold text-lg text-navy">Strategy Details</h2>
          <button onClick={onClose} className="text-text-secondary hover:text-navy transition-colors cursor-pointer">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          <div className="flex items-center gap-2 mb-4">
            <h3 className="font-display font-semibold text-base text-navy">{strategy.name}</h3>
            <span className={`font-mono-label text-[0.6rem] px-2 py-0.5 rounded-full ${
              strategy.status === 'active' ? 'bg-green/15 text-green' : 'bg-coral/15 text-coral'
            }`}>
              {strategy.status === 'active' ? 'Active' : 'Paused'}
            </span>
          </div>

          <div className="space-y-4">
            <div>
              <span className="font-mono-label text-[0.6rem] text-text-muted uppercase">Amount</span>
              <p className="font-display font-bold text-lg text-navy">{strategy.amount} {strategy.from}</p>
            </div>
            <div>
              <span className="font-mono-label text-[0.6rem] text-text-muted uppercase">Target</span>
              <p className="font-display font-medium text-base text-green">{strategy.to}</p>
            </div>
            <div>
              <span className="font-mono-label text-[0.6rem] text-text-muted uppercase">Frequency</span>
              <p className="font-body text-sm text-navy">{strategy.frequency}</p>
            </div>
            <div className="flex items-center gap-2">
              <Clock size={14} className="text-green" />
              <span className="font-mono text-xs text-green">Next: {strategy.nextExecution}</span>
            </div>
          </div>

          {/* Execution History */}
          <div className="mt-8">
            <h4 className="font-mono-label text-[0.65rem] text-text-muted uppercase mb-3">Execution History</h4>
            <div className="space-y-2">
              {[
                { time: '2025-04-24 09:00', amount: '0.0001 ETH', status: 'success' as const },
                { time: '2025-04-23 09:00', amount: '0.0001 ETH', status: 'success' as const },
                { time: '2025-04-22 09:00', amount: '0.0001 ETH', status: 'success' as const },
              ].map((exec, i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-border/50">
                  <div>
                    <p className="font-mono text-xs text-navy">{exec.amount}</p>
                    <p className="font-mono text-[0.6rem] text-text-muted">{exec.time}</p>
                  </div>
                  <CheckCircle size={14} className="text-green" />
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="mt-8 space-y-3">
            <button
              onClick={() => onPause(strategy.id)}
              className="w-full bg-coral-light text-coral py-3 rounded-xl font-display font-semibold text-sm hover:bg-coral/20 transition-colors cursor-pointer flex items-center justify-center gap-2"
            >
              <Pause size={16} />
              Pause Strategy
            </button>
            <button className="w-full bg-surface text-navy py-3 rounded-xl font-display font-semibold text-sm hover:bg-surface-alt transition-colors cursor-pointer flex items-center justify-center gap-2">
              <Pencil size={16} />
              Edit Strategy
            </button>
          </div>
        </div>
      </div>

      {/* Mobile bottom sheet */}
      <div className="lg:hidden fixed inset-0 z-[60]">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div
          className="absolute bottom-0 left-0 right-0 bg-white rounded-t-[20px] max-h-[80vh] overflow-y-auto"
          style={{ animation: 'slideUp 0.35s ease-out' }}
        >
          <div className="p-6 border-b border-border flex items-center justify-between">
            <h2 className="font-display font-semibold text-lg text-navy">Strategy Details</h2>
            <button onClick={onClose} className="text-text-secondary hover:text-navy transition-colors cursor-pointer">
              <X size={18} />
            </button>
          </div>
          <div className="p-6">
            <div className="flex items-center gap-2 mb-4">
              <h3 className="font-display font-semibold text-base text-navy">{strategy.name}</h3>
              <span className="font-mono-label text-[0.6rem] px-2 py-0.5 rounded-full bg-green/15 text-green">Active</span>
            </div>
            <div className="space-y-4">
              <div>
                <span className="font-mono-label text-[0.6rem] text-text-muted uppercase">Amount</span>
                <p className="font-display font-bold text-lg text-navy">{strategy.amount} {strategy.from}</p>
              </div>
              <div>
                <span className="font-mono-label text-[0.6rem] text-text-muted uppercase">Target</span>
                <p className="font-display font-medium text-base text-green">{strategy.to}</p>
              </div>
              <div className="flex items-center gap-2">
                <Clock size={14} className="text-green" />
                <span className="font-mono text-xs text-green">Next: {strategy.nextExecution}</span>
              </div>
            </div>
            <div className="mt-6 space-y-3">
              <button
                onClick={() => onPause(strategy.id)}
                className="w-full bg-coral-light text-coral py-3 rounded-xl font-display font-semibold text-sm hover:bg-coral/20 transition-colors cursor-pointer flex items-center justify-center gap-2"
              >
                <Pause size={16} />
                Pause Strategy
              </button>
              <button className="w-full bg-surface text-navy py-3 rounded-xl font-display font-semibold text-sm hover:bg-surface-alt transition-colors cursor-pointer flex items-center justify-center gap-2">
                <Pencil size={16} />
                Edit Strategy
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
