import { useState } from 'react';
import { X, Wallet } from 'lucide-react';
import type { TransactionProposal } from '@/types';

interface SignModalProps {
  isOpen: boolean;
  transaction: TransactionProposal | null;
  walletAddress: string;
  balance: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function SignModal({
  isOpen,
  transaction,
  walletAddress,
  balance,
  onConfirm,
  onCancel,
}: SignModalProps) {
  const [signing, setSigning] = useState(false);

  if (!isOpen || !transaction) return null;

  const handleConfirm = () => {
    setSigning(true);
    setTimeout(() => {
      setSigning(false);
      onConfirm();
    }, 1500);
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={signing ? undefined : onCancel}
      />
      <div
        className="relative bg-[#050505] border border-[#00f0ff]/40 rounded-none p-8 max-w-[420px] w-[90%] mx-4 shadow-[0_0_30px_rgba(0,240,255,0.1)]"
        style={{ animation: 'fadeInScale 0.4s ease-out' }}
      >
        {!signing && (
          <button
            onClick={onCancel}
            className="absolute top-4 right-4 text-white/30 hover:text-[#00f0ff] transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        )}

        <h2 className="font-mono font-bold text-lg text-[#00f0ff] uppercase tracking-[0.2em]"
          style={{ textShadow: '0 0 10px rgba(0,240,255,0.3)' }}
        >
          {transaction.kind === 'LIMIT_ORDER' ? 'Confirm Limit Order' : 'Confirm Transaction'}
        </h2>
        <p className="font-mono text-[0.65rem] text-white/40 mt-2 uppercase tracking-wider">
          {transaction.kind === 'LIMIT_ORDER'
            ? 'Your wallet will switch to Arbitrum Sepolia to write the order into the Stylus LOB.'
            : 'Review the transaction details before signing with your wallet.'}
        </p>

        {/* Transaction Summary */}
        <div className="bg-[#00f0ff]/5 border border-[#00f0ff]/20 rounded-none p-4 mt-5">
          {(() => {
            const isLimit = transaction.kind === 'LIMIT_ORDER';
            const lo = transaction.limitOrder;
            const rows = isLimit && lo
              ? [
                  { label: 'Type', value: `${lo.isLong ? 'LONG' : 'SHORT'} ${lo.asset}` },
                  { label: 'Leverage', value: `${lo.leverage}x` },
                  { label: 'Limit Price', value: `$${lo.limitPrice}` },
                  { label: 'Collateral', value: `$${lo.collateral}` },
                  { label: 'Network', value: transaction.network || 'Arbitrum Sepolia', hasDot: true },
                  { label: 'Backend', value: 'Stylus WASM' },
                ]
              : [
                  { label: 'Strategy', value: transaction.strategyName },
                  { label: 'Amount', value: `${transaction.from.amount} ${transaction.from.token}` },
                  { label: 'Frequency', value: transaction.frequency },
                  { label: 'Network', value: transaction.network || 'Robinhood Chain', hasDot: true },
                  { label: 'Est. Gas', value: transaction.gasEstimate },
                ];
            return rows.map((row, i, arr) => (
              <div
                key={row.label}
                className={`flex justify-between items-center py-2 ${
                  i < arr.length - 1 ? 'border-b border-[#00f0ff]/10' : ''
                }`}
              >
                <span className="font-mono text-[0.6rem] text-white/30 uppercase tracking-widest">{row.label}</span>
                <span className="font-mono text-[0.7rem] text-white/80 font-medium flex items-center gap-1.5">
                  {row.hasDot && (
                    <span className="w-1.5 h-1.5 rounded-none bg-[#00f0ff]" style={{ boxShadow: '0 0 6px rgba(0,240,255,0.5)' }} />
                  )}
                  {row.value}
                </span>
              </div>
            ));
          })()}
        </div>

        {/* AI Confidence Score */}
        {transaction.confidenceScore != null && (
          <div className="mt-5 flex items-center gap-3 bg-[#0a0a0a] border border-[#00f0ff]/20 p-3">
            <div className="relative w-10 h-10 flex items-center justify-center">
              <svg className="w-10 h-10 -rotate-90" viewBox="0 0 36 36">
                <circle cx="18" cy="18" r="15" fill="none" stroke="#00f0ff" strokeOpacity="0.15" strokeWidth="3" />
                <circle cx="18" cy="18" r="15" fill="none"
                  stroke={transaction.confidenceScore >= 70 ? '#00f0ff' : transaction.confidenceScore >= 40 ? '#f0a000' : '#ff2a6d'}
                  strokeWidth="3" strokeDasharray={`${transaction.confidenceScore * 0.942} 94.2`} strokeLinecap="round" />
              </svg>
              <span className="absolute text-[9px] font-mono font-bold"
                style={{ color: transaction.confidenceScore >= 70 ? '#00f0ff' : transaction.confidenceScore >= 40 ? '#f0a000' : '#ff2a6d' }}>
                {transaction.confidenceScore}
              </span>
            </div>
            <div>
              <p className="font-mono text-[0.6rem] text-white/30 uppercase tracking-widest">AI Confidence</p>
              <p className="font-mono text-xs font-bold"
                style={{ color: transaction.confidenceScore >= 70 ? '#00f0ff' : transaction.confidenceScore >= 40 ? '#f0a000' : '#ff2a6d' }}>
                {transaction.confidenceScore >= 80 ? 'High Confidence' : transaction.confidenceScore >= 60 ? 'Moderate' : transaction.confidenceScore >= 40 ? 'Low Confidence' : 'Caution'}
              </p>
            </div>
          </div>
        )}

        {/* Wallet Info */}
        <div className="mt-5">
          <span className="font-mono text-[0.55rem] text-white/30 uppercase tracking-widest">
            Signing as
          </span>
          <p className="font-mono text-xs text-[#00f0ff] mt-1 truncate">
            {walletAddress}
          </p>
          <p className="font-mono text-[0.65rem] text-white/40 mt-1">
            {balance} available
          </p>
        </div>

        {/* Buttons */}
        <div className="flex flex-col gap-3 mt-6">
          {signing ? (
            <div className="flex items-center justify-center gap-2 py-3.5 bg-[#00f0ff]/10 border border-[#00f0ff]/30 rounded-none">
              <div className="w-4 h-4 border-2 border-[#00f0ff] border-t-transparent rounded-full animate-spin" />
              <span className="font-mono text-xs text-white/70 uppercase tracking-wider">Waiting for wallet signature...</span>
            </div>
          ) : (
            <>
              <button
                onClick={handleConfirm}
                className="w-full bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff] font-mono font-bold text-sm py-3.5 rounded-none hover:bg-[#00f0ff]/20 hover:shadow-[0_0_20px_rgba(0,240,255,0.3)] transition-all duration-200 flex items-center justify-center gap-2 cursor-pointer uppercase tracking-widest"
              >
                <Wallet size={16} />
                {transaction.kind === 'LIMIT_ORDER' ? 'Sign Limit Order' : 'Sign with Wallet'}
              </button>
              <button
                onClick={onCancel}
                className="w-full border border-white/20 text-white/40 font-mono font-bold text-xs py-3 rounded-none hover:bg-white/5 hover:text-white/60 transition-colors cursor-pointer uppercase tracking-widest"
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
