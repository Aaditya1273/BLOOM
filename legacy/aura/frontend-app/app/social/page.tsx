"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Users,
  TrendingUp,
  TrendingDown,
  Copy,
  Star,
  RefreshCw,
  Search,
  ChevronDown,
  Trophy,
  DollarSign,
  BarChart3,
  Activity,
  ExternalLink,
  X,
  Shield,
  Zap,
  Target,
  Flame,
  Crown,
  Medal,
  Award,
} from "lucide-react";
import { ConnectButton, useActiveAccount, useSendTransaction } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain, readContract, getContract, prepareContractCall, waitForReceipt } from "thirdweb";
import { client } from "../client";
import { API_URL } from "../../lib/config";
import { createWalletClient, custom, parseEther, formatEther } from "viem";
import { CONTRACT_ADDRESSES, AURA_COPY_TRADING_V2_ABI, AUSD_ABI } from "../../lib/contracts";
import CubeButton from "../trade/CubeButton";

/*  Chain & Wallet Config  */

const robinhoodChain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
});

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
];

/*  Types  */

type Trader = {
  rank: number;
  address: string;
  totalPnl: number;
  totalCopiedCapital: number;
  totalFollowers: number;
  tradesExecuted: number;
  roi: number;
  winRate: number;
  maxDrawdown: number;
  ageDays: number;
};

type SocialStats = {
  totalAum: number;
  activeTraders: number;
  totalFollowers: number;
  totalPnl: number;
};

/*  Helpers  */

function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}${addr.slice(-4)}` : "";
}

function formatUSD(v: number) {
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}K`;
  return `$${v.toFixed(2)}`;
}

function formatCompact(v: number) {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return v.toString();
}

/** Deterministic avatar color from address */
function addrToHue(addr: string): number {
  let hash = 0;
  for (let i = 0; i < addr.length; i++) {
    hash = addr.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash) % 360;
}

function addrToGradient(addr: string): string {
  const h1 = addrToHue(addr);
  const h2 = (h1 + 40) % 360;
  return `linear-gradient(135deg, hsl(${h1}, 80%, 55%), hsl(${h2}, 90%, 45%))`;
}

/*  Animated Counter  */

function AnimatedCounter({
  value,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.5,
}: {
  value: number;
  prefix?: string;
  suffix?: string;
  decimals?: number;
  duration?: number;
}) {
  const [display, setDisplay] = useState(0);
  const ref = useRef<number>(0);
  const frameRef = useRef<number>(0);

  useEffect(() => {
    const start = ref.current;
    const diff = value - start;
    const startTime = performance.now();

    function tick(now: number) {
      const elapsed = (now - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      // Ease out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = start + diff * eased;
      setDisplay(current);
      ref.current = current;
      if (progress < 1) {
        frameRef.current = requestAnimationFrame(tick);
      }
    }

    frameRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameRef.current);
  }, [value, duration]);

  const formatted =
    Math.abs(display) >= 1_000_000
      ? `${(display / 1_000_000).toFixed(decimals > 0 ? Math.min(decimals, 2) : 1)}M`
      : Math.abs(display) >= 1_000
        ? `${(display / 1_000).toFixed(decimals > 0 ? Math.min(decimals, 1) : 0)}K`
        : display.toFixed(decimals);

  return (
    <span className="font-mono tabular-nums">
      {prefix}
      {formatted}
      {suffix}
    </span>
  );
}

/*  Rank Badge  */

function RankBadge({ rank }: { rank: number }) {
  if (rank === 1) {
    return (
      <div className="relative w-10 h-10 rounded-none bg-gradient-to-br from-yellow-400/20 to-yellow-600/10 flex items-center justify-center border border-yellow-400/40 shadow-[0_0_15px_rgba(250,204,21,0.3)]">
        <Crown size={18} className="text-white" />
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-none bg-yellow-400 text-black text-[9px] font-black flex items-center justify-center">
          1
        </div>
      </div>
    );
  }
  if (rank === 2) {
    return (
      <div className="relative w-10 h-10 rounded-none bg-gradient-to-br from-gray-300/20 to-gray-500/10 flex items-center justify-center border border-gray-300/40 shadow-[0_0_10px_rgba(200,200,200,0.2)]">
        <Medal size={18} className="text-white" />
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-none bg-gray-300 text-black text-[9px] font-black flex items-center justify-center">
          2
        </div>
      </div>
    );
  }
  if (rank === 3) {
    return (
      <div className="relative w-10 h-10 rounded-none bg-gradient-to-br from-amber-600/20 to-amber-800/10 flex items-center justify-center border border-amber-600/40 shadow-[0_0_10px_rgba(217,119,6,0.2)]">
        <Award size={18} className="text-white" />
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-none bg-amber-500 text-black text-[9px] font-black flex items-center justify-center">
          3
        </div>
      </div>
    );
  }
  return (
    <div className="w-10 h-10 rounded-none bg-white/5 flex items-center justify-center border border-white/10 text-white font-bold text-sm font-mono">
      {rank}
    </div>
  );
}

/*  Win Rate Circle  */

