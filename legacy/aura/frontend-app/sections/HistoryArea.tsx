"use client";

import { motion, AnimatePresence } from 'framer-motion';
import { ExternalLink, Clock, ArrowRightLeft, CheckCircle, XCircle, Copy, Check, Activity, Zap, TrendingUp, Shield, Fuel, ChevronDown } from 'lucide-react';
import { useState, useEffect, useMemo } from 'react';
import type { Message } from '@/types';
import TokenFlowSankey from '@/components/TokenFlowSankey';

interface HistoryAreaProps {
  messages: Message[];
  backendExecutions?: any[];
  walletAddress?: string;
}

const EXPLORER_BASE = "https://explorer.testnet.chain.robinhood.com";

interface TxOnChainData {
  status: 'confirmed' | 'rejected';
  gasUsed?: string;      // gas units used
  gasPrice?: string;     // gas price in wei
  fee?: string;          // total fee in wei
  feeFormatted?: string; // formatted in ETH
  blockNumber?: number;
  confirmations?: number;
}

function formatWeiToEth(wei: string): string {
  try {
    const val = BigInt(wei);
    const eth = Number(val) / 1e18;
    if (eth < 0.000001) return '<0.000001';
    if (eth < 0.001) return eth.toFixed(6);
    if (eth < 0.1) return eth.toFixed(5);
    return eth.toFixed(4);
  } catch {
    return '0';
  }
}

