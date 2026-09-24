"use client";

declare global {
  interface Window {
    ethereum?: any;
  }
}

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, Zap } from "lucide-react";
import { ConnectButton } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain, readContract, getContract } from "thirdweb";
import { client } from "../client";
import { useTradeState } from "./useTradeState";
import OrderPanel from "./OrderPanel";
import PositionsPanel from "./PositionsPanel";
import OrderBook from "./OrderBook";
import SettlementToasts from "./SettlementToasts";
import LiquidationAlerts from "./LiquidationAlerts";
import McpKeyPanel from "./McpKeyPanel";
import AuditTrailWidget from "./AuditTrailWidget";
import { API_URL } from "@/lib/config";

const robinhoodChain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" }],
});

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
];

const MARKETS_CRYPTO = [
  { m: "BTC-PERP", img: "https://cryptologos.cc/logos/bitcoin-btc-logo.svg?v=029" },
  { m: "ETH-PERP", img: "https://cryptologos.cc/logos/ethereum-eth-logo.svg?v=029" },
];
const MARKETS_RWA = [
  { m: "AMZN-PERP", img: "https://upload.wikimedia.org/wikipedia/commons/a/a9/Amazon_logo.svg" },
  { m: "TSLA-PERP", img: "https://upload.wikimedia.org/wikipedia/commons/e/e8/Tesla_logo.png" },
  { m: "AMD-PERP", img: "https://upload.wikimedia.org/wikipedia/commons/7/7c/AMD_Logo.svg" },
  { m: "NFLX-PERP", img: "https://upload.wikimedia.org/wikipedia/commons/0/08/Netflix_2015_logo.svg" },
  { m: "PLTR-PERP", img: "https://upload.wikimedia.org/wikipedia/commons/3/36/Palantir_logo.svg" },
];

function getMarketIcon(market: string) {
  const all = [...MARKETS_CRYPTO, ...MARKETS_RWA];
  return all.find(x => x.m === market)?.img || MARKETS_CRYPTO[0].img;
}