function WinRateCircle({ rate }: { rate: number }) {
  const r = 16;
  const circumference = 2 * Math.PI * r;
  const progress = (rate / 100) * circumference;
  const color = rate >= 50 ? "#00f0ff" : "#FF2A6D";

  return (
    <div className="relative w-10 h-10 flex items-center justify-center">
      <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke="rgba(255,255,255,0.07)"
          strokeWidth="3"
        />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={circumference}
          strokeDashoffset={circumference - progress}
          strokeLinecap="round"
          style={{
            filter: `drop-shadow(0 0 4px ${color})`,
            transition: "stroke-dashoffset 1s ease-out",
          }}
        />
      </svg>
      <span
        className="absolute text-[10px] font-bold font-mono"
        style={{ color }}
      >
        {rate.toFixed(0)}
      </span>
    </div>
  );
}

/*  ROI Bar  */

function RoiBar({ roi }: { roi: number }) {
  const isPositive = roi >= 0;
  const barWidth = Math.min(Math.abs(roi), 200);
  const color = isPositive ? "#00f0ff" : "#FF2A6D";

  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <span
        className="text-sm font-mono font-bold w-16 text-right"
        style={{ color }}
      >
        {isPositive ? "+" : ""}
        {roi.toFixed(1)}%
      </span>
      <div className="flex-1 h-2 bg-white/5 rounded-none overflow-hidden max-w-[60px]">
        <motion.div
          className="h-full rounded-none"
          style={{
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 8px ${color}66`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${Math.min((barWidth / 200) * 100, 100)}%` }}
          transition={{ duration: 1, ease: "easeOut" }}
        />
      </div>
    </div>
  );
}

/*  Skeleton Row  */

function SkeletonRow({ index }: { index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: index * 0.05 }}
      className="flex items-center gap-4 px-5 py-4 border-b border-white/5"
    >
      <div className="w-10 h-10 rounded-none bg-white/5 animate-pulse" />
      <div className="flex-1 flex items-center gap-3">
        <div className="w-9 h-9 rounded-none bg-white/5 animate-pulse" />
        <div className="space-y-2">
          <div className="w-24 h-3 rounded bg-white/5 animate-pulse" />
          <div className="w-16 h-2 rounded bg-white/5 animate-pulse" />
        </div>
      </div>
      <div className="w-20 h-3 rounded bg-white/5 animate-pulse" />
      <div className="w-24 h-3 rounded bg-white/5 animate-pulse" />
      <div className="w-10 h-10 rounded-none bg-white/5 animate-pulse" />
      <div className="w-12 h-3 rounded bg-white/5 animate-pulse" />
      <div className="w-16 h-3 rounded bg-white/5 animate-pulse" />
      <div className="w-8 h-3 rounded bg-white/5 animate-pulse" />
      <div className="w-20 h-8 rounded-none bg-white/5 animate-pulse" />
    </motion.div>
  );
}

{/*  FOLLOW MODAL  */}

