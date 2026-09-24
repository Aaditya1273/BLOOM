"use client";

import { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Shield, X, AlertTriangle, Plus } from "lucide-react";
import { API_URL } from "@/lib/config";

interface LiquidationAlert {
  positionId: number;
  owner: string;
  asset: string;
  isLong: boolean;
  leverage: number;
  collateral: string;
  entryPrice: string;
  currentPrice: number;
  healthBps: number;
  healthPct: number;
  thresholdBps: number;
  recommendedTopUp: string;
  maxTopUpPerEvent: string;
  pnl: string;
  fundingFee: string;
  timestamp: number;
}

interface LiquidationAlertsProps {
  ownerAddress?: string;
  onQuickAddMargin?: (positionId: number, recommendedAmount: string) => void;
}

export default function LiquidationAlerts({ ownerAddress, onQuickAddMargin }: LiquidationAlertsProps) {
  const [alerts, setAlerts] = useState<LiquidationAlert[]>([]);
  const lastSeenRef = useRef<number>(Date.now());

  // Poll for new alerts every 4s. Cheaper than SSE for low-frequency events.
  useEffect(() => {
    if (!ownerAddress) return;

    const poll = async () => {
      try {
        const url = `${API_URL}/api/liquidation-alerts?since=${lastSeenRef.current}&owner=${ownerAddress}`;
        const res = await fetch(url);
        const events: LiquidationAlert[] = await res.json();
        if (events.length > 0) {
          lastSeenRef.current = Math.max(...events.map(e => e.timestamp));
          // De-duplicate: keep only the latest alert per position
          setAlerts(prev => {
            const merged = [...prev];
            for (const event of events) {
              const idx = merged.findIndex(a => a.positionId === event.positionId);
              if (idx >= 0) merged[idx] = event;
              else merged.push(event);
            }
            return merged.slice(-5);
          });
        }
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => clearInterval(interval);
  }, [ownerAddress]);

  // Auto-dismiss alerts older than 60s (user can act in that window)
  useEffect(() => {
    if (alerts.length === 0) return;
    const timer = setInterval(() => {
      setAlerts(prev => prev.filter(a => Date.now() - a.timestamp < 60_000));
    }, 5000);
    return () => clearInterval(timer);
  }, [alerts]);

  const dismiss = (ts: number) => {
    setAlerts(prev => prev.filter(a => a.timestamp !== ts));
  };

  if (!ownerAddress || alerts.length === 0) return null;

  return (
    <div className="fixed top-14 right-4 z-[100] space-y-2 max-w-sm">
      <AnimatePresence>
        {alerts.map((alert) => {
          // Severity color: red below 10%, orange below 20%, yellow otherwise
          const severityColor =
            alert.healthPct < 10 ? "#FF2A6D" : alert.healthPct < 20 ? "#FFA500" : "#FFD700";

          return (
            <motion.div
              key={alert.timestamp}
              initial={{ opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 100, scale: 0.9 }}
              className="bg-[#050505] border p-3 shadow-[0_0_24px_rgba(255,42,109,0.2)]"
              style={{ borderColor: `${severityColor}60` }}
            >
              <div className="flex items-start gap-2">
                <motion.div
                  animate={{ scale: [1, 1.15, 1] }}
                  transition={{ duration: 1.2, repeat: Infinity }}
                >
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: severityColor }} />
                </motion.div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield className="w-3 h-3" style={{ color: severityColor }} />
                    <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: severityColor }}>
                      Liquidation Risk
                    </span>
                    <button onClick={() => dismiss(alert.timestamp)} className="ml-auto text-white/30 hover:text-white">
                      <X className="w-3 h-3" />
                    </button>
                  </div>

                  <p className="text-[11px] text-white/90 font-mono">
                    Position #{alert.positionId} — <span className={alert.isLong ? "text-[#00f0ff]" : "text-[#FF2A6D]"}>{alert.isLong ? "LONG" : "SHORT"}</span> {alert.asset} {alert.leverage}x
                  </p>

                  <div className="grid grid-cols-2 gap-2 mt-2 text-[9px] font-mono">
                    <div>
                      <p className="text-white/40 uppercase tracking-widest text-[8px]">Health</p>
                      <p className="font-bold" style={{ color: severityColor }}>{alert.healthPct.toFixed(1)}%</p>
                    </div>
                    <div>
                      <p className="text-white/40 uppercase tracking-widest text-[8px]">Threshold</p>
                      <p className="text-white/70">{(alert.thresholdBps / 100).toFixed(0)}%</p>
                    </div>
                    <div>
                      <p className="text-white/40 uppercase tracking-widest text-[8px]">Loss</p>
                      <p className="text-[#FF2A6D]">-${parseFloat(alert.pnl).toFixed(2)}</p>
                    </div>
                    <div>
                      <p className="text-white/40 uppercase tracking-widest text-[8px]">Recommended</p>
                      <p className="text-[#00f0ff]">+{parseFloat(alert.recommendedTopUp).toFixed(2)} aUSD</p>
                    </div>
                  </div>

                  {onQuickAddMargin && (
                    <button
                      onClick={() => {
                        onQuickAddMargin(alert.positionId, alert.recommendedTopUp);
                        dismiss(alert.timestamp);
                      }}
                      className="mt-2 w-full flex items-center justify-center gap-1 px-2 py-1.5 bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20 text-[10px] font-bold font-mono transition uppercase tracking-widest"
                    >
                      <Plus className="w-3 h-3" />
                      Add {parseFloat(alert.recommendedTopUp).toFixed(2)} aUSD Margin
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
