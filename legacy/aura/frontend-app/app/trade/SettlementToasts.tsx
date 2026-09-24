"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Zap, X, ArrowRight } from "lucide-react";
import { API_URL } from "@/lib/config";

interface SettlementEvent {
  orderId: number;
  asset: string;
  isLong: boolean;
  leverage: number;
  collateral: number;
  txHash: string;
  sourceChain: string;
  destChain: string;
  timestamp: number;
}

export default function SettlementToasts() {
  const [toasts, setToasts] = useState<SettlementEvent[]>([]);
  const lastSeenRef = useRef<number>(Date.now());

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${API_URL}/api/settlement-events?since=${lastSeenRef.current}`);
        const events: SettlementEvent[] = await res.json();
        if (events.length > 0) {
          lastSeenRef.current = Math.max(...events.map(e => e.timestamp));
          setToasts(prev => [...prev, ...events].slice(-5));
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-dismiss after 8s
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setTimeout(() => {
      setToasts(prev => prev.slice(1));
    }, 8000);
    return () => clearTimeout(timer);
  }, [toasts]);

  const dismiss = (ts: number) => {
    setToasts(prev => prev.filter(t => t.timestamp !== ts));
  };

  return (
    <div className="fixed top-14 right-4 z-[100] space-y-2 max-w-sm">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div
            key={t.timestamp}
            initial={{ opacity: 0, x: 100, scale: 0.9 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 100, scale: 0.9 }}
            className="bg-[#050505] border border-[#00f0ff]/40 p-3 shadow-[0_0_20px_rgba(0,240,255,0.15)]"
          >
            <div className="flex items-start gap-2">
              <Zap className="w-4 h-4 text-[#00f0ff] shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-[9px] font-bold text-[#00f0ff] uppercase tracking-widest">Cross-Chain Settlement</span>
                  <button onClick={() => dismiss(t.timestamp)} className="ml-auto text-white/30 hover:text-white">
                    <X className="w-3 h-3" />
                  </button>
                </div>
                <p className="text-[11px] text-white/90 font-mono">
                  Order #{t.orderId} — <span className={t.isLong ? "text-[#00f0ff]" : "text-[#FF2A6D]"}>{t.isLong ? "LONG" : "SHORT"}</span> {t.asset} {t.leverage}x
                </p>
                <div className="flex items-center gap-1.5 mt-1.5 text-[9px] text-white/50">
                  <span className="text-[#00f0ff]/70">{t.sourceChain}</span>
                  <ArrowRight className="w-3 h-3 text-[#00f0ff]/50" />
                  <span className="text-[#00f0ff]/70">{t.destChain}</span>
                </div>
                {t.txHash && (
                  <a
                    href={`https://explorer.testnet.chain.robinhood.com/tx/${t.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[8px] text-[#00f0ff]/50 hover:text-[#00f0ff] mt-1 block truncate"
                  >
                    tx: {t.txHash.slice(0, 20)}...
                  </a>
                )}
              </div>
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
