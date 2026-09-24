"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, TrendingUp, TrendingDown, X as XIcon } from "lucide-react";
import { useActiveAccount } from "thirdweb/react";
import { ConnectButton } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain } from "thirdweb";
import { client } from "../client";
import { createPublicClient, http, formatUnits, createWalletClient, custom } from "viem";
import { CONTRACT_ADDRESSES, AURA_PERPS_ABI } from "../../lib/contracts";

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com") });

const robinhoodChain = defineChain({
  id: 46630, name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" }],
});

const wallets = [createWallet("io.metamask"), createWallet("com.coinbase.wallet"), createWallet("me.rainbow")];

type Position = {
  id: number;
  asset: string;
  isLong: boolean;
  collateral: number;
  leverage: number;
  size: number;
  entryPrice: number;
  isOpen: boolean;
  openedAt: string;
};

type PriceMap = Record<string, number>;

export default function PortfolioPage() {
  const account = useActiveAccount();
  const [positions, setPositions] = useState<Position[]>([]);
  const [prices, setPrices] = useState<PriceMap>({});
  const [closing, setClosing] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pnlStats, setPnlStats] = useState<{ wins: number; losses: number; bestTrade: number; worstTrade: number; totalVolume: number } | null>(null);

  // Fetch positions
  const fetchPositions = useCallback(async () => {
    if (!account?.address) { setPositions([]); setLoading(false); return; }
    try {
      // Also get AuraAccount address
      let auraAccount = "";
      try {
        const acct = await publicClient.readContract({
          address: "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550" as `0x${string}`,
          abi: [{ inputs: [{ type: "address" }], name: "getAccount", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }] as const,
          functionName: "getAccount", args: [account.address as `0x${string}`],
        });
        if (acct && acct !== "0x0000000000000000000000000000000000000000") auraAccount = acct.toLowerCase();
      } catch {}

      const nextId = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`,
        abi: AURA_PERPS_ABI as any, functionName: "nextPositionId",
      }) as bigint;
      const count = Number(nextId);
      const calls = Array.from({ length: count }, (_, i) => ({
        address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`,
        abi: AURA_PERPS_ABI as any, functionName: "positions", args: [BigInt(i)],
      }));
      const results = [];
      const chunkSize = 500;
      for (let i = 0; i < count; i += chunkSize) {
        const chunk = calls.slice(i, i + chunkSize);
        const chunkResults = await publicClient.multicall({ 
          contracts: chunk,
          multicallAddress: "0xca11bde05977b3631167028862be2a173976ca11" as `0x${string}`
        });
        results.push(...chunkResults.map(r => r.status === 'success' ? r.result : null));
      }
      const open: Position[] = [];
      const ownerLower = account.address.toLowerCase();
      for (let i = 0; i < count; i++) {
        const pos = results[i] as any;
        const posOwner = pos[0].toLowerCase();
        if ((posOwner === ownerLower || posOwner === auraAccount) && pos[7]) {
          open.push({
            id: i, asset: pos[1], isLong: pos[2],
            collateral: Number(formatUnits(pos[3], 18)),
            leverage: Number(pos[4]),
            entryPrice: Number(formatUnits(pos[5], 18)),
            size: Number(formatUnits(pos[6], 18)),
            isOpen: true,
            openedAt: Number(pos[8]) > 0 ? new Date(Number(pos[8]) * 1000).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "Recently",
          });
        }
      }
      setPositions(open.reverse());
    } catch (e) { console.error("Position fetch error:", e); }
    setLoading(false);
  }, [account?.address]);

  // Fetch prices from Pyth Hermes (real-time)
  const fetchPrices = useCallback(async () => {
    try {
      const PYTH_IDS: Record<string, string> = {
        BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
        ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
        TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
        AMZN: "62731dfcc8b8542e52753f208248c3e73fab2ec15422d6f65c2decda71ccea0d",
        NFLX: "8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
        AMD: "6969003ef4c5fbb3b57a6be3883102362d05572c2dc7f72b767ad48f4206204b",
        PLTR: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0",
      };
      const ids = Object.values(PYTH_IDS).map(id => `ids[]=${id}`).join("&");
      const res = await fetch(`https://hermes.pyth.network/v2/updates/price/latest?${ids}`);
      const data = await res.json();
      const results: PriceMap = {};
      const symbols = Object.keys(PYTH_IDS);
      if (data.parsed) {
        data.parsed.forEach((item: any, idx: number) => {
          const p = item.price;
          results[symbols[idx]] = parseFloat(p.price) * Math.pow(10, p.expo);
        });
      }
      setPrices(results);
    } catch (e) { console.error("Price fetch error:", e); }
  }, []);

  useEffect(() => { fetchPositions(); fetchPrices(); }, [fetchPositions, fetchPrices]);
  useEffect(() => { const iv = setInterval(fetchPrices, 5000); return () => clearInterval(iv); }, [fetchPrices]);

  // Close position
  const handleClose = async (positionId: number) => {
    if (!account?.address || !window.ethereum) return;
    setClosing(positionId);
    try {
      const wc = createWalletClient({
        chain: { id: 46630, name: "Robinhood", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any,
        account: account.address as `0x${string}`, transport: custom(window.ethereum as any),
      });
      const tx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`,
        abi: AURA_PERPS_ABI as any,
        functionName: "closePosition",
        args: [BigInt(positionId)],
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setPositions(prev => prev.filter(p => p.id !== positionId));
    } catch (e: any) { console.error("Close failed:", e.message); }
    setClosing(null);
  };

  // PnL calculation
  const calcPnl = (pos: Position) => {
    const assetKey = pos.asset.replace("-PERP", "");
    const currentPrice = prices[assetKey];
    if (!currentPrice || !pos.entryPrice) return { pnl: 0, pnlPct: 0 };
    const priceDelta = pos.isLong ? currentPrice - pos.entryPrice : pos.entryPrice - currentPrice;
    const pnl = (priceDelta / pos.entryPrice) * pos.size;
    const pnlPct = (pnl / pos.collateral) * 100;
    return { pnl, pnlPct };
  };

  // Total PnL
  const totalPnl = positions.reduce((sum, p) => sum + calcPnl(p).pnl, 0);
  const totalCollateral = positions.reduce((sum, p) => sum + p.collateral, 0);
  const winRate = positions.length > 0 ? positions.filter(p => calcPnl(p).pnl > 0).length / positions.length * 100 : 0;
  const bestTrade = positions.length > 0 ? Math.max(...positions.map(p => calcPnl(p).pnl)) : 0;
  const worstTrade = positions.length > 0 ? Math.min(...positions.map(p => calcPnl(p).pnl)) : 0;

  return (
    <div className="min-h-screen bg-[#020204] text-white font-mono relative overflow-hidden">
      <img src="/assets/fond_chat.png" className="fixed inset-0 w-full h-full object-cover opacity-40 pointer-events-none z-0" alt="" />
      <div className="cyber-grid-bg fixed inset-0 z-0" />
      <div className="scanlines fixed inset-0 z-[1]" />

      {/* Header */}
      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] relative z-50">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-[#00f0ff] transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">AURA</span>
          </Link>
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <Link href="/trade" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Trade</Link>
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5">Portfolio</span>
            <Link href="/perp-vault" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Earn Yield</Link>
            <Link href="/social" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Copy Trade</Link>
            <Link href="/social/dashboard" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Dashboard</Link>
            <Link href="/trade/account" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Account</Link>
          </div>
        </div>
        <ConnectButton client={client} wallets={wallets} chain={robinhoodChain} connectButton={{ label: "Connect", style: { fontSize: "10px", padding: "6px 12px", height: "28px" } }} />
      </header>

      {/* Content */}
      <main className="relative z-10 max-w-5xl mx-auto px-4 py-8">
        {/* Summary */}
        <div className="grid grid-cols-3 gap-4 mb-8">
          <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-4">
            <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Open Positions</p>
            <p className="text-2xl font-bold text-[#00f0ff]">{positions.length}</p>
          </div>
          <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-4">
            <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Total Collateral</p>
            <p className="text-2xl font-bold text-white">${totalCollateral.toFixed(2)}</p>
          </div>
          <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-4">
            <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Unrealized PnL</p>
            <p className={`text-2xl font-bold ${totalPnl >= 0 ? "text-[#00ff88]" : "text-[#ff2a6d]"}`}>
              {totalPnl >= 0 ? "+" : ""}{totalPnl.toFixed(2)} aUSD
            </p>
          </div>
        </div>

        {/* PnL Summary */}
        {positions.length > 0 && (
          <div className="grid grid-cols-3 gap-4 mb-8">
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-4">
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Win Rate</p>
              <p className="text-2xl font-bold text-[#00f0ff]">{winRate.toFixed(0)}%</p>
              <p className="text-[9px] text-white/20 mt-1">{positions.filter(p => calcPnl(p).pnl > 0).length}W / {positions.filter(p => calcPnl(p).pnl <= 0).length}L</p>
            </div>
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-4">
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Best Trade</p>
              <p className="text-2xl font-bold text-[#00ff88]">+{bestTrade.toFixed(2)}</p>
            </div>
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-4">
              <p className="text-[9px] text-white/30 uppercase tracking-widest mb-1">Worst Trade</p>
              <p className="text-2xl font-bold text-[#ff2a6d]">{worstTrade.toFixed(2)}</p>
            </div>
          </div>
        )}

        {/* Positions */}
        {!account?.address ? (
          <div className="text-center py-20 text-white/30 text-sm">Connect wallet to view positions</div>
        ) : loading ? (
          <div className="text-center py-20 text-[#00f0ff]/50 text-sm animate-pulse">Loading positions...</div>
        ) : positions.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-white/30 text-sm mb-4">No open positions</p>
            <Link href="/trade" className="text-[#00f0ff] text-xs border border-[#00f0ff]/40 px-4 py-2 hover:bg-[#00f0ff]/10 transition">Open a Trade</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {positions.map(pos => {
              const { pnl, pnlPct } = calcPnl(pos);
              const assetKey = pos.asset.replace("-PERP", "");
              const currentPrice = prices[assetKey] || 0;
              const isProfit = pnl >= 0;
              return (
                <div key={pos.id} className="bg-[#0a0a0a] border border-[#00f0ff]/15 p-4 flex items-center gap-4 hover:border-[#00f0ff]/40 transition">
                  {/* Direction */}
                  <div className={`w-10 h-10 flex items-center justify-center border ${pos.isLong ? "border-[#00ff88]/40 text-[#00ff88]" : "border-[#ff2a6d]/40 text-[#ff2a6d]"}`}>
                    {pos.isLong ? <TrendingUp className="w-5 h-5" /> : <TrendingDown className="w-5 h-5" />}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-sm">{pos.asset}</span>
                      <span className={`text-[9px] px-1.5 py-0.5 uppercase font-bold ${pos.isLong ? "bg-[#00ff88]/10 text-[#00ff88]" : "bg-[#ff2a6d]/10 text-[#ff2a6d]"}`}>
                        {pos.isLong ? "Long" : "Short"} {pos.leverage}x
                      </span>
                    </div>
                    <div className="flex gap-4 mt-1 text-[10px] text-white/40">
                      <span>Entry: ${pos.entryPrice.toFixed(2)}</span>
                      <span>Mark: ${currentPrice.toFixed(2)}</span>
                      <span className="text-[#FF2A6D]/60">Liq: ${(pos.isLong ? pos.entryPrice * (1 - pos.collateral / pos.size) : pos.entryPrice * (1 + pos.collateral / pos.size)).toFixed(2)}</span>
                      <span>Size: ${pos.size.toFixed(2)}</span>
                      <span>Opened: {pos.openedAt}</span>
                    </div>
                  </div>

                  {/* PnL */}
                  <div className="text-right min-w-[100px]">
                    <p className={`font-bold text-sm ${isProfit ? "text-[#00ff88]" : "text-[#ff2a6d]"}`}>
                      {isProfit ? "+" : ""}{pnl.toFixed(2)}
                    </p>
                    <p className={`text-[10px] ${isProfit ? "text-[#00ff88]/60" : "text-[#ff2a6d]/60"}`}>
                      {isProfit ? "+" : ""}{pnlPct.toFixed(2)}%
                    </p>
                  </div>

                  {/* Close button */}
                  <button
                    onClick={() => handleClose(pos.id)}
                    disabled={closing === pos.id}
                    className="px-3 py-2 border border-[#ff2a6d]/40 text-[#ff2a6d] text-[10px] font-bold uppercase tracking-widest hover:bg-[#ff2a6d]/10 transition disabled:opacity-30 flex items-center gap-1"
                  >
                    {closing === pos.id ? <span className="animate-spin w-3 h-3 border border-[#ff2a6d] border-t-transparent rounded-full" /> : <XIcon className="w-3 h-3" />}
                    Close
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
