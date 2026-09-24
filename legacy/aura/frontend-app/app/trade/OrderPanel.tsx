"use client";
import { useState } from "react";
import { Activity, Zap, TrendingUp, TrendingDown, Send, ShieldCheck, ChevronDown } from "lucide-react";
import CubeButton from "./CubeButton";

interface OrderPanelProps {
  tradingMode: "ai" | "manual";
  setTradingMode: (m: "ai" | "manual") => void;
  balance: string;
  arbBalance: string;
  isMinting: boolean;
  account: any;
  handleMintFaucet: () => void;
  handleMintArbitrumFaucet: () => void;
  // AI mode
  prompt: string;
  setPrompt: (s: string) => void;
  isProcessing: boolean;
  handleAction: (e: React.FormEvent) => void;
  agentLogs: {id:number;timestamp:string;message:string;type:"info"|"alert"|"action"}[];
  // Manual mode
  selectedMarket: string;
  prices: Record<string, number>;
  manualIsLong: boolean;
  setManualIsLong: (b: boolean) => void;
  manualCollateral: string;
  setManualCollateral: (s: string) => void;
  manualLeverage: string;
  setManualLeverage: (s: string) => void;
  orderType: "market" | "limit";
  setOrderType: (t: "market" | "limit") => void;
  limitPrice: string;
  setLimitPrice: (s: string) => void;
  rawBalance: number;
  handleManualAction: (isLong: boolean, tpPrice?: string, slPrice?: string) => void;
}