export default function TradeDashboard() {
  const state = useTradeState();
  const {
    selectedMarket, setSelectedMarket, isDropdownOpen, setIsDropdownOpen,
    prices, account,
  } = state;

  // MCP delegation: fetch AuraAccount + agent address
  const [auraAccountAddress, setAuraAccountAddress] = useState("");
  const [agentOperatorAddress, setAgentOperatorAddress] = useState("");

  useEffect(() => {
    if (!account?.address) { setAuraAccountAddress(""); return; }
    const FACTORY = "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550";
    const chain = defineChain({ id: 46630, rpc: "https://rpc.testnet.chain.robinhood.com" });
    const contract = getContract({ client, chain, address: FACTORY, abi: [{ inputs: [{ internalType: "address", name: "owner", type: "address" }], name: "getAccount", outputs: [{ internalType: "address", name: "", type: "address" }], stateMutability: "view", type: "function" }] as const });
    readContract({ contract, method: "getAccount", params: [account.address] }).then((addr) => {
      if (addr && addr !== "0x0000000000000000000000000000000000000000") setAuraAccountAddress(addr);
    }).catch(() => {});
  }, [account?.address]);

  useEffect(() => {
    fetch(`${API_URL}/agent-address`).then(r => r.json()).then(d => setAgentOperatorAddress(d.address)).catch(() => {});
  }, []);

  const currentPrice = prices[selectedMarket] || prices[selectedMarket.split('-')[0]] || 0;

  return (
    <div className="min-h-screen bg-[#020204] text-white font-mono selection:bg-[#00f0ff] selection:text-black flex flex-col relative overflow-hidden">
      <SettlementToasts />
      <LiquidationAlerts
        ownerAddress={account?.address}
        onQuickAddMargin={(positionId, recommendedAmount) => state.handleAddMargin(positionId, recommendedAmount)}
      />
      <video autoPlay muted loop playsInline className="fixed inset-0 z-0 h-full w-full object-cover opacity-10 pointer-events-none"><source src="/assets/cyber_wallpaper.mp4" type="video/mp4" /></video>
      <div className="cyber-grid-bg fixed inset-0 z-0" /><div className="scanlines fixed inset-0 z-[1]" /><div className="noise-overlay fixed inset-0 z-[1]" />

      {/* ═══ HEADER ═══ */}
      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] flex-shrink-0 relative z-50">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-[#00f0ff] transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest">AURA</span>
          </Link>

          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5">Trade</span>
            <Link href="/portfolio" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Portfolio</Link>
            <Link href="/perp-vault" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Earn Yield</Link>
            <Link href="/social" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Copy Trade</Link>
            <Link href="/social/dashboard" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Dashboard</Link>
            <Link href="/trade/account" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Account</Link>
          </div>

          {/* Market Selector */}
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 hidden lg:flex items-center gap-4">
            <div className="relative">
              <div className="flex items-center gap-2 cursor-pointer hover:bg-white/5 px-2 py-1 transition-colors" onClick={() => setIsDropdownOpen(!isDropdownOpen)}>
                <img src={getMarketIcon(selectedMarket)} className="w-4 h-4 object-contain" alt={selectedMarket} />
                <span className="font-mono font-bold text-sm text-white">{selectedMarket}</span>
                <ChevronDown className={`w-3 h-3 text-white/30 transition-transform ${isDropdownOpen ? "rotate-180" : ""}`} />
              </div>
              {isDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-52 bg-[#050505] border border-[#00f0ff]/30 shadow-[0_8px_32px_rgba(0,0,0,0.8)] overflow-hidden z-50">
                  <div className="px-3 py-1 text-[8px] uppercase text-[#00f0ff]/50 font-bold tracking-widest bg-[#00f0ff]/5">Crypto</div>
                  {MARKETS_CRYPTO.map(({m,img}) => (
                    <div key={m} className="flex items-center gap-3 px-3 py-2 hover:bg-[#00f0ff]/5 cursor-pointer transition-colors" onClick={() => {setSelectedMarket(m);setIsDropdownOpen(false);}}>
                      <img src={img} className="w-4 h-4" alt={m} /><span className="font-bold text-[11px]">{m}</span>
                    </div>
                  ))}
                  <div className="px-3 py-1 text-[8px] uppercase text-[#00f0ff] font-bold tracking-widest bg-[#00f0ff]/5 flex items-center gap-1"><Zap className="w-2.5 h-2.5" />RWA Stocks</div>
                  {MARKETS_RWA.map(({m,img}) => (
                    <div key={m} className="flex items-center gap-3 px-3 py-2 hover:bg-[#00f0ff]/5 cursor-pointer transition-colors" onClick={() => {setSelectedMarket(m);setIsDropdownOpen(false);}}>
                      <div className="w-4 h-4 rounded-full bg-white flex items-center justify-center p-0.5"><img src={img} className="w-full h-full object-contain" /></div>
                      <span className="font-bold text-[11px]">{m}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="text-[#00f0ff] font-mono font-bold text-base" style={{textShadow: '0 0 10px rgba(0,240,255,0.3)'}}>
              {currentPrice.toLocaleString(undefined, {minimumFractionDigits:2, maximumFractionDigits:2})}
            </div>

            {(() => {
              const baseAsset = selectedMarket.split('-')[0];
              const change24h = prices[`${baseAsset}_24h_change`] || 0;
              const vol24h = prices[`${baseAsset}_24h_vol`] || 0;
              const isPositive = change24h >= 0;
              const formatVol = (v: number) => {
                if (v >= 1e9) return (v / 1e9).toFixed(2) + " B";
                if (v >= 1e6) return (v / 1e6).toFixed(2) + " M";
                if (v >= 1e3) return (v / 1e3).toFixed(2) + " K";
                return v.toFixed(2);
              };

              return (
                <>
                  <div>
                    <p className="text-[8px] text-white/30 uppercase tracking-widest">24h Change</p>
                    <p className={`text-[10px] font-bold ${isPositive ? 'text-[#00f0ff]' : 'text-[#ff0055]'}`}>
                      {isPositive ? '+' : ''}{change24h.toFixed(2)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[8px] text-white/30 uppercase tracking-widest">24h Volume</p>
                    <p className="text-[10px] text-white/60">
                      {formatVol(vol24h)} USDC
                    </p>
                  </div>
                </>
              );
            })()}
            <div><p className="text-[8px] text-white/30 uppercase tracking-widest">Funding Rate</p><p className="text-[10px] text-[#00f0ff]/70 font-bold">{state.fundingRate}</p></div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden sm:flex items-center gap-1.5 text-[9px] bg-[#00f0ff]/5 border border-[#00f0ff]/20 px-2.5 py-1 font-mono uppercase tracking-widest text-[#00f0ff]">
            <span className="w-1.5 h-1.5 bg-[#00f0ff] shadow-[0_0_6px_rgba(0,240,255,0.6)] animate-pulse" />Pyth Oracle Live
          </div>
          <div className="scale-90 origin-right"><ConnectButton client={client} theme="dark" wallets={wallets} chain={robinhoodChain} /></div>
        </div>
      </header>

      {/* ═══ MAIN CONTENT ═══ */}
      <main className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_220px_320px] gap-px bg-[#00f0ff]/5 overflow-hidden relative z-10">
        {/* LEFT — Chart + Positions */}
        <div className="bg-[#050505] flex flex-col relative h-[calc(100vh-48px)]">
          {/* TradingView Chart */}
          <div className="flex-1 min-h-[55vh] border-b border-[#00f0ff]/20">
            <iframe
              key={selectedMarket}
              src={`https://s.tradingview.com/widgetembed/?frameElementId=tradingview_123&symbol=${["BTC-PERP", "ETH-PERP"].includes(selectedMarket) ? "BINANCE%3A" + selectedMarket.split('-')[0] + "USD" : "PYTH%3A" + selectedMarket.split('-')[0]}&interval=1&hidesidetoolbar=1&symboledit=1&saveimage=1&toolbarbg=050505&studies=%5B%5D&theme=dark&style=1&timezone=Etc%2FUTC&studies_overrides=%7B%7D&overrides=%7B%22paneProperties.background%22%3A%22%23050505%22%2C%22paneProperties.backgroundType%22%3A%22solid%22%2C%22paneProperties.vertGridProperties.color%22%3A%22%2300f0ff15%22%2C%22paneProperties.horzGridProperties.color%22%3A%22%2300f0ff15%22%2C%22mainSeriesProperties.candleStyle.upColor%22%3A%22%2300f0ff%22%2C%22mainSeriesProperties.candleStyle.downColor%22%3A%22%23FF2A6D%22%2C%22mainSeriesProperties.candleStyle.borderUpColor%22%3A%22%2300f0ff%22%2C%22mainSeriesProperties.candleStyle.borderDownColor%22%3A%22%23FF2A6D%22%2C%22mainSeriesProperties.candleStyle.wickUpColor%22%3A%22%2300f0ff%22%2C%22mainSeriesProperties.candleStyle.wickDownColor%22%3A%22%23FF2A6D%22%7D&enabled_features=%5B%5D&disabled_features=%5B%22header_symbol_search%22%2C%22header_compare%22%5D&locale=en`}
              className="w-full h-full"
              frameBorder="0"
              allowFullScreen
            />
          </div>

          {/* Positions Table */}
          <PositionsPanel
            activeTab={state.activeTab}
            setActiveTab={state.setActiveTab}
            activePositions={state.activePositions}
            historyPositions={state.historyPositions}
            openOrders={state.openOrders}
            prices={state.prices}
            tpSlConfig={state.tpSlConfig}
            setTpSlConfig={state.setTpSlConfig}
            handleClosePosition={state.handleClosePosition}
            handlePartialClose={state.handlePartialClose}
            handleAddMargin={state.handleAddMargin}
            handleSetTriggers={state.handleSetTriggers}
            handleCancelLimitOrder={state.handleCancelLimitOrder}
            handleArmShield={state.handleArmShield}
            handleDisarmShield={state.handleDisarmShield}
          />
        </div>

        {/* MIDDLE — Order Book */}
        <OrderBook currentPrice={currentPrice} selectedMarket={state.selectedMarket} />

        {/* RIGHT — Order Panel + MCP Key */}
        <div className="bg-[#050505] flex flex-col h-[calc(100vh-48px)] overflow-y-auto">
        <OrderPanel
          tradingMode={state.tradingMode}
          setTradingMode={state.setTradingMode}
          balance={state.balance}
          arbBalance={state.arbBalance}
          isMinting={state.isMinting}
          account={state.account}
          handleMintFaucet={state.handleMintFaucet}
          handleMintArbitrumFaucet={state.handleMintArbitrumFaucet}
          prompt={state.prompt}
          setPrompt={state.setPrompt}
          isProcessing={state.isProcessing}
          handleAction={state.handleAction}
          agentLogs={state.agentLogs}
          selectedMarket={state.selectedMarket}
          prices={state.prices}
          manualIsLong={state.manualIsLong}
          setManualIsLong={state.setManualIsLong}
          manualCollateral={state.manualCollateral}
          setManualCollateral={state.setManualCollateral}
          manualLeverage={state.manualLeverage}
          setManualLeverage={state.setManualLeverage}
          orderType={state.orderType}
          setOrderType={state.setOrderType}
          limitPrice={state.limitPrice}
          setLimitPrice={state.setLimitPrice}
          rawBalance={state.rawBalance}
          handleManualAction={state.handleManualAction}
        />
        <McpKeyPanel walletAddress={account?.address} auraAccountAddress={auraAccountAddress} agentOperatorAddress={agentOperatorAddress} />
        <AuditTrailWidget />
        </div>
      </main>
    </div>
  );
}
