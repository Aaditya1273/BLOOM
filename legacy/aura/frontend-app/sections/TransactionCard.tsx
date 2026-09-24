import { useState, useEffect } from 'react';
import { ArrowRightLeft, Shield, X, ChevronDown, ChevronUp, CheckCircle, Zap } from 'lucide-react';
import type { TransactionProposal } from '@/types';

interface TransactionCardProps {
  transaction: TransactionProposal;
  onSign: () => void;
  onReject: () => void;
}

export default function TransactionCard({
  transaction,
  onSign,
  onReject,
}: TransactionCardProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [status, setStatus] = useState(transaction.status);

  useEffect(() => {
    setStatus(transaction.status);
  }, [transaction.status]);

  const handleSign = () => {
    setStatus('submitted');
    onSign();
  };

  const isProposed = status === 'proposed';
  const isSubmitted = status === 'submitted';
  const isConfirmed = status === 'confirmed';
  const isRejected = status === 'rejected';

  return (
    <div className="mt-3 bg-[#050505] border border-[#00f0ff]/30 rounded-none overflow-hidden shadow-[0_0_10px_rgba(255,255,255,0.05)]"
      style={{ borderLeft: '3px solid #00f0ff' }}
    >
      {/* Header */}
      <div className="px-5 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ArrowRightLeft size={14} className="text-white" />
            <span className="font-mono text-[0.6rem] text-white uppercase tracking-widest"
              style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}
            >
              Transaction Proposal
            </span>
          </div>
          {/* Stylus Shield Badge */}
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-none border border-[#00f0ff]/30 bg-[#00f0ff]/5"
            style={{
              boxShadow: isConfirmed ? '0 0 12px rgba(255,255,255,0.2)' : 'none',
            }}
          >
            <Shield size={10} className="text-white" />
            <span className="font-mono text-[0.5rem] text-white font-bold uppercase tracking-widest">
              Stylus Shield {isConfirmed ? 'Verified' : 'Active'}
            </span>
            {isConfirmed && <CheckCircle size={9} className="text-white" />}
          </div>
        </div>
        <h3 className="font-mono font-bold text-sm text-white/90 mt-2 tracking-wider uppercase">
          {transaction.strategyName}
        </h3>
      </div>

      {/* WASM Performance Badge (visible when confirmed) */}
      {isConfirmed && (
        <div className="mx-5 mt-3 flex items-center gap-3 bg-[#00f0ff]/5 border border-[#00f0ff]/20 rounded-none px-3 py-2 shadow-[0_0_10px_rgba(255,255,255,0.08)]">
          <div className="flex items-center gap-1.5">
            <Zap size={10} className="text-white" />
            <span className="font-mono text-[0.5rem] text-white font-bold tracking-widest" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>WASM RUNTIME</span>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <span className="font-mono text-[0.45rem] text-white/50 block uppercase tracking-wider">Guardrail</span>
              <span className="font-mono text-[0.6rem] text-white font-bold">0.7ms</span>
            </div>
            <div className="h-5 w-px bg-[#00f0ff]/20" />
            <div>
              <span className="font-mono text-[0.45rem] text-white/50 block uppercase tracking-wider">EVM Equiv.</span>
              <span className="font-mono text-[0.6rem] text-white/25 line-through">~45ms</span>
            </div>
            <div className="h-5 w-px bg-[#00f0ff]/20" />
            <div>
              <span className="font-mono text-[0.45rem] text-white/50 block uppercase tracking-wider">Savings</span>
              <span className="font-mono text-[0.6rem] text-white font-bold" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>98.4%</span>
            </div>
          </div>
        </div>
      )}

      {/* Details Grid */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 px-5 mt-4">
        <div>
          <span className="font-mono text-[0.5rem] text-white/30 uppercase tracking-widest">From</span>
          <p className="font-mono font-bold text-base text-white">
            {transaction.from.amount} {transaction.from.token}
          </p>
        </div>
        <div>
          <span className="font-mono text-[0.5rem] text-white/30 uppercase tracking-widest">To</span>
          <p className="font-mono font-bold text-base text-white" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>
            {transaction.to.token}
          </p>
        </div>
        <div>
          <span className="font-mono text-[0.5rem] text-white/30 uppercase tracking-widest">Frequency</span>
          <p className="font-mono font-medium text-xs text-white/70">{transaction.frequency}</p>
        </div>
        <div>
          <span className="font-mono text-[0.5rem] text-white/30 uppercase tracking-widest">Duration</span>
          <p className="font-mono font-medium text-xs text-white/70">{transaction.duration}</p>
        </div>
        <div>
          <span className="font-mono text-[0.5rem] text-white/30 uppercase tracking-widest">Gas Estimate</span>
          <p className="font-mono text-xs text-white/50">{transaction.gasEstimate}</p>
        </div>
        <div>
          <span className="font-mono text-[0.5rem] text-white/30 uppercase tracking-widest">Total Est.</span>
          <p className="font-mono text-xs text-white/50">{transaction.totalEstimate}</p>
        </div>
      </div>

      {/* Raw Data Toggle */}
      <div className="px-5 mt-4">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="flex items-center gap-1 text-white/30 hover:text-white transition-colors cursor-pointer"
        >
          <span className="font-mono text-[10px] uppercase tracking-widest">{showDetails ? 'Hide' : 'Show'} Details</span>
          {showDetails ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {showDetails && (
          <div className="bg-[#050505] border border-[#00f0ff]/20 rounded-none p-3 mt-2">
            <pre className="font-mono text-[0.65rem] text-white/60 whitespace-pre-wrap break-all">
              {transaction.rawData}
            </pre>
          </div>
        )}
      </div>

      {/* Status / Actions */}
      <div className="px-5 py-4 mt-2">
        {isProposed && (
          <div className="flex gap-3">
            <button
              onClick={handleSign}
              className="flex-1 bg-[#00f0ff]/10 text-white border border-[#00f0ff] font-mono font-bold tracking-widest text-xs py-3 rounded-none hover:bg-[#00f0ff]/20 transition-all duration-300 flex items-center justify-center gap-2 cursor-pointer uppercase"
              style={{ boxShadow: '0 0 20px rgba(255,255,255,0.2)' }}
            >
              <Shield size={14} />
              Sign & Execute
            </button>
            <button
              onClick={onReject}
              className="px-5 py-3 border border-white/20 text-white/50 rounded-none font-mono font-bold tracking-widest text-xs hover:bg-white/5 hover:text-white/80 transition-all cursor-pointer uppercase"
            >
              <X size={14} className="inline mr-1" />
              Reject
            </button>
          </div>
        )}

        {isSubmitted && (
          <div className="flex items-center justify-center gap-2 py-2">
            <div className="w-4 h-4 border-2 border-[#00f0ff] border-t-transparent rounded-full animate-spin" />
            <span className="font-mono tracking-widest uppercase text-[10px] text-white/70">Transaction Submitted...</span>
          </div>
        )}

        {isConfirmed && (
          <div className="flex items-center justify-center gap-2 py-2 bg-[#00f0ff]/10 border border-[#00f0ff]/30 rounded-none shadow-[0_0_10px_rgba(255,255,255,0.1)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="text-white">
              <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <span className="font-mono tracking-widest text-[10px] text-white font-bold uppercase" style={{ textShadow: '0 0 8px rgba(255,255,255,0.3)' }}>Confirmed On-Chain</span>
          </div>
        )}

        {isRejected && (
          <div className="flex items-center justify-center gap-2 py-2 bg-white/5 border border-white/20 rounded-none">
            <X size={14} className="text-white/50" />
            <span className="font-mono tracking-widest text-[10px] text-white/50 font-bold uppercase">Rejected</span>
          </div>
        )}
      </div>
    </div>
  );
}