export default function OrderPanel(props: OrderPanelProps) {
  const {
    tradingMode, setTradingMode, balance, arbBalance, isMinting, account, handleMintFaucet, handleMintArbitrumFaucet,
    prompt, setPrompt, isProcessing, handleAction, agentLogs,
    selectedMarket, prices, manualIsLong, setManualIsLong,
    manualCollateral, setManualCollateral, manualLeverage, setManualLeverage,
    orderType, setOrderType, limitPrice, setLimitPrice,
    rawBalance, handleManualAction,
  } = props;

  const currentPrice = prices[selectedMarket] || prices[selectedMarket.split('-')[0]] || 0;
  const [marginMode, setMarginMode] = useState<"cross" | "isolated">("isolated");
  const [showTpSl, setShowTpSl] = useState(false);
  const [tpPrice, setTpPrice] = useState("");
  const [slPrice, setSlPrice] = useState("");

  return (
    <div className="bg-[#050505] flex flex-col h-[calc(100vh-48px)] border-l border-[#00f0ff]/30 overflow-y-auto custom-scrollbar">
      {/* Mode Toggle */}
      <div className="p-3 border-b border-[#00f0ff]/30 flex justify-between items-center">
        <h2 className="font-mono text-[10px] font-bold flex items-center gap-2 text-[#00f0ff] tracking-[0.15em] uppercase">
          <span className="w-1.5 h-1.5 bg-[#00f0ff] animate-pulse" />
          [ ターミナル ] AURA_AI
        </h2>
        <div className="flex border border-[#00f0ff]/30">
          <button onClick={() => setTradingMode("ai")} className={`px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${tradingMode === "ai" ? "bg-[#00f0ff]/15 text-[#00f0ff]" : "text-white/30 hover:text-white/60"}`}>AI</button>
          <button onClick={() => setTradingMode("manual")} className={`px-4 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-all ${tradingMode === "manual" ? "bg-[#00f0ff]/15 text-[#00f0ff]" : "text-white/30 hover:text-white/60"}`}>SYS</button>
        </div>
      </div>

      <div className="p-4 flex-1 flex flex-col gap-4">
        {/* Balance */}
        <div className="border border-[#00f0ff]/40 p-3 bg-[#0a0a0a] relative space-y-2">
          <div className="absolute top-0 right-0 w-3 h-3 border-b border-l border-[#00f0ff]/30" />
          <div className="absolute bottom-0 left-0 w-3 h-3 border-t border-r border-[#00f0ff]/30" />
          
          <div className="flex justify-between items-center">
            <span className="text-[9px] text-[#00f0ff]/50 font-mono uppercase tracking-widest">// SYS.BAL [ROBINHOOD]</span>
            <span className="font-mono font-bold text-[#00f0ff] text-lg">{balance} <span className="text-[9px] text-[#00f0ff]/40">aUSD</span></span>
          </div>
          
          <div className="flex justify-between items-center">
            <span className="text-[9px] text-[#00f0ff]/50 font-mono uppercase tracking-widest">// SYS.BAL [ARBITRUM]</span>
            <span className="font-mono font-bold text-[#00f0ff] text-lg">{arbBalance} <span className="text-[9px] text-[#00f0ff]/40">aUSD</span></span>
          </div>

          <div className="flex gap-2 mt-2">
            <button onClick={handleMintFaucet} disabled={isMinting || !account} className="flex-1 bg-transparent hover:bg-[#00f0ff]/10 text-[#00f0ff] text-[8px] py-2 border border-[#00f0ff]/40 flex items-center justify-center gap-1 disabled:opacity-30 transition-all font-mono uppercase tracking-widest">
              {isMinting ? <Activity className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              FAUCET (ROBINHOOD)
            </button>
            <button onClick={handleMintArbitrumFaucet} disabled={isMinting || !account} className="flex-1 bg-transparent hover:bg-[#00f0ff]/10 text-[#00f0ff] text-[8px] py-2 border border-[#00f0ff]/40 flex items-center justify-center gap-1 disabled:opacity-30 transition-all font-mono uppercase tracking-widest">
              {isMinting ? <Activity className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
              FAUCET (ARBITRUM)
            </button>
          </div>
        </div>

        {tradingMode === "ai" ? (
          <>
            {/* AI Prompt */}
            <div>
              <p className="text-[9px] text-[#00f0ff] uppercase tracking-widest font-mono font-bold mb-2">&gt;_ AI_PROMPT</p>
              <form onSubmit={handleAction} className="relative mb-3">
                <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="> ENTER INTENT █" className="w-full bg-[#050505] border border-[#00f0ff]/40 p-3 pr-10 text-xs font-mono text-[#00f0ff] placeholder:text-[#00f0ff]/25 focus:outline-none focus:border-[#00f0ff] resize-none min-h-[100px] transition-all" />
                <button type="submit" disabled={isProcessing || !prompt || !account} className="absolute bottom-3 right-3 bg-[#050505] text-[#00f0ff] border border-[#00f0ff]/50 p-1.5 hover:bg-[#00f0ff]/15 disabled:opacity-30 transition-all">
                  {isProcessing ? <Activity className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                </button>
              </form>
              {!account && <p className="text-[9px] text-[#FF2A6D] font-mono mb-2">&gt;_ ERR: WALLET_NOT_CONNECTED</p>}
              <div className="grid grid-cols-2 gap-2 mb-3">
                <button onClick={() => setPrompt("Long BTC 10x with 500 aUSD")} className="text-[9px] bg-transparent border border-[#00f0ff]/30 p-2.5 text-left hover:bg-[#00f0ff]/10 transition-all text-[#00f0ff] font-mono">
                  <TrendingUp className="w-3 h-3 mb-1 opacity-50" />&gt; QUICK_LONG
                </button>
                <button onClick={() => setPrompt("Short ETH 20x with 50 aUSD")} className="text-[9px] bg-transparent border border-[#FF2A6D]/30 p-2.5 text-left hover:bg-[#FF2A6D]/10 transition-all text-[#FF2A6D] font-mono">
                  <TrendingDown className="w-3 h-3 mb-1 opacity-50" />&gt; QUICK_SHORT
                </button>
              </div>
            </div>
            {/* Logs */}
            <div className="flex-1 min-h-0 flex flex-col border border-[#00f0ff]/30 bg-[#0a0a0a]">
              <div className="bg-[#00f0ff]/10 p-2 border-b border-[#00f0ff]/30">
                <h3 className="text-[9px] text-[#00f0ff] uppercase tracking-widest font-mono font-bold flex items-center gap-1.5">
                  <ShieldCheck className="w-3 h-3" /> GUARDRAIL_LOGS
                </h3>
              </div>
              <div className="flex-1 p-2 overflow-y-auto space-y-1.5 font-mono text-[9px] custom-scrollbar max-h-[250px]">
                {agentLogs.map((log) => (
                  <div key={log.id} className="flex gap-2">
                    <span className="text-[#00f0ff]/30 shrink-0">[{log.timestamp}]</span>
                    {log.type === "alert" ? (
                      <span className="text-[#FF2A6D] break-words flex-1">&lt;ERR&gt; {log.message}</span>
                    ) : log.type === "action" ? (
                      <span className="text-[#00f0ff] break-words flex-1 px-1 bg-[#00f0ff]/10 border border-[#00f0ff]/20">&gt;_ {log.message}</span>
                    ) : (
                      <span className="text-white/50 break-words flex-1"><span className="text-[#00f0ff] mr-1">OK</span>{log.message}</span>
                    )}
                  </div>
                ))}
                <div className="text-[#00f0ff]/40 animate-pulse">_</div>
              </div>
            </div>
          </>
        ) : (
          /* Manual Mode */
          <div className="space-y-3">
            {/* Cross / Isolated + Leverage */}
            <div className="flex gap-2">
              <div className="flex-1 bg-[#0a0a0a] border border-[#00f0ff]/20 p-2.5 cursor-pointer hover:bg-[#00f0ff]/5 transition-colors" onClick={() => setMarginMode(marginMode === "cross" ? "isolated" : "cross")}>
                <span className="text-[8px] text-white/30 font-mono uppercase tracking-widest block mb-0.5">Margin</span>
                <span className="text-[10px] font-bold text-[#00f0ff] font-mono flex items-center gap-1.5">
                  <span className={`w-2 h-2 border ${marginMode === "cross" ? "bg-[#00f0ff] border-[#00f0ff]" : "border-white/30"}`} />
                  {marginMode === "cross" ? "Cross" : "Isolated"}
                </span>
              </div>
              <div className="flex-1 bg-[#0a0a0a] border border-[#00f0ff]/20 p-2.5">
                <span className="text-[8px] text-white/30 font-mono uppercase tracking-widest block mb-0.5">Leverage</span>
                <span className="text-[10px] font-bold text-[#00f0ff] font-mono">{manualLeverage}x <ChevronDown className="w-2.5 h-2.5 inline opacity-40" /></span>
              </div>
            </div>

            {/* Long/Short */}
            <div className="flex border border-[#00f0ff]/20 overflow-hidden">
              <button onClick={() => setManualIsLong(true)} className={`flex-1 py-2.5 text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 ${manualIsLong ? "bg-[#00f0ff]/15 text-[#00f0ff] border-b-2 border-[#00f0ff]" : "bg-transparent text-white/30 hover:text-white/60"}`}>
                Long <TrendingUp className="w-3.5 h-3.5" />
              </button>
              <button onClick={() => setManualIsLong(false)} className={`flex-1 py-2.5 text-xs font-bold font-mono transition-all flex items-center justify-center gap-1.5 ${!manualIsLong ? "bg-[#FF2A6D]/15 text-[#FF2A6D] border-b-2 border-[#FF2A6D]" : "bg-transparent text-white/30 hover:text-white/60"}`}>
                Short <TrendingDown className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* Order Type Tabs */}
            <div className="flex border border-[#00f0ff]/20 overflow-hidden">
              <button onClick={() => setOrderType("market")} className={`flex-1 py-2 text-[10px] font-bold font-mono uppercase tracking-wider transition-all ${orderType === "market" ? "bg-[#00f0ff]/10 text-[#00f0ff] border-b-2 border-[#00f0ff]" : "bg-transparent text-white/30 hover:text-white/60"}`}>Market</button>
              <button onClick={() => setOrderType("limit")} className={`flex-1 py-2 text-[10px] font-bold font-mono uppercase tracking-wider transition-all ${orderType === "limit" ? "bg-[#00f0ff]/10 text-[#00f0ff] border-b-2 border-[#00f0ff]" : "bg-transparent text-white/30 hover:text-white/60"}`}>Limit</button>
            </div>

            {/* Price */}
            <div>
              <label className="text-[8px] text-white/30 font-mono uppercase tracking-widest block mb-1">{orderType === "market" ? "EST. EXECUTION PRICE" : "LIMIT PRICE"}</label>
              {orderType === "market" ? (
                <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 px-3 py-2.5 text-[10px] font-bold text-[#00f0ff] font-mono">
                  {currentPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} aUSD
                </div>
              ) : (
                <div className="relative">
                  <input type="number" value={limitPrice} onChange={(e) => setLimitPrice(e.target.value)} placeholder={currentPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} className="w-full bg-[#050505] border border-[#00f0ff]/30 pl-3 pr-14 py-2.5 text-xs font-mono text-[#00f0ff] placeholder:text-[#00f0ff]/20 focus:outline-none focus:border-[#00f0ff]/60 transition-all" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/20 font-mono">aUSD</span>
                </div>
              )}
            </div>

            {/* Size + Total */}
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="text-[8px] text-white/30 font-mono uppercase tracking-widest block mb-1">SIZE</label>
                <div className="relative">
                  <input type="number" value={manualCollateral} onChange={(e) => setManualCollateral(e.target.value)} className="w-full bg-[#050505] border border-[#00f0ff]/20 pl-3 pr-10 py-2.5 text-xs font-mono text-white/80 focus:outline-none focus:border-[#00f0ff]/60 transition-all" placeholder="0" />
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/20 font-mono">aUSD</span>
                </div>
              </div>
              <div className="flex-1">
                <label className="text-[8px] text-white/30 font-mono uppercase tracking-widest block mb-1">TOTAL</label>
                <div className="bg-[#050505] border border-white/10 pl-3 pr-10 py-2.5 text-xs font-mono text-white/40 relative">
                  ≈ {(Number(manualCollateral) * Number(manualLeverage)).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
                  <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-bold text-white/20 font-mono">aUSD</span>
                </div>
              </div>
            </div>

            {/* Size Slider */}
            <div className="px-1">
              <div className="relative flex items-center h-[2px] bg-white/10">
                <input type="range" min="0" max="100" value={rawBalance > 0 ? Math.min(100, Math.round((Number(manualCollateral) / rawBalance) * 100)) : 0} onChange={(e) => setManualCollateral((rawBalance * Number(e.target.value) / 100).toFixed(2))} className="absolute w-full h-[16px] opacity-0 cursor-pointer z-20 top-1/2 -translate-y-1/2" />
                <div className="absolute h-full bg-[#00f0ff]/60 z-0 transition-all" style={{ width: `${rawBalance > 0 ? Math.min(100, (Number(manualCollateral) / rawBalance) * 100) : 0}%` }} />
                <div className="absolute h-[10px] w-[10px] bg-white z-10 -ml-[5px] transition-all pointer-events-none" style={{ left: `${rawBalance > 0 ? Math.min(100, (Number(manualCollateral) / rawBalance) * 100) : 0}%` }} />
              </div>
              <div className="flex justify-between mt-1.5 text-[8px] text-white/30 font-mono">
                <span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>
              </div>
            </div>

            {/* Leverage Slider */}
            <div className="px-1 pt-2 pb-5 border-t border-white/5">
              <div className="relative flex items-center h-[2px] bg-white/10">
                <input type="range" min="1" max="50" value={manualLeverage} onChange={(e) => setManualLeverage(e.target.value)} className="absolute w-full h-[16px] opacity-0 cursor-pointer z-20 top-1/2 -translate-y-1/2" />
                <div className="absolute h-full bg-[#00f0ff]/50 z-0 transition-all" style={{ width: `${(Number(manualLeverage) / 50) * 100}%` }} />
                <div className="absolute h-[12px] w-[12px] bg-white z-10 -ml-[6px] transition-all pointer-events-none" style={{ left: `${(Number(manualLeverage) / 50) * 100}%` }} />
                <div className="absolute left-0 bottom-[-18px] text-[8px] text-white/30 font-mono">1x</div>
                <div className="absolute left-1/2 bottom-[-18px] text-[9px] font-bold text-white -translate-x-1/2 font-mono">{manualLeverage}x</div>
                <div className="absolute right-0 bottom-[-18px] text-[8px] text-white/30 font-mono">50x</div>
              </div>
            </div>

            {/* TP/SL Toggle */}
            <div className="border-t border-white/5 pt-3">
              <label className="flex items-center gap-2 cursor-pointer group" onClick={() => setShowTpSl(!showTpSl)}>
                <span className={`w-3.5 h-3.5 border flex items-center justify-center transition-all ${showTpSl ? "bg-[#00f0ff] border-[#00f0ff]" : "border-white/20 group-hover:border-white/40"}`}>
                  {showTpSl && <svg width="10" height="10" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="#050505" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/></svg>}
                </span>
                <span className="text-[9px] text-white/50 font-mono uppercase tracking-widest group-hover:text-white/70 transition-colors">Take Profit / Stop Loss</span>
              </label>
              {showTpSl && (
                <div className="mt-2 space-y-2">
                  {/* TP Row */}
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input type="number" value={tpPrice} onChange={(e) => setTpPrice(e.target.value)} placeholder="TP Price" className="w-full bg-[#050505] border border-[#00f0ff]/20 pl-3 pr-3 py-2 text-[10px] font-mono text-[#00f0ff] placeholder:text-white/20 focus:outline-none focus:border-[#00f0ff]/50 transition-all" />
                    </div>
                    <div className="w-[80px] bg-[#0a0a0a] border border-[#00f0ff]/15 flex items-center justify-between px-2.5 text-[10px] font-mono text-[#00f0ff]/60">
                      <span>Gain</span>
                      <span className="text-[8px] text-white/30">%&thinsp;⌄</span>
                    </div>
                  </div>
                  {/* SL Row */}
                  <div className="flex gap-2">
                    <div className="flex-1 relative">
                      <input type="number" value={slPrice} onChange={(e) => setSlPrice(e.target.value)} placeholder="SL Price" className="w-full bg-[#050505] border border-[#FF2A6D]/20 pl-3 pr-3 py-2 text-[10px] font-mono text-[#FF2A6D] placeholder:text-white/20 focus:outline-none focus:border-[#FF2A6D]/50 transition-all" />
                    </div>
                    <div className="w-[80px] bg-[#0a0a0a] border border-[#FF2A6D]/15 flex items-center justify-between px-2.5 text-[10px] font-mono text-[#FF2A6D]/60">
                      <span>Loss</span>
                      <span className="text-[8px] text-white/30">%&thinsp;⌄</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Account Info */}
            <div className="border-t border-white/5 pt-3 space-y-1.5">
              {[
                { label: "Liquidation Price", value: currentPrice > 0 && Number(manualCollateral) > 0 ? `${(manualIsLong ? currentPrice * (1 - 1/Number(manualLeverage)) : currentPrice * (1 + 1/Number(manualLeverage))).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}` : "N/A" },
                { label: "Order Value", value: Number(manualCollateral) > 0 ? `${(Number(manualCollateral) * Number(manualLeverage)).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} aUSD` : "N/A" },
                { label: "Margin Required", value: Number(manualCollateral) > 0 ? `${Number(manualCollateral).toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})} aUSD` : "N/A" },
                { label: "Fees", value: "0.0400% / 0.0120%" },
              ].map(row => (
                <div key={row.label} className="flex justify-between items-center">
                  <span className="text-[8px] text-white/25 font-mono uppercase tracking-widest">{row.label}</span>
                  <span className="text-[9px] text-white/50 font-mono">{row.value}</span>
                </div>
              ))}
            </div>

            {/* Execute */}
            <CubeButton
              onClick={() => handleManualAction(manualIsLong, tpPrice, slPrice)}
              disabled={isProcessing || !account || !manualCollateral || (orderType === "limit" && !limitPrice)}
              color={manualIsLong ? "#00f0ff" : "#FF2A6D"}
              className="w-full py-3 text-center"
            >
              <span className="block text-xs">{manualIsLong ? "Long" : "Short"} {selectedMarket}</span>
              <span className="block text-[9px] opacity-60 mt-0.5 normal-case">{Number(manualCollateral).toFixed(2)} aUSD {orderType === "limit" ? `@ ${limitPrice || "—"}` : `@ ${currentPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}`}</span>
            </CubeButton>

            {!account && <p className="text-[9px] text-[#FF2A6D] font-mono text-center border border-[#FF2A6D]/20 py-1.5 bg-[#FF2A6D]/5">Connect wallet to trade</p>}
          </div>
        )}
      </div>
    </div>
  );
}
