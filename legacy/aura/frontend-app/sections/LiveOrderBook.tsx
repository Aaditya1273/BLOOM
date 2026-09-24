'use client';

import { useEffect, useRef, useState } from 'react';
import { Activity, Zap } from 'lucide-react';
import { API_URL } from "../lib/config";

interface OrderBookLevel {
  price: number;
  size: number;
  total?: number;
}

interface OrderBookResponse {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  depth: number;
  source: string;
  chain?: string;
  contract?: string;
  bookDepth?: { bids: number; asks: number };
}

interface LiveOrderBookProps {
  /** Asset symbol to display, e.g. "ETH" */
  asset?: string;
  /** Polling interval in ms */
  pollMs?: number;
  /** Max levels per side */
  depth?: number;
  /** Backend base URL */
  apiBase?: string;
}

const fmtPrice = (p: number) => {
  if (p === 0 || !Number.isFinite(p)) return '—';
  if (p >= 1000) return p.toFixed(2);
  if (p >= 1) return p.toFixed(2);
  return p.toFixed(4);
};

const fmtSize = (s: number) => {
  if (s === 0 || !Number.isFinite(s)) return '—';
  if (s >= 1000) return (s / 1000).toFixed(2) + 'K';
  return s.toFixed(2);
};

export default function LiveOrderBook({
  asset = 'ETH',
  pollMs = 5000,
  depth = 10,
  apiBase = `${API_URL}`,
}: LiveOrderBookProps) {
  const [data, setData] = useState<OrderBookResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updateBlink, setUpdateBlink] = useState(0); // increments on each poll for blink anim
  const lastPlacedRef = useRef<{ bids: number; asks: number } | null>(null);

  useEffect(() => {
    let active = true;

    const fetchOnce = async () => {
      try {
        const res = await fetch(
          `${apiBase}/api/orderbook/${encodeURIComponent(asset)}?source=stylus&depth=${depth}`,
          { cache: 'no-store' }
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as OrderBookResponse;
        if (!active) return;

        // Detect new orders since last poll for the blink animation.
        const prev = lastPlacedRef.current;
        const cur = { bids: json.bookDepth?.bids ?? json.bids.length, asks: json.bookDepth?.asks ?? json.asks.length };
        if (prev && (cur.bids !== prev.bids || cur.asks !== prev.asks)) {
          setUpdateBlink((b) => b + 1);
        }
        lastPlacedRef.current = cur;

        setData(json);
        setError(null);
      } catch (e: any) {
        if (active) setError(e?.message || 'fetch failed');
      }
    };

    fetchOnce();
    const iv = setInterval(fetchOnce, pollMs);
    return () => {
      active = false;
      clearInterval(iv);
    };
  }, [asset, pollMs, depth, apiBase]);

  const totalBidDepth = data?.bookDepth?.bids ?? data?.bids.length ?? 0;
  const totalAskDepth = data?.bookDepth?.asks ?? data?.asks.length ?? 0;
  const bestBid = data?.bids[0]?.price ?? 0;
  const bestAsk = data?.asks[0]?.price ?? 0;
  const spread = bestBid && bestAsk ? bestAsk - bestBid : 0;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : 0;

  // Compute max size on each side for the bar visualization.
  const maxBidSize = Math.max(1, ...(data?.bids.map((b) => b.size) ?? [0]));
  const maxAskSize = Math.max(1, ...(data?.asks.map((a) => a.size) ?? [0]));

  return (
    <div
      className="bg-[#050505] border border-[#00f0ff]/30 rounded-none overflow-hidden font-mono"
      style={{ borderLeft: '3px solid #00f0ff' }}
    >
      {/* Header */}
      <div className="px-3 py-2 border-b border-[#00f0ff]/20 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={11} className="text-[#00f0ff]" />
          <span className="text-[0.55rem] uppercase tracking-widest text-[#00f0ff] font-bold">
            Live Order Book
          </span>
          <span className="text-[0.55rem] text-white/50">{asset}-PERP</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Zap size={9} className="text-white/60" />
          <span className="text-[0.5rem] uppercase tracking-widest text-white/50">Stylus WASM</span>
          <span
            key={updateBlink}
            className="w-1.5 h-1.5 rounded-full bg-[#39ff14]"
            style={{
              animation: 'pulse 1.5s ease-in-out infinite',
              boxShadow: '0 0 8px rgba(57,255,20,0.7)',
            }}
          />
        </div>
      </div>

      {/* Spread / mid summary */}
      <div className="px-3 py-1.5 bg-[#00f0ff]/5 border-b border-[#00f0ff]/10 flex justify-between text-[0.55rem]">
        <span className="text-white/40 uppercase tracking-widest">Mid</span>
        <span className="text-white">{fmtPrice(mid)}</span>
        <span className="text-white/40 uppercase tracking-widest">Spread</span>
        <span className="text-[#00f0ff]">{spread ? fmtPrice(spread) : '—'}</span>
      </div>

      {/* Asks (top, descending) */}
      <div className="flex flex-col-reverse">
        {(data?.asks ?? []).slice(0, depth).map((row, i) => (
          <div
            key={`ask-${i}`}
            className="relative px-3 py-1 flex justify-between items-center text-[0.6rem] hover:bg-[#ff3860]/10"
          >
            <div
              className="absolute inset-y-0 right-0 bg-[#ff3860]/10"
              style={{ width: `${(row.size / maxAskSize) * 100}%` }}
            />
            <span className="relative z-10 text-[#ff3860] font-medium">{fmtPrice(row.price)}</span>
            <span className="relative z-10 text-white/70">{fmtSize(row.size)}</span>
          </div>
        ))}
        {(data?.asks?.length ?? 0) === 0 && (
          <div className="px-3 py-2 text-center text-[0.55rem] text-white/30 uppercase tracking-widest">
            No asks
          </div>
        )}
      </div>

      {/* Spread divider */}
      <div className="px-3 py-1 border-y border-[#00f0ff]/15 bg-black flex justify-between items-center text-[0.5rem] uppercase tracking-widest">
        <span className="text-white/30">Bid / Ask</span>
        <span className="text-white/30">Size</span>
      </div>

      {/* Bids (descending) */}
      <div className="flex flex-col">
        {(data?.bids ?? []).slice(0, depth).map((row, i) => (
          <div
            key={`bid-${i}`}
            className="relative px-3 py-1 flex justify-between items-center text-[0.6rem] hover:bg-[#39ff14]/10"
          >
            <div
              className="absolute inset-y-0 right-0 bg-[#39ff14]/10"
              style={{ width: `${(row.size / maxBidSize) * 100}%` }}
            />
            <span className="relative z-10 text-[#39ff14] font-medium">{fmtPrice(row.price)}</span>
            <span className="relative z-10 text-white/70">{fmtSize(row.size)}</span>
          </div>
        ))}
        {(data?.bids?.length ?? 0) === 0 && (
          <div className="px-3 py-2 text-center text-[0.55rem] text-white/30 uppercase tracking-widest">
            No bids
          </div>
        )}
      </div>

      {/* Footer: contract + total depth */}
      <div className="px-3 py-2 border-t border-[#00f0ff]/15 bg-black flex justify-between items-center text-[0.5rem] uppercase tracking-widest">
        <span className="text-white/40">
          Depth: <span className="text-white">{totalBidDepth} / {totalAskDepth}</span>
        </span>
        {data?.contract && (
          <a
            href={`https://sepolia.arbiscan.io/address/${data.contract}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#00f0ff]/60 hover:text-[#00f0ff] truncate max-w-[140px]"
            title={data.contract}
          >
            {data.contract.slice(0, 6)}…{data.contract.slice(-4)}
          </a>
        )}
      </div>

      {error && (
        <div className="px-3 py-1 text-[0.55rem] text-[#ff3860]/80 border-t border-[#ff3860]/30">
          {error}
        </div>
      )}
    </div>
  );
}