export default function HistoryArea({ messages, backendExecutions = [], walletAddress }: HistoryAreaProps) {
  const [copiedHash, setCopiedHash] = useState<string | null>(null);
  const [txChainData, setTxChainData] = useState<Record<string, TxOnChainData>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTx, setSelectedTx] = useState<string | null>(null);

  // Get locally tracked transactions
  const localTxs = messages
    .filter(m => m.transaction && m.transaction.txHash)
    .map(m => ({ tx: m.transaction!, timestamp: m.timestamp }));

  // Convert backend executions to the same format
  const mappedBackendTxs = backendExecutions.map(exec => {
    // Attempt to extract token symbols from description or txParams
    const fromToken = exec.txParams?.tokenInSymbol || exec.txParams?.description?.match(/Swap [\d.]+ ([A-Z]+)/)?.[1] || 'ETH';
    const toToken = exec.txParams?.tokenOutSymbol || exec.txParams?.description?.match(/to ([A-Z]+)/)?.[1] || 'AMZN';
    const amount = exec.txParams?.description?.match(/Swap ([\d.]+)/)?.[1] || '0.01';

    return {
      tx: {
        id: exec.id,
        strategyName: exec.txParams?.description || `Automated Swap ${exec.current}/${exec.total}`,
        from: { token: fromToken, amount: amount },
        to: { token: toToken },
        frequency: `Automated Execution (${exec.current}/${exec.total})`,
        duration: 'Continuous',
        gasEstimate: '~0.0002 ETH',
        totalEstimate: 'N/A',
        rawData: `Automated execution by Aura Agent. Strategy: ${exec.strategyId}`,
        status: exec.status as 'confirmed' | 'proposed' | 'rejected',
        txHash: exec.txHash,
        confirmedAt: exec.timestamp
      },
      timestamp: new Date(exec.timestamp)
    };
  });

  // Merge and sort all transactions by timestamp descending
  const allTxs = useMemo(() => {
    return [...localTxs, ...mappedBackendTxs].sort((a, b) => 
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );
  }, [localTxs, mappedBackendTxs]);

  // Auto-expand the first transaction
  useEffect(() => {
    if (allTxs.length > 0 && selectedTx === null) {
      setSelectedTx(allTxs[0].tx.id);
    }
  }, [allTxs.length]);

  // Stats with real gas data
  const stats = useMemo(() => {
    const confirmed = allTxs.filter(t => (txChainData[t.tx.txHash || '']?.status || t.tx.status) === 'confirmed').length;
    const reverted = allTxs.filter(t => (txChainData[t.tx.txHash || '']?.status || t.tx.status) === 'rejected').length;
    const tokens = new Set(allTxs.flatMap(t => [t.tx.from.token, t.tx.to.token]));

    // Total gas spent
    let totalGasWei = BigInt(0);
    for (const item of allTxs) {
      const data = txChainData[item.tx.txHash || ''];
      if (data?.fee) {
        try { totalGasWei += BigInt(data.fee); } catch {}
      }
    }
    const totalGas = totalGasWei > 0 ? formatWeiToEth(totalGasWei.toString()) : null;

    return { total: allTxs.length, confirmed, reverted, uniqueTokens: tokens.size, totalGas };
  }, [allTxs, txChainData]);

  useEffect(() => {
    async function fetchOnChainData() {
      setIsLoading(true);
      const newData: Record<string, TxOnChainData> = { ...txChainData };
      let changed = false;

      for (const item of allTxs) {
        if (!item.tx.txHash || newData[item.tx.txHash]) continue;
        try {
          const res = await fetch(`${EXPLORER_BASE}/api/v2/transactions/${item.tx.txHash}`);
          const data = await res.json();

          const entry: TxOnChainData = {
            status: data.status === 'ok' ? 'confirmed' : 'rejected',
          };

          // Extract real gas data from Blockscout API
          if (data.fee?.value) {
            entry.fee = data.fee.value;
            entry.feeFormatted = formatWeiToEth(data.fee.value);
          } else if (data.gas_used && data.gas_price) {
            try {
              const fee = BigInt(data.gas_used) * BigInt(data.gas_price);
              entry.fee = fee.toString();
              entry.feeFormatted = formatWeiToEth(fee.toString());
            } catch {}
          }

          if (data.gas_used) entry.gasUsed = data.gas_used;
          if (data.gas_price) entry.gasPrice = data.gas_price;
          if (data.block) entry.blockNumber = data.block;
          if (data.confirmations) entry.confirmations = data.confirmations;

          newData[item.tx.txHash] = entry;
          changed = true;
        } catch (e) {
          console.error("Failed to fetch tx data:", item.tx.txHash);
        }
      }

      if (changed) setTxChainData(newData);
      setIsLoading(false);
    }

    if (allTxs.length > 0) {
      fetchOnChainData();
    } else {
      setIsLoading(false);
    }
  }, [allTxs]);

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash);
    setCopiedHash(hash);
    setTimeout(() => setCopiedHash(null), 2000);
  };

  const formatDate = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  };

  const formatTime = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
  };

  const truncateHash = (hash: string) => {
    if (!hash || hash.length < 16) return hash || 'N/A';
    return `${hash.slice(0, 10)}...${hash.slice(-8)}`;
  };

  const timeAgo = (date: Date | string) => {
    const d = typeof date === 'string' ? new Date(date) : date;
    const diff = Date.now() - d.getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  };

  const formatGasUnits = (gas: string) => {
    try {
      const n = parseInt(gas);
      if (n > 1000000) return `${(n / 1000000).toFixed(2)}M`;
      if (n > 1000) return `${(n / 1000).toFixed(1)}K`;
      return gas;
    } catch { return gas; }
  };

  return (
    <div className="flex-1 overflow-y-auto pt-20 lg:pt-24 pb-8">
      <div className="max-w-5xl mx-auto px-4 lg:px-8">

        {/* ─── Header ─── */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="relative">
              <div className="p-3 rounded-2xl" style={{ background: 'linear-gradient(135deg, #101C36, #1A2B4A)' }}>
                <Activity className="w-6 h-6 text-green" />
              </div>
              <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green opacity-75"></span>
                <span className="relative inline-flex rounded-full h-3 w-3 bg-green"></span>
              </span>
            </div>
            <div>
              <h2 className="font-display font-bold text-2xl text-white">Execution Ledger</h2>
              <p className="font-body text-sm text-white/70">
                On-chain transaction flow history • Real-time data
              </p>
            </div>
          </div>

          {/* ─── Stats Bar ─── */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            {[
              { icon: Zap, label: 'Total Txns', value: stats.total.toString(), color: '#8B5CF6', bg: 'rgba(139,92,246,0.1)' },
              { icon: CheckCircle, label: 'Confirmed', value: stats.confirmed.toString(), color: '#1FCB4F', bg: 'rgba(31,203,79,0.1)' },
              { icon: XCircle, label: 'Reverted', value: stats.reverted.toString(), color: '#E86A56', bg: 'rgba(232,106,86,0.1)' },
              { icon: TrendingUp, label: 'Tokens', value: stats.uniqueTokens.toString(), color: '#3B82F6', bg: 'rgba(59,130,246,0.1)' },
              { icon: Fuel, label: 'Total Gas', value: stats.totalGas ? `${stats.totalGas} Ξ` : '—', color: '#F59E0B', bg: 'rgba(245,158,11,0.1)' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                className="rounded-2xl border border-border p-4 relative overflow-hidden"
                style={{ background: 'white' }}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 * i, duration: 0.4 }}
              >
                <div className="absolute top-0 right-0 w-16 h-16 rounded-full opacity-20" style={{ background: stat.bg, transform: 'translate(30%, -30%)' }} />
                <div className="flex items-center gap-2 mb-2">
                  <stat.icon size={14} style={{ color: stat.color }} />
                  <span className="font-mono text-[0.6rem] text-text-secondary uppercase tracking-wider">{stat.label}</span>
                </div>
                <span className="font-display font-bold text-xl text-navy">{stat.value}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* ─── Empty State ─── */}
        {allTxs.length === 0 ? (
          <motion.div
            className="rounded-[24px] border border-border p-16 text-center relative overflow-hidden"
            style={{ background: 'white' }}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <div className="absolute inset-0 opacity-5" style={{
              backgroundImage: 'linear-gradient(rgba(139,92,246,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.4) 1px, transparent 1px)',
              backgroundSize: '30px 30px',
            }} />
            <motion.div
              className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #101C36, #1A2B4A)' }}
              animate={{ boxShadow: ['0 0 0 0 rgba(31,203,79,0)', '0 0 0 20px rgba(31,203,79,0.1)', '0 0 0 0 rgba(31,203,79,0)'] }}
              transition={{ duration: 3, repeat: Infinity }}
            >
              <Clock className="text-green w-9 h-9" />
            </motion.div>
            <h3 className="font-display font-bold text-xl text-navy mb-2">No Transactions Yet</h3>
            <p className="font-body text-text-secondary max-w-sm mx-auto">
              Your executed strategies and swaps will appear here with real-time gas data and interactive flow visualization.
            </p>
          </motion.div>
        ) : (
          /* ─── Transaction List ─── */
          <div className="space-y-4">
            <AnimatePresence>
              {allTxs.map(({ tx, timestamp }, index) => {
                const hash = tx.txHash || '';
                const chainData = txChainData[hash];
                const realStatus = chainData?.status || tx.status;
                const isConfirmed = realStatus === 'confirmed';
                const confirmedTime = tx.confirmedAt || timestamp;
                const isExpanded = selectedTx === tx.id;

                // Real gas data
                const realGasFee = chainData?.feeFormatted;
                const realGasUsed = chainData?.gasUsed;
                const realGasPrice = chainData?.gasPrice;

                return (
                  <motion.div
                    key={tx.id}
                    layout
                    initial={{ opacity: 0, x: -30 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 30 }}
                    transition={{ delay: index * 0.08, duration: 0.4, type: 'spring', stiffness: 100 }}
                    className="group relative"
                  >
                    {/* Timeline connector line */}
                    {index < allTxs.length - 1 && (
                      <div className="absolute left-[23px] top-[72px] w-0.5 h-[calc(100%-40px)] bg-gradient-to-b from-border to-transparent z-0 hidden md:block" />
                    )}

                    <div
                      className="relative rounded-[20px] border overflow-hidden cursor-pointer transition-all duration-300"
                      style={{
                        background: 'white',
                        borderColor: isExpanded ? (isConfirmed ? 'rgba(31,203,79,0.3)' : 'rgba(232,106,86,0.3)') : 'rgba(0,0,0,0.06)',
                        boxShadow: isExpanded
                          ? (isConfirmed ? '0 8px 40px rgba(31,203,79,0.08), 0 0 0 1px rgba(31,203,79,0.1)' : '0 8px 40px rgba(232,106,86,0.08)')
                          : '0 2px 8px rgba(0,0,0,0.04)',
                      }}
                      onClick={() => setSelectedTx(isExpanded ? null : tx.id)}
                    >
                      {/* Status accent line */}
                      <div className="absolute top-0 left-0 right-0 h-[2px]" style={{
                        background: isConfirmed
                          ? 'linear-gradient(90deg, #1FCB4F, #8B5CF6, #3B82F6)'
                          : 'linear-gradient(90deg, #E86A56, #E86A56)',
                      }} />

                      {/* Header row */}
                      <div className="px-5 py-4 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                          {/* Timeline dot */}
                          <div className="relative hidden md:flex">
                            <motion.div
                              className="w-[12px] h-[12px] rounded-full"
                              style={{ background: isConfirmed ? '#1FCB4F' : '#E86A56' }}
                              animate={isConfirmed ? { boxShadow: ['0 0 0 0 rgba(31,203,79,0.4)', '0 0 0 8px rgba(31,203,79,0)', '0 0 0 0 rgba(31,203,79,0.4)'] } : {}}
                              transition={{ duration: 2, repeat: Infinity }}
                            />
                          </div>

                          {/* Status badge */}
                          <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[0.65rem] font-bold uppercase tracking-wider ${
                            isConfirmed ? 'bg-green/10 text-green' : 'bg-coral/10 text-coral'
                          }`}>
                            {isConfirmed ? <CheckCircle size={11} /> : <XCircle size={11} />}
                            {isConfirmed ? 'Confirmed' : 'Reverted'}
                          </div>

                          {/* Strategy name */}
                          <h4 className="font-display font-bold text-navy text-base hidden sm:block">
                            {tx.strategyName}
                          </h4>
                        </div>

                        <div className="flex items-center gap-3">
                          {/* Gas pill (real data) */}
                          {realGasFee && (
                            <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200/50">
                              <Fuel size={10} className="text-amber-500" />
                              <span className="font-mono text-[0.6rem] text-amber-700 font-bold">{realGasFee} Ξ</span>
                            </div>
                          )}

                          {/* Swap summary pill */}
                          <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-xl bg-navy/5">
                            <span className="font-display font-bold text-sm text-navy">{tx.from.amount} {tx.from.token}</span>
                            <motion.div animate={{ x: [0, 4, 0] }} transition={{ duration: 1.5, repeat: Infinity }}>
                              <ArrowRightLeft size={12} className="text-purple" />
                            </motion.div>
                            <span className="font-display font-bold text-sm text-green">{tx.to.token}</span>
                          </div>

                          {/* Time */}
                          <span className="font-mono text-[0.65rem] text-text-secondary">{timeAgo(confirmedTime)}</span>

                          {/* Expand indicator */}
                          <motion.div
                            animate={{ rotate: isExpanded ? 180 : 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <ChevronDown size={14} className="text-text-secondary" />
                          </motion.div>
                        </div>
                      </div>

                      {/* Mobile info */}
                      <div className="px-5 pb-2 sm:hidden">
                        <h4 className="font-display font-bold text-navy text-sm">{tx.strategyName}</h4>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="font-display font-bold text-xs text-navy">{tx.from.amount} {tx.from.token}</span>
                          <ArrowRightLeft size={10} className="text-purple" />
                          <span className="font-display font-bold text-xs text-green">{tx.to.token}</span>
                          {realGasFee && (
                            <span className="flex items-center gap-1 ml-auto text-[0.6rem] text-amber-600 font-mono">
                              <Fuel size={9} /> {realGasFee}Ξ
                            </span>
                          )}
                        </div>
                      </div>

                      {/* ─── Expanded Content ─── */}
                      <AnimatePresence>
                        {isExpanded && (
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: 'easeInOut' }}
                            className="overflow-hidden"
                          >
                            <div className="px-5 pb-5 space-y-4">
                              {/* Flow visualization with real gas */}
                              <TokenFlowSankey
                                tokenIn={tx.from.token}
                                tokenOut={tx.to.token}
                                amountIn={tx.from.amount}
                                isSuccess={isConfirmed}
                                gasUsed={realGasFee}
                              />

                              {/* Details grid — with real on-chain data */}
                              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div className="p-3 rounded-xl bg-surface border border-border/50">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Shield size={10} className="text-text-secondary" />
                                    <span className="font-mono text-[0.55rem] text-text-secondary uppercase tracking-widest">Execution</span>
                                  </div>
                                  <span className="font-display font-bold text-xs text-navy">{tx.frequency}</span>
                                </div>

                                <div className="p-3 rounded-xl bg-surface border border-border/50">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Fuel size={10} className="text-amber-500" />
                                    <span className="font-mono text-[0.55rem] text-text-secondary uppercase tracking-widest">Gas Fee</span>
                                  </div>
                                  <span className="font-display font-bold text-xs text-navy">
                                    {realGasFee ? `${realGasFee} ETH` : (isLoading ? '...' : tx.gasEstimate)}
                                  </span>
                                  {realGasUsed && (
                                    <span className="block font-mono text-[0.5rem] text-text-secondary mt-0.5">
                                      {formatGasUnits(realGasUsed)} units
                                    </span>
                                  )}
                                </div>

                                <div className="p-3 rounded-xl bg-surface border border-border/50">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Zap size={10} className="text-purple" />
                                    <span className="font-mono text-[0.55rem] text-text-secondary uppercase tracking-widest">Gas Price</span>
                                  </div>
                                  <span className="font-display font-bold text-xs text-navy">
                                    {realGasPrice ? `${(Number(realGasPrice) / 1e9).toFixed(2)} Gwei` : (isLoading ? '...' : '—')}
                                  </span>
                                </div>

                                <div className="p-3 rounded-xl bg-surface border border-border/50">
                                  <div className="flex items-center gap-1.5 mb-1">
                                    <Activity size={10} className="text-text-secondary" />
                                    <span className="font-mono text-[0.55rem] text-text-secondary uppercase tracking-widest">Time</span>
                                  </div>
                                  <span className="font-display font-bold text-xs text-navy">{formatDate(confirmedTime)}</span>
                                  <span className="block font-mono text-[0.5rem] text-text-secondary mt-0.5">{formatTime(confirmedTime)}</span>
                                </div>
                              </div>

                              {/* TX Hash */}
                              {hash && (
                                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 p-3 rounded-xl border border-border/50" style={{ background: 'rgba(16,28,54,0.02)' }}>
                                  <div className="flex items-center gap-3">
                                    <span className="font-mono text-[0.6rem] text-text-secondary uppercase tracking-widest">TX</span>
                                    <span className="font-mono text-xs text-navy font-medium bg-navy/5 px-2.5 py-1 rounded-lg">{truncateHash(hash)}</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); copyHash(hash); }}
                                      className="text-text-secondary hover:text-navy transition-colors cursor-pointer p-1.5 bg-white rounded-lg border border-border shadow-xs hover:shadow-sm"
                                    >
                                      {copiedHash === hash ? <Check size={12} className="text-green" /> : <Copy size={12} />}
                                    </button>
                                  </div>
                                  <a
                                    href={`${EXPLORER_BASE}/tx/${hash}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="flex items-center gap-1.5 text-[0.65rem] font-bold text-green hover:text-green-hover uppercase tracking-wider transition-colors px-3 py-1.5 rounded-lg hover:bg-green/5"
                                  >
                                    View on Explorer <ExternalLink size={12} />
                                  </a>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
