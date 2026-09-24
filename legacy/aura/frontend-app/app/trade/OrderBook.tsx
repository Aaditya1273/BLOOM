"use client";
import { useState, useEffect, useMemo } from "react";
import { API_URL } from "../../lib/config";

interface OrderBookProps {
  currentPrice: number;
  selectedMarket: string;
}

type OrderRow = { price: number; size: number; total: number };
type TradeRow = { price: number; size: number; time: string; isBuy: boolean };

function generateTrades(midPrice: number): TradeRow[] {
  if (midPrice <= 0) return [];
  const trades: TradeRow[] = [];
  const now = Date.now();
  for (let i = 0; i < 25; i++) {
    const isBuy = Math.random() > 0.45;
    const offset = (Math.random() - 0.5) * midPrice * 0.002;
    const t = new Date(now - i * (Math.random() * 3000 + 500));
    trades.push({
      price: +(midPrice + offset).toFixed(2),
      size: +(Math.random() * 150 + 0.1).toFixed(2),
      time: t.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      isBuy,
    });
  }
  return trades;
}

export default function OrderBook({ currentPrice, selectedMarket }: OrderBookProps) {
  const [tab, setTab] = useState<"book" | "trades">("book");
  const [book, setBook] = useState<{ asks: OrderRow[]; bids: OrderRow[] }>({ asks: [], bids: [] });
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [bookSource, setBookSource] = useState<"on-chain" | "empty" | "offline">("offline");

  const fetchBook = async (price: number) => {
    try {
      const asset = selectedMarket.split("-")[0];
      // Wave 4: read directly from the Stylus LOB on Arbitrum Sepolia.
      // The backend endpoint translates this into get_active_orders_sorted()
      // calls on the deployed Stylus contract.
      const res = await fetch(`${API_URL}/api/orderbook/${asset}?source=stylus&depth=12`);
      if (!res.ok) {
        setBookSource("offline");
        setBook({ asks: [], bids: [] });
        setTrades(generateTrades(price));
        return;
      }
      const data = await res.json();
      const hasReal = (data.bids?.length || 0) > 0 || (data.asks?.length || 0) > 0;
      setBook({ bids: data.bids || [], asks: data.asks || [] });
      setBookSource(hasReal ? "on-chain" : "empty");
      setTrades(generateTrades(price)); // simulated trades for ambient UI life
    } catch (e) {
      console.error("Orderbook fetch failed", e);
      setBookSource("offline");
      setBook({ asks: [], bids: [] });
      setTrades(generateTrades(price));
    }
  };

  useEffect(() => {
    fetchBook(currentPrice);
    const iv = setInterval(() => fetchBook(currentPrice), 5000);
    return () => clearInterval(iv);
  }, [currentPrice, selectedMarket]);

  const maxTotal = useMemo(() => {
    const askMax = book.asks.length > 0 ? Math.max(...book.asks.map((a) => a.total)) : 1;
    const bidMax = book.bids.length > 0 ? Math.max(...book.bids.map((b) => b.total)) : 1;
    return Math.max(askMax, bidMax, 1);
  }, [book]);

  // Best ask = lowest ask, best bid = highest bid; spread = bestAsk - bestBid
  const bestAsk = book.asks.length > 0 ? book.asks[0].price : 0;
  const bestBid = book.bids.length > 0 ? book.bids[0].price : 0;
  const spread = bestAsk > 0 && bestBid > 0 ? +(bestAsk - bestBid).toFixed(3) : 0;
  const spreadPct = currentPrice > 0 ? ((Math.abs(spread) / currentPrice) * 100).toFixed(4) : "0";

  const asset = selectedMarket.split("-")[0];

  return (
    <div className="bg-[#050505] flex flex-col h-[calc(100vh-48px)] border-l border-[#00f0ff]/15 overflow-hidden">
      {/* Tabs */}
      <div className="flex border-b border-[#00f0ff]/20">
        <button
          onClick={() => setTab("book")}
          className={`flex-1 py-2 text-[10px] font-mono font-bold uppercase tracking-widest transition-all ${tab === "book" ? "text-[#00f0ff] border-b-2 border-[#00f0ff]" : "text-white/30 hover:text-white/50"}`}
        >
          Order Book
        </button>
        <button
          onClick={() => setTab("trades")}
          className={`flex-1 py-2 text-[10px] font-mono font-bold uppercase tracking-widest transition-all ${tab === "trades" ? "text-[#00f0ff] border-b-2 border-[#00f0ff]" : "text-white/30 hover:text-white/50"}`}
        >
          Trades
        </button>
      </div>

      {/* Live data badge — Stylus LOB on Arbitrum Sepolia */}
      <div className="flex items-center justify-between gap-1.5 px-2 py-1 border-b border-white/5">
        <span className="text-[8px] font-mono uppercase tracking-widest text-[#00f0ff]/40">
          Stylus · Arbitrum Sepolia
        </span>
        <div className="flex items-center gap-1.5">
          {bookSource === "on-chain" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_6px_rgba(0,240,255,0.6)] animate-pulse" />
              <span className="text-[8px] font-mono uppercase tracking-widest text-[#00f0ff]/70">Live WASM</span>
            </>
          )}
          {bookSource === "empty" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-white/30" />
              <span className="text-[8px] font-mono uppercase tracking-widest text-white/30">Book empty</span>
            </>
          )}
          {bookSource === "offline" && (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-[#FF2A6D]/70" />
              <span className="text-[8px] font-mono uppercase tracking-widest text-[#FF2A6D]/70">Backend offline</span>
            </>
          )}
        </div>
      </div>

      {tab === "book" ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Header */}
          <div className="flex justify-between px-2 py-1 text-[8px] text-white/25 font-mono uppercase tracking-widest border-b border-white/5">
            <span>Price</span>
            <span>Size ({asset})</span>
            <span>Total ({asset})</span>
          </div>

          {/* Asks (sells) — red, displayed in reverse so the lowest ask sits next to the spread */}
          <div className="flex-1 overflow-hidden flex flex-col justify-end">
            {book.asks.length === 0 ? (
              <div className="flex-1 flex items-center justify-center px-3">
                <span className="text-[10px] font-mono text-white/20">— no resting asks —</span>
              </div>
            ) : (
              [...book.asks].reverse().map((row, i) => (
                <div key={`a${i}`} className="flex justify-between px-2 py-[2px] text-[10px] font-mono relative">
                  <div className="absolute right-0 top-0 bottom-0 bg-[#FF2A6D]/8" style={{ width: `${(row.total / maxTotal) * 100}%` }} />
                  <span className="text-[#FF2A6D] z-10 font-medium">{row.price.toLocaleString()}</span>
                  <span className="text-white/50 z-10">{row.size.toFixed(2)}</span>
                  <span className="text-white/30 z-10">{row.total.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>

          {/* Spread */}
          <div className="flex justify-between px-2 py-1.5 border-y border-[#00f0ff]/15 bg-[#00f0ff]/5">
            <span className="text-[9px] font-mono text-white/40">Spread</span>
            <span className="text-[9px] font-mono text-white/50">{Math.abs(spread).toFixed(3)}</span>
            <span className="text-[9px] font-mono text-[#00f0ff]/60">{spreadPct}%</span>
          </div>

          {/* Bids (buys) — cyan, best bid first */}
          <div className="flex-1 overflow-hidden">
            {book.bids.length === 0 ? (
              <div className="flex-1 flex items-center justify-center px-3 py-3">
                <span className="text-[10px] font-mono text-white/20">— no resting bids —</span>
              </div>
            ) : (
              book.bids.map((row, i) => (
                <div key={`b${i}`} className="flex justify-between px-2 py-[2px] text-[10px] font-mono relative">
                  <div className="absolute right-0 top-0 bottom-0 bg-[#00f0ff]/8" style={{ width: `${(row.total / maxTotal) * 100}%` }} />
                  <span className="text-[#00f0ff] z-10 font-medium">{row.price.toLocaleString()}</span>
                  <span className="text-white/50 z-10">{row.size.toFixed(2)}</span>
                  <span className="text-white/30 z-10">{row.total.toFixed(2)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      ) : (
        /* Trades */
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex justify-between px-2 py-1 text-[8px] text-white/25 font-mono uppercase tracking-widest border-b border-white/5">
            <span>Price</span>
            <span>Size ({asset})</span>
            <span>Time</span>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
            {trades.map((t, i) => (
              <div key={i} className="flex justify-between px-2 py-[3px] text-[10px] font-mono">
                <span className={t.isBuy ? "text-[#00f0ff]" : "text-[#FF2A6D]"}>{t.price.toLocaleString()}</span>
                <span className="text-white/50">{t.size.toFixed(2)}</span>
                <span className="text-white/30">{t.time}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