function FollowModal({
  trader,
  onClose,
}: {
  trader: Trader;
  onClose: () => void;
}) {
  const account = useActiveAccount();
  const { mutateAsync: sendTx } = useSendTransaction();
  const [amount, setAmount] = useState("");
  const [allocationPct, setAllocationPct] = useState(50);
  const [ausdBalance, setAusdBalance] = useState<string>("0");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [txStatus, setTxStatus] = useState<"idle" | "approving" | "following" | "done" | "error">("idle");
  const [txError, setTxError] = useState("");

  const estimatedFee = amount ? (parseFloat(amount) * 0.30 * 0.10).toFixed(2) : "0.00";

  // Fetch aUSD balance when modal opens
  useEffect(() => {
    if (!account?.address) return;
    const fetchBalance = async () => {
      setLoadingBalance(true);
      try {
        const ausdContract = getContract({
          client,
          chain: robinhoodChain,
          address: CONTRACT_ADDRESSES.AUSD,
          abi: AUSD_ABI as any,
        });
        const bal = await readContract({
          contract: ausdContract,
          method: "balanceOf",
          params: [account.address],
        });
        setAusdBalance(formatEther(bal as bigint));
      } catch {
        setAusdBalance("0");
      } finally {
        setLoadingBalance(false);
      }
    };
    fetchBalance();
  }, [account?.address]);

  const handleMaxClick = () => {
    setAmount(parseFloat(ausdBalance).toFixed(2));
  };

  const handleConfirmCopy = async () => {
    if (!account?.address) {
      setTxError("Please connect your wallet first.");
      setTxStatus("error");
      return;
    }
    if (!amount || parseFloat(amount) <= 0) return;

    try {
      setTxStatus("approving");
      setTxError("");

      const parsedAmount = parseEther(amount);

      const ausdContract = getContract({
        client,
        chain: robinhoodChain,
        address: CONTRACT_ADDRESSES.AUSD,
        abi: AUSD_ABI as any,
      });

      const copyTradingContract = getContract({
        client,
        chain: robinhoodChain,
        address: CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2,
        abi: AURA_COPY_TRADING_V2_ABI as any,
      });

      // Step 1: Approve aUSD spending
      const approveCall = prepareContractCall({
        contract: ausdContract,
        method: "approve",
        params: [CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2, parsedAmount],
      });

      const approveTx = await sendTx(approveCall);
      await waitForReceipt({
        client,
        chain: robinhoodChain,
        transactionHash: approveTx.transactionHash,
      });

      // Step 2: Follow Leader
      setTxStatus("following");
      const scaleFactor = 10000n; // Fixed 1x scale factor (10000 bps)
      const followCall = prepareContractCall({
        contract: copyTradingContract,
        method: "followLeader",
        params: [trader.address as `0x${string}`, parsedAmount, scaleFactor, 50],
      });

      const followTx = await sendTx(followCall);
      await waitForReceipt({
        client,
        chain: robinhoodChain,
        transactionHash: followTx.transactionHash,
      });

      setTxStatus("done");
      setTimeout(() => onClose(), 2000);
    } catch (err: any) {
      console.error("Copy trade error:", err);
      setTxError(err?.message?.slice(0, 120) || "Transaction failed");
      setTxStatus("error");
    }
  };

  const balanceNum = parseFloat(ausdBalance);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: "spring", damping: 25, stiffness: 300 }}
        className="w-full max-w-lg rounded-none overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal gradient top bar */}
        <div className="h-1 bg-gradient-to-r from-neon-cyan via-neon-purple to-neon-pink" />

        <div className="bg-[#0a0a14] border border-white/10 p-6 space-y-5">
          {/*  HEADER  */}
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className="w-12 h-12 rounded-none flex items-center justify-center text-white font-bold text-lg"
                style={{ background: addrToGradient(trader.address) }}
              >
                {trader.address.slice(2, 4).toUpperCase()}
              </div>
              <div>
                <h2 className="text-lg font-bold font-display text-white">
                  Copy Trader
                </h2>
                <p className="text-sm text-white font-mono">
                  {shortAddr(trader.address)}
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-none hover:bg-white/10 transition-colors"
            >
              <X size={18} className="text-white" />
            </button>
          </div>

          {/* Trader Stats Preview */}
          <div className="grid grid-cols-3 gap-3">
            {[
              {
                label: "ROI",
                value: `${trader.roi >= 0 ? "+" : ""}${trader.roi.toFixed(1)}%`,
                color: trader.roi >= 0 ? "text-white" : "text-white",
              },
              {
                label: "Win Rate",
                value: `${trader.winRate.toFixed(0)}%`,
                color: "text-white",
              },
              {
                label: "Followers",
                value: formatCompact(trader.totalFollowers),
                color: "text-white",
              },
            ].map((s) => (
              <div
                key={s.label}
                className="bg-white/5 rounded-none p-3 text-center border border-white/5"
              >
                <div className="text-[10px] uppercase tracking-wider text-white mb-1">
                  {s.label}
                </div>
                <div className={`font-bold font-mono text-sm ${s.color}`}>
                  {s.value}
                </div>
              </div>
            ))}
          </div>

          {/* Amount Input */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-white uppercase tracking-wider">
                Allocation Amount (aUSD)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white font-mono">
                  Balance: {loadingBalance ? "" : `${balanceNum.toFixed(2)} aUSD`}
                </span>
                <button
                  onClick={handleMaxClick}
                  disabled={loadingBalance || balanceNum <= 0}
                  className="text-[10px] font-bold text-white bg-neon-cyan/10 border border-neon-cyan/30 px-2 py-0.5 rounded hover:bg-neon-cyan/20 transition-colors disabled:opacity-30"
                >
                  MAX
                </button>
              </div>
            </div>
            <div className="relative">
              <input
                type="number"
                min="0"
                placeholder="Enter amount to allocate..."
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  const val = parseFloat(e.target.value);
                  if (!isNaN(val) && balanceNum > 0) {
                    setAllocationPct(Math.min(100, Math.round((val / balanceNum) * 100)));
                  }
                }}
                className="w-full bg-white/5 border border-white/10 rounded-none px-4 py-3.5 text-white placeholder-gray-600 focus:outline-none focus:border-neon-cyan/50 focus:shadow-[0_0_20px_rgba(0,240,255,0.1)] transition-all font-mono text-lg"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-white text-sm">
                aUSD
              </span>
            </div>
            {amount && parseFloat(amount) > balanceNum && balanceNum > 0 && (
              <p className="text-[11px] text-white mt-1 font-mono">
                 Insufficient balance
              </p>
            )}
          </div>

          {/* Allocation Slider */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-white uppercase tracking-wider">
                Portfolio Allocation
              </label>
              <span className="text-sm text-white font-mono font-bold">
                {allocationPct}%
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="100"
              step="1"
              value={allocationPct}
              onChange={(e) => {
                const pct = parseInt(e.target.value);
                setAllocationPct(pct);
                setAmount(((balanceNum * pct) / 100).toFixed(2));
              }}
              className="w-full h-2 bg-white/10 rounded-none appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:bg-neon-cyan [&::-webkit-slider-thumb]:rounded-none [&::-webkit-slider-thumb]:shadow-[0_0_10px_rgba(0,240,255,0.5)] [&::-webkit-slider-thumb]:cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-white mt-1 font-mono">
              <span>10%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {/* Fee Preview */}
          <div className="bg-white/[0.03] rounded-none p-4 space-y-2 border border-white/5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-white">Performance Fee</span>
              <span className="text-white font-mono">10%</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-white">Est. Fee (@ 30% gain)</span>
              <span className="text-white font-mono">{estimatedFee} aUSD</span>
            </div>
            <div className="border-t border-white/5 my-2" />
            <div className="flex items-center gap-2 text-[11px] text-white">
              <Shield size={12} />
              Withdraw anytime. Fee only charged on positive returns.
            </div>
          </div>

          {/* TX Status feedback */}
          {txStatus !== "idle" && (
            <div className={`rounded-none p-3 border text-sm font-mono ${
              txStatus === "done"
                ? "bg-green-500/10 border-green-500/30 text-white"
                : txStatus === "error"
                ? "bg-red-500/10 border-red-500/30 text-white"
                : "bg-neon-cyan/10 border-neon-cyan/30 text-white"
            }`}>
              {txStatus === "approving" && " Step 1/2  Approving aUSD spend..."}
              {txStatus === "following" && " Step 2/2  Submitting follow transaction..."}
              {txStatus === "done" && " Copy Trade Activated! Replicating trades."}
              {txStatus === "error" && ` ${txError}`}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onClose}
              disabled={txStatus === "approving" || txStatus === "following"}
              className="flex-1 py-3.5 rounded-none border border-white/10 hover:border-white/30 text-white hover:text-white transition-all font-semibold disabled:opacity-30"
            >
              Cancel
            </button>
            <button
              disabled={
                !amount ||
                parseFloat(amount) <= 0 ||
                (parseFloat(amount) > balanceNum && balanceNum > 0) ||
                !account?.address ||
                txStatus === "approving" ||
                txStatus === "following" ||
                txStatus === "done"
              }
              className="flex-1 py-3.5 rounded-none font-bold transition-all relative overflow-hidden group disabled:opacity-30 disabled:cursor-not-allowed bg-gradient-to-r from-neon-cyan/20 to-neon-purple/20 border border-neon-cyan/40 hover:border-neon-cyan hover:shadow-[0_0_30px_rgba(0,240,255,0.3)] text-white"
              onClick={handleConfirmCopy}
            >
              <span className="relative z-10 flex items-center justify-center gap-2">
                {txStatus === "approving" || txStatus === "following" ? (
                  <RefreshCw size={16} className="animate-spin" />
                ) : (
                  <Zap size={16} />
                )}
                {txStatus === "approving" ? "Approving" :
                 txStatus === "following" ? "Following" :
                 txStatus === "done" ? "Done " :
                 !account?.address ? "Connect Wallet" :
                 "Confirm Copy"}
              </span>
              <div className="absolute inset-0 bg-gradient-to-r from-neon-cyan/0 via-neon-cyan/10 to-neon-cyan/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

/*  Main Page  */

const TIMEFRAMES = [
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "30d", value: "30d" },
  { label: "All Time", value: "all" },
];

const SORT_OPTIONS = [
  { label: "PnL", value: "totalPnl" },
  { label: "ROI", value: "roi" },
  { label: "Win Rate", value: "winRate" },
  { label: "Followers", value: "totalFollowers" },
  { label: "Copied Capital", value: "totalCopiedCapital" },
];

const AI_GLADIATORS = [
  {
    name: "DeepSeek-Degen",
    model: "DeepSeek-4-Flash",
    address: "0x0A041E6395BF1291aB06Fa1BbE16462686af0D55",
    type: "Aggressive",
    color: "from-white/20 to-white/5",
    border: "border-white/20",
    shadow: "hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]",
    desc: "Uses max leverage (20x) on extreme Fear & Greed indices. High risk, high reward.",
    icon: Flame
  },
  {
    name: "DeepSeek-Conservateur",
    model: "DeepSeek-3.2",
    address: "0xCF8CB629C6558111587912D05Ee95D089298b574",
    type: "Risk-Averse",
    color: "from-white/20 to-white/5",
    border: "border-white/20",
    shadow: "hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]",
    desc: "Focuses on capital preservation. Tight stop-losses, max 3x leverage. Trades on solid macro structures.",
    icon: Shield
  },
  {
    name: "Llama-Macro",
    model: "Llama-3.3-70B",
    address: "0x40Fc6BbaE63F4d4990F36b36e431a8340F472C0a",
    type: "Macro Whale",
    color: "from-white/20 to-white/5",
    border: "border-white/20",
    shadow: "hover:shadow-[0_0_30px_rgba(255,255,255,0.05)]",
    desc: "Analyzes Pyth Oracle feeds and global NewsAPI sentiment. Low leverage positional trading.",
    icon: Target
  }
];

export default function SocialPage() {
  const account = useActiveAccount();
  const [traders, setTraders] = useState<Trader[]>([]);
  const [stats, setStats] = useState<SocialStats>({
    totalAum: 0,
    activeTraders: 0,
    totalFollowers: 0,
    totalPnl: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [timeframe, setTimeframe] = useState("all");
  const [sortBy, setSortBy] = useState("totalPnl");
  const [search, setSearch] = useState("");
  const [sortDropdownOpen, setSortDropdownOpen] = useState(false);
  const [followModal, setFollowModal] = useState<Trader | null>(null);
  const [total, setTotal] = useState(0);
  const [isRegistering, setIsRegistering] = useState(false);

  const handleRegisterAsLeader = async () => {
    if (!account) return;
    
    try {
      setIsRegistering(true);
      const wc = createWalletClient({
        chain: {
          id: 46630,
          name: "Robinhood Testnet",
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } }
        } as any,
        account: account.address as `0x${string}`,
        transport: custom((window as any).ethereum)
      });

      await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2 as `0x${string}`,
        abi: AURA_COPY_TRADING_V2_ABI as any,
        functionName: "registerAsLeader",
        args: [1000] // 10% performance fee (1000 bps)
      });
      
    } catch (e: any) {
      console.error(e);
    } finally {
      setIsRegistering(false);
    }
  };

  /* Fetch stats */
  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/social/stats`);
      if (res.ok) {
        const data = await res.json();
        setStats(data);
      }
    } catch {
      // stats endpoint may not exist yet  use defaults
    }
  }, []);

  /* Fetch leaderboard */
  const fetchLeaderboard = useCallback(async () => {
    try {
      setRefreshing(true);
      setError(null);
      const params = new URLSearchParams({
        sortBy,
        order: "desc",
        search,
        limit: "20",
        offset: "0",
        timeframe,
      });
      const res = await fetch(`${API_URL}/api/social/leaderboard?${params}`);
      if (!res.ok) throw new Error(`API returned ${res.status}`);
      const data = await res.json();
      setTraders(data.leaders || []);
      setTotal(data.total || 0);
    } catch (err: any) {
      console.error(err);
      setTraders([]);
      setError(err.message || "Failed to load leaderboard");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sortBy, search, timeframe]);

  useEffect(() => {
    fetchStats();
    fetchLeaderboard();
  }, [fetchStats, fetchLeaderboard]);

  // Auto-refresh
  useEffect(() => {
    const iv = setInterval(() => {
      fetchStats();
      fetchLeaderboard();
    }, 30000);
    return () => clearInterval(iv);
  }, [fetchStats, fetchLeaderboard]);

  // Close sort dropdown on outside click
  useEffect(() => {
    if (!sortDropdownOpen) return;
    const handler = () => setSortDropdownOpen(false);
    window.addEventListener("click", handler);
    return () => window.removeEventListener("click", handler);
  }, [sortDropdownOpen]);

  const currentSortLabel =
    SORT_OPTIONS.find((s) => s.value === sortBy)?.label || "PnL";

  const isAlreadyTrader = account && traders.some(t => t.address.toLowerCase() === account.address.toLowerCase());

  return (
    <div className="min-h-screen bg-cyber-black text-white relative overflow-x-hidden">
      {/* Background */}
      <img src="/assets/fond_social.png" className="fixed inset-0 z-0 h-full w-full object-cover opacity-30 pointer-events-none" alt="" />
      <div className="cyber-grid-bg fixed inset-0 z-0" />
      <div className="scanlines fixed inset-0 z-[1]" />
      <div className="noise-overlay fixed inset-0 z-[1]" />

      {/* Ambient glow blobs */}
      <div className="fixed top-0 left-1/4 w-[600px] h-[600px] bg-neon-cyan/[0.03] rounded-none blur-[150px] pointer-events-none z-0" />
      <div className="fixed bottom-0 right-1/4 w-[500px] h-[500px] bg-neon-purple/[0.04] rounded-none blur-[120px] pointer-events-none z-0" />

      {/*  HEADER  */}
      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] flex-shrink-0 relative z-50 font-mono">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-white transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">AURA</span>
          </Link>
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <Link href="/trade" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Trade</Link>
            <Link href="/portfolio" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Portfolio</Link>
            <Link href="/perp-vault" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Earn Yield</Link>
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5">Copy Trade</span>
            <Link href="/social/dashboard" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Dashboard</Link>
            <Link href="/trade/account" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Account</Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <motion.button
            onClick={() => {
              fetchStats();
              fetchLeaderboard();
            }}
            disabled={refreshing}
            whileTap={{ scale: 0.92 }}
            className="p-1 rounded border border-white/10 hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-all group"
          >
            <RefreshCw
              size={12}
              className={`transition-colors ${
                refreshing
                  ? "animate-spin text-white"
                  : "text-white group-hover:text-white"
              }`}
            />
          </motion.button>
          <ConnectButton
            client={client}
            wallets={wallets}
            chain={robinhoodChain}
            connectButton={{ label: "Connect", style: { fontSize: "10px", padding: "6px 12px", height: "28px" } }}
          />
        </div>
      </header>

      {/*  HERO STATS  */}
      <section className="relative z-10 max-w-[1600px] mx-auto px-6 pt-8 pb-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: "Total AUM",
              value: Number(stats.totalAum || 0),
              prefix: "$",
              icon: DollarSign,
              color: "purple",
              borderColor: "border-purple-500/30",
              glowColor: "shadow-[0_0_30px_rgba(139,92,246,0.1)]",
              iconBg: "bg-purple-500/10",
              iconColor: "text-white",
              textColor: "text-white",
            },
            {
              label: "Active Traders",
              value: Number(stats.activeTraders || (stats as any).totalTraders || 0),
              prefix: "",
              icon: Activity,
              color: "cyan",
              borderColor: "border-neon-cyan/30",
              glowColor: "shadow-[0_0_30px_rgba(0,240,255,0.1)]",
              iconBg: "bg-neon-cyan/10",
              iconColor: "text-white",
              textColor: "text-white",
            },
            {
              label: "Total Followers",
              value: Number(stats.totalFollowers || 0),
              prefix: "",
              icon: Users,
              color: "green",
              borderColor: "border-green/30",
              glowColor: "shadow-[0_0_30px_rgba(57,255,20,0.08)]",
              iconBg: "bg-green/10",
              iconColor: "text-white",
              textColor: "text-white",
            },
            {
              label: "Total PnL",
              value: Number(stats.totalPnl || 0),
              prefix: Number(stats.totalPnl || 0) >= 0 ? "+$" : "-$",
              icon: (stats.totalPnl || 0) >= 0 ? TrendingUp : TrendingDown,
              color: (stats.totalPnl || 0) >= 0 ? "cyan" : "pink",
              borderColor:
                (stats.totalPnl || 0) >= 0
                  ? "border-[#00f0ff]/30"
                  : "border-[#FF2A6D]/30",
              glowColor:
                (stats.totalPnl || 0) >= 0
                  ? "shadow-[0_0_30px_rgba(0,240,255,0.08)]"
                  : "shadow-[0_0_30px_rgba(255,42,109,0.1)]",
              iconBg:
                (stats.totalPnl || 0) >= 0 ? "bg-[#00f0ff]/10" : "bg-[#FF2A6D]/10",
              iconColor:
                (stats.totalPnl || 0) >= 0 ? "text-white" : "text-[#FF2A6D]",
              textColor:
                (stats.totalPnl || 0) >= 0 ? "text-white" : "text-[#FF2A6D]",
            },
          ].map((card, i) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ delay: i * 0.1, duration: 0.5, ease: "easeOut" }}
              className={`bg-[#050505] border border-[#00f0ff]/10 p-5 rounded-sm hover:border-[#00f0ff]/30 ${card.glowColor} hover:scale-[1.02] transition-transform duration-300 font-mono`}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className={`p-2 rounded-sm ${card.iconBg}`}>
                  <card.icon size={16} className={card.iconColor} />
                </div>
                <span className="text-[10px] text-white/50 uppercase tracking-widest font-bold">
                  {card.label}
                </span>
              </div>
              <div className={`text-2xl font-bold ${card.textColor}`}>
                <AnimatedCounter
                  value={Math.abs(card.value)}
                  prefix={card.prefix !== undefined ? card.prefix : "$"}
                  decimals={card.label === "Active Traders" || card.label === "Total Followers" ? 0 : 2}
                />
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/* AI GLADIATORS ARENA */}
      <section className="relative z-10 max-w-[1600px] mx-auto px-6 pb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-white/5 border border-white/20 rounded-sm">
            <Target size={16} className="text-white" />
          </div>
          <div>
            <h2 className="text-xl font-display font-bold text-white tracking-widest uppercase flex items-center gap-2">
              AI Trading Arena <Zap size={18} className="text-white" />
            </h2>
            <p className="text-[10px] text-white/50 font-mono uppercase tracking-widest">
              Live Autonomous Agents • 100% On-Chain Execution
            </p>
          </div>
          <div className="ml-4 px-2 py-0.5 bg-white/10 border border-white/30 text-[9px] text-white font-mono uppercase animate-pulse">
            LIVE BETA
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {AI_GLADIATORS.map((bot, i) => (
            <motion.div
              key={bot.name}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 + i * 0.1 }}
              className={`bg-[#050505] border ${bot.border} p-5 rounded-none flex flex-col justify-between ${bot.shadow} transition-all duration-300 font-mono relative overflow-hidden group`}
            >
              <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${bot.color}`} />
              
              <div>
                <div className="flex justify-between items-start mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-sm bg-white/5 border border-white/10 flex items-center justify-center">
                      <bot.icon size={20} className="text-white" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white uppercase tracking-wider">{bot.name}</h3>
                      <p className="text-[9px] text-white/50 uppercase tracking-widest">{bot.model}</p>
                    </div>
                  </div>
                  <span className="text-[9px] bg-white/5 border border-white/10 px-2 py-1 uppercase text-white/70">
                    {bot.type}
                  </span>
                </div>
                
                <p className="text-[11px] text-white/60 mb-5 leading-relaxed min-h-[40px]">
                  {bot.desc}
                </p>
              </div>

              <div className="mt-auto">
                <button
                  onClick={() => {
                    const traderObj = traders.find(t => t.address.toLowerCase() === bot.address.toLowerCase());
                    if (traderObj) {
                      setFollowModal(traderObj);
                    } else {
                      // Fallback si le backend n'a pas encore indexé l'agent
                      setFollowModal({
                        rank: 0,
                        address: bot.address,
                        totalPnl: 0,
                        totalCopiedCapital: 0,
                        totalFollowers: 0,
                        tradesExecuted: 0,
                        roi: 0,
                        winRate: 0,
                        maxDrawdown: 0,
                        ageDays: 1
                      });
                    }
                  }}
                  className={`w-full py-2.5 text-[10px] font-bold uppercase tracking-widest bg-white/5 hover:bg-white/10 border border-white/10 hover:${bot.border} transition-all flex items-center justify-center gap-2 text-white group-hover:shadow-[0_0_20px_rgba(255,255,255,0.05)]`}
                >
                  <Copy size={14} /> Copy Agent
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </section>

      {/*  CONTROLS  */}
      <section className="relative z-20 max-w-[1600px] mx-auto px-6 py-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          {/* Timeframe Tabs */}
          <div className="flex items-center bg-[#050505] border border-[#00f0ff]/20 p-1 font-mono text-[10px] uppercase tracking-widest">
            {TIMEFRAMES.map((tf) => (
              <button
                key={tf.value}
                onClick={() => setTimeframe(tf.value)}
                className={`relative px-4 py-2 transition-all duration-200 ${
                  timeframe === tf.value
                    ? "text-white font-bold"
                    : "text-white/40 hover:text-white/70"
                }`}
              >
                {timeframe === tf.value && (
                  <motion.div
                    layoutId="timeframe-active"
                    className="absolute inset-0 bg-[#00f0ff]/10 border-b-2 border-[#00f0ff]"
                    transition={{ type: "spring", damping: 30, stiffness: 400 }}
                  />
                )}
                <span className="relative z-10">{tf.label}</span>
              </button>
            ))}
          </div>

          {/* Search + Sort */}
          <div className="flex items-center gap-3 w-full lg:w-auto">
            {/* Create Strategy Button */}
            {account && (
              <button
                onClick={handleRegisterAsLeader}
                disabled={isRegistering || isAlreadyTrader}
                className={`mr-2 hidden lg:flex items-center justify-center gap-2 px-6 py-2.5 bg-[#00f0ff]/15 text-white border-b-2 border-[#00f0ff] transition-all text-xs font-bold font-mono tracking-wide ${
                  isAlreadyTrader 
                    ? "opacity-50 cursor-not-allowed pointer-events-none" 
                    : "hover:bg-[#00f0ff]/25"
                }`}
              >
                <TrendingUp size={14} />
                <div className="flex flex-col items-start">
                  <span>{isAlreadyTrader ? "REGISTERED" : isRegistering ? "REGISTERING..." : "REGISTER AS TRADER"}</span>
                  <span className="text-[9px] text-white font-normal">{isAlreadyTrader ? "You are a leader" : "Earn 10% Perf. Fee"}</span>
                </div>
              </button>
            )}

            {/* Search */}
            <div className="relative flex-1 lg:flex-none lg:w-64">
              <Search
                size={15}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-white"
              />
              <input
                type="text"
                placeholder="Search trader..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full bg-[#050505] border border-[#00f0ff]/20 rounded-none pl-10 pr-4 py-2.5 text-xs text-white placeholder-white/30 focus:outline-none focus:border-[#00f0ff]/50 focus:shadow-[0_0_15px_rgba(0,240,255,0.05)] transition-all font-mono uppercase tracking-wider"
              />
            </div>

            {/* Sort Dropdown */}
            <div className="relative z-50">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setSortDropdownOpen(!sortDropdownOpen);
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-[#050505] border border-[#00f0ff]/20 rounded-none text-xs text-white/50 hover:text-white hover:border-[#00f0ff]/50 transition-all font-mono uppercase tracking-wider"
              >
                <BarChart3 size={14} />
                Sort: {currentSortLabel}
                <ChevronDown
                  size={14}
                  className={`transition-transform ${sortDropdownOpen ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence>
                {sortDropdownOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: -5 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -5 }}
                    className="absolute right-0 mt-2 w-44 bg-[#050505] border border-[#00f0ff]/20 rounded-none overflow-hidden shadow-2xl z-[100] font-mono text-[10px] uppercase tracking-widest"
                  >
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setSortBy(opt.value);
                          setSortDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors ${
                          sortBy === opt.value
                            ? "bg-neon-cyan/10 text-white"
                            : "text-white hover:bg-white/5 hover:text-white"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>
      </section>

      {/*  LEADERBOARD TABLE  */}
      <section className="relative z-10 max-w-[1600px] mx-auto px-6 pb-12">
        <div className="bg-[#050505] border border-[#00f0ff]/20 rounded-none overflow-hidden font-mono text-[10px]">
          {/*  HEADER  */}
          <div className="hidden lg:flex items-center gap-4 px-5 py-3 border-b border-[#00f0ff]/30 text-white uppercase tracking-widest font-bold bg-[#0a0a0a]">
            <div className="w-10 text-center">#</div>
            <div className="flex-1 min-w-[200px]">Trader</div>
            <div className="w-24 text-right">PnL</div>
            <div className="w-32">ROI</div>
            <div className="w-14 text-center">Win%</div>
            <div className="w-16 text-center">Followers</div>
            <div className="w-20 text-right">AUM</div>
            <div className="w-24" />
          </div>

          {/* Loading State */}
          {loading && (
            <div>
              {Array.from({ length: 8 }).map((_, i) => (
                <SkeletonRow key={i} index={i} />
              ))}
            </div>
          )}

          {/* Error State */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 rounded-none bg-coral/10 flex items-center justify-center mb-4">
                <Activity size={28} className="text-coral" />
              </div>
              <h3 className="text-lg font-bold text-white mb-2">
                Connection Error
              </h3>
              <p className="text-white text-sm max-w-md mb-4">{error}</p>
              <button
                onClick={fetchLeaderboard}
                className="px-5 py-2.5 rounded-none border border-neon-cyan/30 text-white text-sm font-semibold hover:bg-neon-cyan/10 transition-colors"
              >
                Retry
              </button>
            </div>
          )}

          {/* Empty State */}
          {!loading && !error && traders.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="relative mb-6">
                <div className="w-20 h-20 rounded-none bg-neon-cyan/5 border border-neon-cyan/10 flex items-center justify-center">
                  <Trophy size={36} className="text-white" />
                </div>
                <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-none bg-neon-purple/10 border border-neon-purple/20 flex items-center justify-center">
                  <Star size={14} className="text-neon-purple/40" />
                </div>
              </div>
              <h3 className="text-lg font-bold text-white mb-2 font-display">
                No Traders Yet
              </h3>
              <p className="text-white text-sm max-w-md">
                The leaderboard is waiting for its first strategist.
                <br />
                Deploy a strategy on AuraSocialTrading to appear here.
              </p>
            </div>
          )}

          {/* Trader Rows */}
          {!loading && !error && traders.length > 0 && (
            <div>
              {traders.map((trader, i) => (
                <motion.div
                  key={trader.address}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{
                    delay: i * 0.04,
                    duration: 0.4,
                    ease: "easeOut",
                  }}
                  className="group flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-4 px-5 py-4 border-b border-white/5 hover:bg-[#00f0ff]/[0.02] transition-colors duration-200 cursor-pointer"
                  onClick={() => {
                    window.location.href = `/social/trader/${trader.address}`;
                  }}
                >
                  {/* Rank */}
                  <RankBadge rank={trader.rank} />

                  {/* Trader Info */}
                  <div className="flex-1 min-w-[200px] flex items-center gap-3">
                    <div
                      className="w-9 h-9 rounded-none flex items-center justify-center text-white text-xs font-bold shrink-0 ring-2 ring-white/10 group-hover:ring-neon-cyan/30 transition-all"
                      style={{ background: addrToGradient(trader.address) }}
                    >
                      {trader.address.slice(2, 4).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-white font-mono truncate">
                          {shortAddr(trader.address)}
                        </span>
                        {trader.rank <= 3 && (
                          <Flame
                            size={12}
                            className="text-orange-400 shrink-0"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  {/* PnL */}
                  <div className="w-24 text-right">
                    <span
                      className={`text-[10px] font-bold font-mono ${
                        trader.totalPnl >= 0 ? "text-white" : "text-[#FF2A6D]"
                      }`}
                    >
                      {trader.totalPnl >= 0 ? "+" : ""}
                      {formatUSD(trader.totalPnl)}
                    </span>
                  </div>

                  {/* ROI */}
                  <div className="w-32">
                    <RoiBar roi={trader.roi} />
                  </div>

                  {/* Win Rate */}
                  <div className="w-14 flex justify-center">
                    <WinRateCircle rate={trader.winRate} />
                  </div>

                  {/* Followers */}
                  <div className="w-16 text-center">
                    <span className="text-[10px] text-white/60 font-mono">
                      {formatCompact(trader.totalFollowers)}
                    </span>
                  </div>

                  {/* AUM */}
                  <div className="w-20 text-right">
                    <span className="text-[10px] text-white/60 font-mono">
                      {formatUSD(trader.totalCopiedCapital)}
                    </span>
                  </div>

                  {/* Copy Button */}
                  <div className="w-24">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setFollowModal(trader);
                      }}
                      className="flex items-center justify-center gap-1.5 px-3 py-2 text-[10px] font-mono font-bold tracking-widest uppercase border border-[#00f0ff]/30 text-white bg-[#00f0ff]/5 hover:bg-[#00f0ff]/15 hover:border-[#00f0ff]/60 hover:shadow-[0_0_20px_rgba(0,240,255,0.15)] transition-all duration-200 group/btn"
                    >
                      <Copy
                        size={12}
                        className="group-hover/btn:scale-110 transition-transform"
                      />
                      Copy
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          )}

          {/* Footer with total count */}
          {!loading && traders.length > 0 && (
            <div className="px-5 py-3 border-t border-white/[0.06] flex items-center justify-between text-xs text-white">
              <span>
                Showing {traders.length} of {total} traders
              </span>
              <span className="flex items-center gap-1.5">
                <div className="w-1.5 h-1.5 rounded-none bg-green animate-pulse" />
                Live  Auto-refresh every 30s
              </span>
            </div>
          )}
        </div>
      </section>

      {/*  FOLLOW MODAL  */}
      <AnimatePresence>
        {followModal && (
          <FollowModal
            trader={followModal}
            onClose={() => setFollowModal(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
