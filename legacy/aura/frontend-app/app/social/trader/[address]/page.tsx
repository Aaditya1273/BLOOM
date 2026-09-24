"use client";

import { useState, useEffect, useCallback, useMemo, useRef, Suspense } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Copy,
  Check,
  TrendingUp,
  TrendingDown,
  Users,
  Star,
  Shield,
  Zap,
  Clock,
  DollarSign,
  Activity,
  Target,
  AlertTriangle,
  ChevronDown,
  X,
  Award,
  Flame,
} from "lucide-react";
import { ConnectButton, useActiveAccount, useSendTransaction } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain, readContract, getContract, prepareContractCall, waitForReceipt } from "thirdweb";
import { client } from "../../../client";
import { API_URL } from "../../../../lib/config";
import { CONTRACT_ADDRESSES, AURA_COPY_TRADING_V2_ABI, AUSD_ABI } from "../../../../lib/contracts";
import { parseEther, formatEther } from "viem";

//  Chain & wallet config 
const robinhoodChain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
});

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
];

//  Types 
type HistoryEntry = {
  date: string;
  cumulativePnl: number;
  dailyPnl: number;
  roi: number;
};

type TraderHistory = {
  address: string;
  days: number;
  totalPnl: number;
  totalCopiedCapital: number;
  history: HistoryEntry[];
};

type Strategy = {
  id: number;
  name: string;
  description: string;
  totalPnl: string;
  roi: number;
  winRate: number;
  followerCount: number;
  totalFollowerCapital: string;
  performanceFeeBps: number;
  isActive: boolean;
};

type TraderProfile = {
  address: string;
  rank: number;
  totalPnl: number;
  roi: number;
  winRate: number;
  tradesExecuted: number;
  maxDrawdown: number;
  totalCopiedCapital: number;
  totalFollowers: number;
  createdAt: string;
};

type FollowerPosition = {
  isFollowing: boolean;
  capitalDeposited: number;
  highWaterMark: number;
  followedAt: string;
};

//  Helpers 
function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}${addr.slice(-4)}` : "";
}

function formatNumber(n: number, decimals = 2): string {
  if (Math.abs(n) >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (Math.abs(n) >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toFixed(decimals);
}

/** Deterministic gradient from address hash */
function addressToGradient(address: string): [string, string] {
  const colors = [
    "#00f0ff", "#ff00a0", "#39ff14", "#bd00ff", "#f0e800",
    "#ffae00", "#0088ff", "#E86A56", "#8B5CF6", "#1FCB4F",
  ];
  if (!address || address.length < 10) return [colors[0], colors[1]];
  const hash = address.toLowerCase().replace("0x", "");
  const i1 = parseInt(hash.slice(0, 4), 16) % colors.length;
  let i2 = parseInt(hash.slice(4, 8), 16) % colors.length;
  if (i2 === i1) i2 = (i2 + 1) % colors.length;
  return [colors[i1], colors[i2]];
}

//  Avatar Component 
function TraderAvatar({ address, size = 96 }: { address: string; size?: number }) {
  const [c1, c2] = addressToGradient(address);
  const id = `avatar-${address.slice(2, 10)}`;
  return (
    <svg width={size} height={size} viewBox="0 0 96 96" className="rounded-none">
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={c1} />
          <stop offset="100%" stopColor={c2} />
        </linearGradient>
        <clipPath id={`clip-${id}`}>
          <rect width="96" height="96" rx="16" />
        </clipPath>
      </defs>
      <g clipPath={`url(#clip-${id})`}>
        <rect width="96" height="96" fill={`url(#${id})`} />
        {/* Geometric pattern from address */}
        {address && address.length >= 42 && Array.from({ length: 9 }, (_, i) => {
          const x = (parseInt(address.slice(2 + i * 2, 4 + i * 2), 16) / 255) * 96;
          const y = (parseInt(address.slice(12 + i * 2, 14 + i * 2), 16) / 255) * 96;
          const r = 4 + (parseInt(address.slice(22 + i, 23 + i), 16) / 15) * 12;
          return (
            <circle
              key={i}
              cx={x || 0}
              cy={y || 0}
              r={r || 0}
              fill="rgba(255,255,255,0.12)"
              stroke="rgba(255,255,255,0.2)"
              strokeWidth="0.5"
            />
          );
        })}
        {/* Center hexagon */}
        <polygon
          points="48,20 68,34 68,62 48,76 28,62 28,34"
          fill="rgba(0,0,0,0.3)"
          stroke="rgba(255,255,255,0.3)"
          strokeWidth="1"
        />
        <text
          x="48"
          y="52"
          textAnchor="middle"
          fill="white"
          fontSize="14"
          fontFamily="Space Mono, monospace"
          fontWeight="bold"
        >
          {address.slice(2, 4).toUpperCase()}
        </text>
      </g>
    </svg>
  );
}

//  SVG Performance Chart 
function PerformanceChart({
  history,
  isPositive,
}: {
  history: HistoryEntry[];
  isPositive: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    entry: HistoryEntry;
  } | null>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 300 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(([e]) => {
      setDimensions({
        width: e.contentRect.width,
        height: Math.max(260, Math.min(340, e.contentRect.width * 0.38)),
      });
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const { width, height } = dimensions;
  const pad = { top: 30, right: 20, bottom: 40, left: 65 };
  const chartW = width - pad.left - pad.right;
  const chartH = height - pad.top - pad.bottom;

  const pnlValues = history.map((h) => h.cumulativePnl);
  const minPnl = Math.min(0, ...pnlValues);
  const maxPnl = Math.max(0, ...pnlValues);
  const range = maxPnl - minPnl || 1;

  const points = history.map((h, i) => ({
    x: pad.left + (i / Math.max(history.length - 1, 1)) * chartW,
    y: pad.top + chartH - ((h.cumulativePnl - minPnl) / range) * chartH,
    entry: h,
  }));

  const pathD = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join(" ");
  const areaD = `${pathD} L${points[points.length - 1]?.x ?? pad.left},${pad.top + chartH} L${pad.left},${pad.top + chartH} Z`;

  const accentColor = isPositive ? "#39ff14" : "#E86A56";
  const accentGlow = isPositive ? "rgba(57,255,20,0.3)" : "rgba(232,106,86,0.3)";
  const gradId = `pnlGrad-${isPositive ? "pos" : "neg"}`;

  // Y-axis ticks
  const yTicks = 5;
  const yStep = range / yTicks;
  const yLabels = Array.from({ length: yTicks + 1 }, (_, i) => minPnl + i * yStep);

  // X-axis labels (show ~6 dates)
  const xStep = Math.max(1, Math.floor(history.length / 6));
  const xLabels = history.filter((_, i) => i % xStep === 0 || i === history.length - 1);

  return (
    <div ref={containerRef} className="w-full relative">
      <svg
        width={width}
        height={height}
        className="overflow-visible"
        onMouseLeave={() => setTooltip(null)}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={accentColor} stopOpacity="0.35" />
            <stop offset="100%" stopColor={accentColor} stopOpacity="0.02" />
          </linearGradient>
          <filter id="chartGlow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        {/* Grid lines */}
        {yLabels.map((val, i) => {
          const y = pad.top + chartH - ((val - minPnl) / range) * chartH;
          return (
            <g key={`y-${i}`}>
              <line
                x1={pad.left}
                y1={y}
                x2={pad.left + chartW}
                y2={y}
                stroke="rgba(255,255,255,0.06)"
                strokeDasharray="4 4"
              />
              <text
                x={pad.left - 10}
                y={y + 4}
                textAnchor="end"
                fill="rgba(255,255,255,0.35)"
                fontSize="10"
                fontFamily="Space Mono, monospace"
              >
                {formatNumber(val)}
              </text>
            </g>
          );
        })}

        {/* Zero line */}
        {minPnl < 0 && maxPnl > 0 && (
          <line
            x1={pad.left}
            y1={pad.top + chartH - ((0 - minPnl) / range) * chartH}
            x2={pad.left + chartW}
            y2={pad.top + chartH - ((0 - minPnl) / range) * chartH}
            stroke="rgba(255,255,255,0.15)"
            strokeWidth="1"
          />
        )}

        {/* X-axis labels */}
        {xLabels.map((h) => {
          const idx = history.indexOf(h);
          const x = pad.left + (idx / Math.max(history.length - 1, 1)) * chartW;
          const label = new Date(h.date).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
          });
          return (
            <text
              key={h.date}
              x={x}
              y={height - 8}
              textAnchor="middle"
              fill="rgba(255,255,255,0.3)"
              fontSize="10"
              fontFamily="Space Mono, monospace"
            >
              {label}
            </text>
          );
        })}

        {/* Area fill */}
        {points.length > 1 && (
          <path d={areaD} fill={`url(#${gradId})`} />
        )}

        {/* Line */}
        {points.length > 1 && (
          <path
            d={pathD}
            fill="none"
            stroke={accentColor}
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#chartGlow)"
          />
        )}

        {/* Hover targets */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={14}
            fill="transparent"
            onMouseEnter={(e) => {
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                setTooltip({
                  x: p.x,
                  y: p.y,
                  entry: p.entry,
                });
              }
            }}
          />
        ))}

        {/* Hover dot */}
        {tooltip && (
          <>
            <line
              x1={tooltip.x}
              y1={pad.top}
              x2={tooltip.x}
              y2={pad.top + chartH}
              stroke={accentColor}
              strokeOpacity="0.3"
              strokeDasharray="3 3"
            />
            <circle
              cx={tooltip.x}
              cy={tooltip.y}
              r={5}
              fill={accentColor}
              stroke="#020204"
              strokeWidth="2"
            />
            <circle
              cx={tooltip.x}
              cy={tooltip.y}
              r={8}
              fill="none"
              stroke={accentColor}
              strokeOpacity="0.4"
              strokeWidth="1"
            />
          </>
        )}
      </svg>

      {/* Tooltip overlay */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="absolute pointer-events-none z-20"
            style={{
              left: Math.min(tooltip.x - 70, width - 160),
              top: Math.max(tooltip.y - 80, 4),
            }}
          >
            <div className="glass-card-cyber rounded-none px-3 py-2 text-xs min-w-[140px]">
              <div className="text-white/80 font-mono mb-1">
                {new Date(tooltip.entry.date).toLocaleDateString("en-US", {
                  month: "short",
                  day: "numeric",
                  year: "numeric",
                })}
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-white/80">PnL</span>
                <span
                  className={`font-bold font-mono ${
                    tooltip.entry.cumulativePnl >= 0
                      ? "text-neon-green cyber-glow-green"
                      : "text-coral cyber-glow-red"
                  }`}
                >
                  {tooltip.entry.cumulativePnl >= 0 ? "+" : ""}
                  {formatNumber(tooltip.entry.cumulativePnl)}
                </span>
              </div>
              <div className="flex justify-between gap-4 mt-0.5">
                <span className="text-white/80">Daily</span>
                <span
                  className={`font-mono ${
                    tooltip.entry.dailyPnl >= 0 ? "text-white/80" : "text-white/80"
                  }`}
                >
                  {tooltip.entry.dailyPnl >= 0 ? "+" : ""}
                  {formatNumber(tooltip.entry.dailyPnl)}
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

//  Circular Progress Ring 
function CircleProgress({
  value,
  max = 100,
  size = 56,
  strokeWidth = 4,
  color = "#00f0ff",
}: {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const r = (size - strokeWidth) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="rgba(255,255,255,0.06)"
        strokeWidth={strokeWidth}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circ}
        strokeDashoffset={circ * (1 - pct)}
        style={{
          filter: `drop-shadow(0 0 4px ${color})`,
          transition: "stroke-dashoffset 1s ease-out",
        }}
      />
    </svg>
  );
}

//  Main Page Component 
export default function TraderProfilePage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-cyber-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" style={{ boxShadow: '0 0 15px rgba(0,240,255,0.3)' }} />
          <span className="text-white/80 font-mono text-sm tracking-widest uppercase">Loading profile</span>
        </div>
      </div>
    }>
      <TraderProfileContent />
    </Suspense>
  );
}

function TraderProfileContent() {
  const params = useParams();
  const address = (params?.address as string) || "";
  const account = useActiveAccount();

  //  State 
  const [profile, setProfile] = useState<TraderProfile | null>(null);
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [history, setHistory] = useState<TraderHistory | null>(null);
  const [followerPositions, setFollowerPositions] = useState<
    Record<number, FollowerPosition>
  >({});
  const [selectedPeriod, setSelectedPeriod] = useState<7 | 30 | 90>(30);
  const [loading, setLoading] = useState(true);
  const initialFetchDone = useRef(false);
  const [copied, setCopied] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [modalStrategy, setModalStrategy] = useState<Strategy | null>(null);
  const [followAmount, setFollowAmount] = useState("");
  const [allocationPct, setAllocationPct] = useState(25);
  const { mutateAsync: sendTx } = useSendTransaction();

  // aUSD tracking
  const [ausdBalance, setAusdBalance] = useState<string>("0");
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [txStatus, setTxStatus] = useState<"idle" | "approving" | "following" | "done" | "error">("idle");
  const [txError, setTxError] = useState("");
  useEffect(() => {
    if (!account?.address || !showModal) return;
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
  }, [account?.address, showModal]);

  const handleMaxClick = () => {
    setFollowAmount(parseFloat(ausdBalance).toFixed(2));
  };

  // Fetch trader data 
  const fetchTraderData = useCallback(async () => {
    if (!address) return;
    try {
      if (!initialFetchDone.current) setLoading(true);

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);

      const [profileRes, historyRes] = await Promise.all([
        fetch(`${API_URL}/api/social/trader/${address}`, { signal: controller.signal }),
        fetch(
          `${API_URL}/api/social/trader/${address}/history?days=${selectedPeriod}`,
          { signal: controller.signal }
        ),
      ]);
      clearTimeout(timeoutId);

      if (profileRes.ok) {
        const data = await profileRes.json();
        setProfile(data.profile ? {
          ...data.profile,
          rank: data.profile.rank ?? 0,
          maxDrawdown: data.profile.maxDrawdown ?? 0,
          createdAt: data.profile.createdAt || new Date().toISOString()
        } : null);
        setStrategies(data.strategies || []);
      }

      if (historyRes.ok) {
        const hData = await historyRes.json();
        setHistory(hData);
      }
    } catch {
      // Backend not available -> fetch from blockchain directly!
      try {
        const copyTradingContract = getContract({
          client,
          chain: robinhoodChain,
          address: CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2,
          abi: AURA_COPY_TRADING_V2_ABI as any,
        });
        
        const leaderData = await readContract({
          contract: copyTradingContract,
          method: "leaders",
          params: [address],
        });

        const [
          isRegistered, isActive, performanceFeeBps, 
          totalFollowers, totalCopiedCapital, 
          totalRealizedPnl, isPnlPositive, 
          tradesExecuted, tradesWon, createdAt
        ] = leaderData as any;

        if (isRegistered) {
          const realizedPnlNum = parseFloat(formatEther(totalRealizedPnl));
          const pnlValue = isPnlPositive ? realizedPnlNum : -realizedPnlNum;
          const copiedCapNum = parseFloat(formatEther(totalCopiedCapital));
          
          setProfile({
            address,
            rank: 0,
            totalPnl: pnlValue,
            roi: copiedCapNum > 0 ? (pnlValue / copiedCapNum) * 100 : 0,
            winRate: Number(tradesExecuted) > 0 ? (Number(tradesWon) / Number(tradesExecuted)) * 100 : 0,
            tradesExecuted: Number(tradesExecuted),
            maxDrawdown: 0,
            totalCopiedCapital: copiedCapNum,
            totalFollowers: Number(totalFollowers),
            createdAt: new Date(Number(createdAt) * 1000).toISOString(),
          });

          setStrategies([
            {
              id: 1, // Currently V2 supports 1 strategy per leader
              name: "Primary Strategy",
              description: "On-chain strategy executed by this leader",
              totalPnl: pnlValue.toFixed(2),
              roi: copiedCapNum > 0 ? (pnlValue / copiedCapNum) * 100 : 0,
              winRate: Number(tradesExecuted) > 0 ? (Number(tradesWon) / Number(tradesExecuted)) * 100 : 0,
              followerCount: Number(totalFollowers),
              totalFollowerCapital: copiedCapNum.toFixed(2),
              performanceFeeBps: Number(performanceFeeBps),
              isActive: isActive,
            }
          ]);
        } else {
          // Not registered
          setProfile(null);
          setStrategies([]);
        }
        
        // Zero out history to avoid fake charts
        const days = selectedPeriod;
        const flatHistory: HistoryEntry[] = [];
        for (let i = 0; i < days; i++) {
          const date = new Date(Date.now() - (days - i) * 86400000).toISOString().split("T")[0];
          flatHistory.push({ date, cumulativePnl: 0, dailyPnl: 0, roi: 0 });
        }
        setHistory({
          address,
          days,
          totalPnl: 0,
          totalCopiedCapital: 0,
          history: flatHistory,
        });

      } catch (e) {
        console.error("Failed to fetch from contract:", e);
        setProfile(null);
        setStrategies([]);
        setHistory(null);
      }
    } finally {
      setLoading(false);
      initialFetchDone.current = true;
    }
  }, [address, selectedPeriod]);

  useEffect(() => {
    fetchTraderData();
  }, [fetchTraderData]);

  //  Fetch follower positions 
  useEffect(() => {
    if (!account?.address || strategies.length === 0) return;
    const fetchPositions = async () => {
      const positions: Record<number, FollowerPosition> = {};
      await Promise.all(
        strategies.map(async (s) => {
          try {
            const res = await fetch(
              `${API_URL}/api/social/position/${s.id}/${account.address}`
            );
            if (res.ok) {
              const data = await res.json();
              if (data.isFollowing) positions[s.id] = data;
            }
          } catch {
            // ignore
          }
        })
      );
      setFollowerPositions(positions);
    };
    fetchPositions();
  }, [account?.address, strategies]);

  //  Derived 
  const isPositivePnl = (profile?.totalPnl ?? 0) >= 0;
  const daysActive = profile ? Math.max(1, Math.floor((Date.now() - new Date(profile.createdAt).getTime()) / 86400000)) : 0;
  const badges = useMemo(() => {
    if (!profile) return [];
    const b: { label: string; color: string; icon: React.ReactNode }[] = [];
    if (profile.rank <= 3)
      b.push({
        label: "Top 3",
        color: "from-yellow-500 to-amber-600",
        icon: <Award size={12} />,
      });
    if (daysActive > 30)
      b.push({
        label: "Veteran",
        color: "from-purple-500 to-purple-700",
        icon: <Shield size={12} />,
      });
    if (profile.totalCopiedCapital > 1000)
      b.push({
        label: "Whale",
        color: "from-neon-cyan to-blue-600",
        icon: <Flame size={12} />,
      });
    if (profile.winRate > 70)
      b.push({
        label: "Sharpshooter",
        color: "from-neon-green to-emerald-600",
        icon: <Target size={12} />,
      });
    return b;
  }, [profile]);

  //  Copy address 
  const copyAddress = () => {
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  //  Modal helpers 
  const openCopyTradeModal = (strategy?: Strategy) => {
    setModalStrategy(strategy || null);
    setFollowAmount("");
    setAllocationPct(25);
    setShowModal(true);
  };

  const handleConfirmFollow = async () => {
    if (!account?.address) return;

    try {
      setTxError("");
      setTxStatus("approving");
      const parsedAmount = parseEther(followAmount || "0");
      
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

      const approveCall = prepareContractCall({
        contract: ausdContract,
        method: "approve",
        params: [CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2, parsedAmount]
      });

      const txResult = await sendTx(approveCall);
      
      await waitForReceipt({
        client,
        chain: robinhoodChain,
        transactionHash: txResult.transactionHash,
      });

      setTxStatus("following");

      const followCall = prepareContractCall({
        contract: copyTradingContract,
        method: "followLeader",
        params: [address, parsedAmount, BigInt(Math.floor((allocationPct / 100) * 10000)), 50n]
      });

      await sendTx(followCall);
      setTxStatus("done");
      setCopied(true);
      setTimeout(() => {
        setShowModal(false);
        setTxStatus("idle");
      }, 2000);
    } catch (err: any) {
      console.error(err);
      setTxError(err.message || "Failed to copy trader");
      setTxStatus("error");
    }
  };
  //  Loading state 
  if (loading) {
    return (
      <div className="min-h-screen bg-cyber-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
            className="w-12 h-12 border-2 border-neon-cyan border-t-transparent rounded-full"
            style={{
              boxShadow: "0 0 15px rgba(0,240,255,0.3)",
            }}
          />
          <span className="text-white/80 font-mono text-sm tracking-widest uppercase">
            Loading profile
          </span>
        </div>
      </div>
    );
  }

  //  No profile found 
  if (!profile) {
    return (
      <div className="min-h-screen bg-cyber-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="text-4xl mb-2"></div>
          <h2 className="text-xl font-bold text-white/80 font-mono">Trader Not Found</h2>
          <p className="text-white/60 text-sm font-mono max-w-md">
            No profile data available for this address. The trader may not be registered yet.
          </p>
          <Link href="/social" className="mt-4 px-6 py-2 bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/30 rounded-none text-white/60 text-sm font-bold hover:bg-neon-cyan/20 transition-all">
             Back to Leaderboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cyber-black text-white/80 selection:bg-neon-cyan/30 overflow-x-hidden font-sans relative">
      {/* Background */}
      <img src="/assets/fond_social.png" className="fixed inset-0 z-0 h-full w-full object-cover opacity-30 pointer-events-none" alt="" />
      <div className="cyber-grid-bg fixed inset-0 z-0" />
      <div className="scanlines fixed inset-0 z-[1]" />
      <div className="noise-overlay fixed inset-0 z-[1]" />

      {/*  HEADER  */}
      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] flex-shrink-0 relative z-50 font-mono">
        <div className="flex items-center gap-3">
          <Link href="/social" className="text-white/40 hover:text-white/80 transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
          </Link>
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <Link href="/trade" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Trade</Link>
            <Link href="/portfolio" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Portfolio</Link>
            <Link href="/perp-vault" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Earn Yield</Link>
            <Link href="/social" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Copy Trade</Link>
            <Link href="/social/dashboard" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Dashboard</Link>
            <Link href="/trade/account" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Account</Link>
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5 ml-2">Trader Profile</span>
          </div>
        </div>
        <ConnectButton
          client={client}
          wallets={wallets}
          chain={robinhoodChain}
          connectButton={{ label: "Connect", style: { fontSize: "10px", padding: "6px 12px", height: "28px" } }}
        />
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pb-20">
        {/*  HERO SECTION  */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mt-8"
        >
          <div className="bg-[#050505] border border-[#00f0ff]/10 rounded-none p-6 sm:p-8 relative overflow-hidden">
            {/* Decorative corner accents */}
            
            

            {/* Background */}
            <div
              className="absolute -top-20 -right-20 w-60 h-60 rounded-full opacity-10 blur-3xl pointer-events-none"
              style={{
                background: `radial-gradient(circle, ${
                  isPositivePnl ? "#39ff14" : "#E86A56"
                }, transparent)`,
              }}
            />

            <div className="flex flex-col sm:flex-row items-start sm:items-center gap-6 relative">
              {/* Avatar */}
              <motion.div
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.2, type: "spring" }}
                className="relative"
              >
                <TraderAvatar address={address} size={96} />
                {/*  Rank Badge  */}
                {profile && (
                  <div className="absolute -top-2 -right-2 w-8 h-8 rounded-full bg-gradient-to-br from-yellow-400 to-amber-600 flex items-center justify-center text-xs font-bold text-black shadow-lg">
                    #{profile.rank}
                  </div>
                )}
              </motion.div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                {/* Address row */}
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <button
                    onClick={copyAddress}
                    className="flex items-center gap-2 font-mono text-sm text-white/80 hover:text-white/80 transition-colors group bg-white/[0.03] px-3 py-1.5 rounded-none border border-white/[0.06] hover:border-neon-cyan/30"
                  >
                    <span className="truncate max-w-[320px]">{address}</span>
                    {copied ? (
                      <Check size={14} className="text-neon-green shrink-0" />
                    ) : (
                      <Copy
                        size={14}
                        className="text-white/80 group-hover:text-white/80 shrink-0"
                      />
                    )}
                  </button>
                </div>

                {/* Badges */}
                <div className="flex items-center gap-2 flex-wrap mb-4">
                  {badges.map((b, i) => (
                    <motion.span
                      key={b.label}
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ delay: 0.3 + i * 0.1 }}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-white/80 bg-gradient-to-r ${b.color}`}
                      style={{
                        boxShadow: "0 0 12px rgba(0,0,0,0.3)",
                      }}
                    >
                      {b.icon}
                      {b.label}
                    </motion.span>
                  ))}
                </div>

                {/* Main stats row */}
                {profile && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                    {[
                      {
                        label: "Total PnL",
                        value: `${profile.totalPnl >= 0 ? "+" : ""}${formatNumber(profile.totalPnl)}`,
                        sub: "aUSD",
                        color: profile.totalPnl >= 0 ? "text-neon-green" : "text-coral",
                        glow: profile.totalPnl >= 0 ? "cyber-glow-green" : "cyber-glow-red",
                      },
                      {
                        label: "ROI",
                        value: `${profile.roi >= 0 ? "+" : ""}${profile.roi.toFixed(1)}%`,
                        sub: `${selectedPeriod}d`,
                        color: profile.roi >= 0 ? "text-neon-green" : "text-coral",
                        glow: profile.roi >= 0 ? "cyber-glow-green" : "cyber-glow-red",
                      },
                      {
                        label: "Win Rate",
                        value: `${profile.winRate.toFixed(1)}%`,
                        sub: `${profile.tradesExecuted} trades`,
                        color: "text-white/80",
                        glow: "cyber-glow-cyan",
                      },
                      {
                        label: "Total Trades",
                        value: profile.tradesExecuted.toString(),
                        sub: "all time",
                        color: "text-white/80",
                        glow: "",
                      },
                    ].map((stat, i) => (
                      <motion.div
                        key={stat.label}
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.4 + i * 0.08 }}
                      >
                        <div className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-1">
                          {stat.label}
                        </div>
                        <div
                          className={`text-xl sm:text-2xl font-display font-bold ${stat.color} ${stat.glow}`}
                        >
                          {stat.value}
                        </div>
                        <div className="text-[10px] text-white/40">{stat.sub}</div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>

              {/* CTA Button */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.6 }}
                className="shrink-0 self-center"
              >
                <button
                  onClick={() => openCopyTradeModal()}
                  disabled={!account}
                  className="w-full bg-[#00f0ff]/10 hover:bg-[#00f0ff]/20 text-[#00f0ff] border border-[#00f0ff]/30 text-xs font-mono uppercase px-4 py-3 transition-colors rounded-none disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  <span className="relative z-10 flex items-center gap-2">
                    <Zap size={16} />
                    Copy This Trader
                  </span>
                </button>
                {!account && (
                  <p className="text-[10px] text-white/40 text-center mt-2">
                    Connect wallet to copy trade
                  </p>
                )}
              </motion.div>
            </div>
          </div>
        </motion.section>

        {/*  PERFORMANCE CHART  */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
          className="mt-6"
        >
          <div className="bg-[#050505] border border-[#00f0ff]/10 rounded-none p-5 sm:p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <TrendingUp size={18} className="text-white/80" />
                <h2 className="font-display font-bold text-base">
                  Cumulative PnL
                </h2>
                {history && (
                  <span
                    className={`font-mono text-sm font-bold ${
                      history.totalPnl >= 0
                        ? "text-neon-green cyber-glow-green"
                        : "text-coral cyber-glow-red"
                    }`}
                  >
                    {history.totalPnl >= 0 ? "+" : ""}
                    {formatNumber(history.totalPnl)} aUSD
                  </span>
                )}
              </div>

              {/* Period selector */}
              <div className="flex items-center gap-1 bg-white/[0.03] rounded-none p-1 border border-white/[0.06]">
                {([7, 30, 90] as const).map((d) => (
                  <button
                    key={d}
                    onClick={() => setSelectedPeriod(d)}
                    className={`px-3 py-1.5 rounded-md text-xs font-mono font-bold transition-all ${
                      selectedPeriod === d
                        ? "bg-neon-cyan/15 text-white/80 border border-neon-cyan/30"
                        : "text-white/80 hover:text-white/80 border border-transparent"
                    }`}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>

            {/* Chart */}
            {history && history.history.length > 0 ? (
              <PerformanceChart
                history={history.history}
                isPositive={history.totalPnl >= 0}
              />
            ) : (
              <div className="h-64 flex flex-col items-center justify-center text-white/50 font-mono text-sm border border-white/5 bg-white/[0.01]">
                <TrendingUp size={24} className="mb-2 opacity-20" />
                No trading data yet for this period
              </div>
            )}
          </div>
        </motion.section>

        {/*  DETAILED STATS GRID  */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4 }}
          className="mt-6"
        >
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {profile &&
              [
                {
                  label: "ROI",
                  value: `${profile.roi >= 0 ? "+" : ""}${profile.roi.toFixed(1)}%`,
                  icon: (
                    <div
                      className={`p-2 rounded-none ${
                        profile.roi >= 0
                          ? "bg-neon-green/10 text-neon-green"
                          : "bg-coral/10 text-coral"
                      }`}
                    >
                      {profile.roi >= 0 ? (
                        <TrendingUp size={18} />
                      ) : (
                        <TrendingDown size={18} />
                      )}
                    </div>
                  ),
                  extra: (
                    <div
                      className={`flex items-center gap-1 text-xs mt-1 ${
                        profile.roi >= 0 ? "text-neon-green" : "text-coral"
                      }`}
                    >
                      {profile.roi >= 0 ? (
                        <TrendingUp size={12} />
                      ) : (
                        <TrendingDown size={12} />
                      )}
                      {Math.abs(profile.roi).toFixed(1)}% return
                    </div>
                  ),
                  valueColor: profile.roi >= 0 ? "text-neon-green" : "text-coral",
                },
                {
                  label: "Win Rate",
                  value: `${profile.winRate.toFixed(1)}%`,
                  icon: (
                    <div className="relative">
                      <CircleProgress
                        value={profile.winRate}
                        color={
                          profile.winRate >= 60
                            ? "#39ff14"
                            : profile.winRate >= 45
                            ? "#ffae00"
                            : "#E86A56"
                        }
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <Target
                          size={16}
                          className={
                            profile.winRate >= 60
                              ? "text-neon-green"
                              : profile.winRate >= 45
                              ? "text-neon-orange"
                              : "text-coral"
                          }
                        />
                      </div>
                    </div>
                  ),
                  extra: (
                    <span className="text-[10px] text-white/40">
                      {profile.tradesExecuted} total trades
                    </span>
                  ),
                  valueColor: "text-white/80",
                },
                {
                  label: "Max Drawdown",
                  value: `${profile.maxDrawdown.toFixed(1)}%`,
                  icon: (
                    <div
                      className={`p-2 rounded-none ${
                        Math.abs(profile.maxDrawdown) > 20
                          ? "bg-red-500/10 text-white/80"
                          : Math.abs(profile.maxDrawdown) > 10
                          ? "bg-orange-500/10 text-orange-400"
                          : "bg-yellow-500/10 text-white/80"
                      }`}
                    >
                      <AlertTriangle size={18} />
                    </div>
                  ),
                  extra: (
                    <div className="w-full bg-white/[0.05] rounded-full h-1.5 mt-2">
                      <div
                        className={`h-full rounded-full ${
                          Math.abs(profile.maxDrawdown) > 20
                            ? "bg-red-500"
                            : Math.abs(profile.maxDrawdown) > 10
                            ? "bg-orange-500"
                            : "bg-yellow-500"
                        }`}
                        style={{
                          width: `${Math.min(Math.abs(profile.maxDrawdown), 50) * 2}%`,
                        }}
                      />
                    </div>
                  ),
                  valueColor:
                    Math.abs(profile.maxDrawdown) > 20
                      ? "text-white/80"
                      : Math.abs(profile.maxDrawdown) > 10
                      ? "text-orange-400"
                      : "text-white/80",
                },
                {
                  label: "Copied Capital",
                  value: `${formatNumber(profile.totalCopiedCapital)}`,
                  color: "purple",
                  icon: (
                    <div className="p-2 rounded-none bg-purple/10 text-white/80">
                      <DollarSign size={18} />
                    </div>
                  ),
                  extra: (
                    <span className="text-[10px] text-white/40">
                      Total capital managed (aUSD)
                    </span>
                  ),
                  valueColor: "text-white/80",
                },
                {
                  label: "Total Followers",
                  value: profile.totalFollowers.toString(),
                  icon: (
                    <div className="p-2 rounded-none bg-neon-cyan/10 text-white/80">
                      <Users size={18} />
                    </div>
                  ),
                  extra: (
                    <span className="text-[10px] text-white/40">
                      Active copy traders
                    </span>
                  ),
                  valueColor: "text-white/80",
                },
                {
                  label: "Days Active",
                  value: daysActive.toString(),
                  icon: (
                    <div className="p-2 rounded-none bg-neon-pink/10 text-neon-pink">
                      <Clock size={18} />
                    </div>
                  ),
                  extra: (
                    <span className="text-[10px] text-white/40">
                      Since{" "}
                      {new Date(profile.createdAt).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                        year: "numeric",
                      })}
                    </span>
                  ),
                  valueColor: "text-neon-pink",
                },
              ].map((card, i) => (
                <motion.div
                  key={card.label}
                  initial={{ opacity: 0, y: 15 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.06 }}
                  className="bg-[#050505] border border-[#00f0ff]/10 rounded-none p-4 hover:border-neon-cyan/20 transition-all duration-300 group"
                >
                  <div className="flex items-start justify-between mb-2">
                    <span className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                      {card.label}
                    </span>
                    {card.icon}
                  </div>
                  <div className={`text-2xl font-display font-bold ${card.valueColor}`}>
                    {card.value}
                  </div>
                  {card.extra}
                </motion.div>
              ))}
          </div>
        </motion.section>

        {/*  STRATEGIES LIST  */}
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6 }}
          className="mt-8"
        >
          <div className="flex items-center gap-3 mb-5">
            <Star size={18} className="text-neon-yellow" />
            <h2 className="font-display font-bold text-lg">Strategies</h2>
            <span className="text-xs font-mono text-white/80 bg-white/[0.03] px-2 py-0.5 rounded-full border border-white/[0.06]">
              {strategies.length}
            </span>
          </div>

          <div className="space-y-4">
            {strategies.map((s, i) => {
              const isFollowing = !!followerPositions[s.id];
              const position = followerPositions[s.id];
              const pnl = parseFloat(s.totalPnl);

              return (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -15 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.7 + i * 0.1 }}
                  className="bg-[#050505] border border-[#00f0ff]/10 rounded-none p-5 sm:p-6 hover:border-neon-cyan/25 transition-all duration-300 relative overflow-hidden group"
                >
                  {/* Subtle gradient accent on left */}
                  <div
                    className={`absolute left-0 top-0 bottom-0 w-1 ${
                      pnl >= 0
                        ? "bg-gradient-to-b from-neon-green to-neon-green/20"
                        : "bg-gradient-to-b from-coral to-coral/20"
                    }`}
                  />

                  <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                    {/* Strategy info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 mb-1">
                        <h3 className="font-display font-bold text-base text-white/80 group-hover:text-white/80 transition-colors">
                          {s.name}
                        </h3>
                        {isFollowing && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-neon-green/15 text-neon-green border border-neon-green/30">
                            <div className="w-1.5 h-1.5 rounded-full bg-neon-green animate-pulse" />
                            Following
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-white/80 mb-3 line-clamp-2">
                        {s.description}
                      </p>

                      {/* Metrics row */}
                      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
                        <div>
                          <span className="text-[10px] font-mono text-white/80 uppercase tracking-wider">
                            PnL
                          </span>
                          <div
                            className={`font-mono font-bold ${
                              pnl >= 0 ? "text-neon-green" : "text-coral"
                            }`}
                          >
                            {pnl >= 0 ? "+" : ""}
                            {formatNumber(pnl)} aUSD
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-white/80 uppercase tracking-wider">
                            ROI
                          </span>
                          <div
                            className={`font-mono font-bold ${
                              s.roi >= 0 ? "text-neon-green" : "text-coral"
                            }`}
                          >
                            {s.roi >= 0 ? "+" : ""}
                            {s.roi.toFixed(1)}%
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-white/80 uppercase tracking-wider">
                            Followers
                          </span>
                          <div className="font-bold text-white/80 flex items-center gap-1">
                            <Users size={12} className="text-white/80" />
                            {s.followerCount}
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-white/80 uppercase tracking-wider">
                            AUM
                          </span>
                          <div className="font-mono text-white/80 font-bold">
                            {formatNumber(parseFloat(s.totalFollowerCapital))} aUSD
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] font-mono text-white/80 uppercase tracking-wider">
                            Fee
                          </span>
                          <div className="font-mono text-neon-yellow font-bold">
                            {(s.performanceFeeBps / 100).toFixed(0)}%
                          </div>
                        </div>
                      </div>

                      {/* Follower position info */}
                      {isFollowing && position && (
                        <div className="mt-3 p-3 rounded-none bg-neon-green/[0.04] border border-neon-green/10">
                          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
                            <div>
                              <span className="text-white/80">Deposited</span>{" "}
                              <span className="font-mono text-white/80 font-bold">
                                {formatNumber(position.capitalDeposited)} aUSD
                              </span>
                            </div>
                            <div>
                              <span className="text-white/80">High Water Mark</span>{" "}
                              <span className="font-mono text-white/80 font-bold">
                                {formatNumber(position.highWaterMark)} aUSD
                              </span>
                            </div>
                            <div>
                              <span className="text-white/80">Since</span>{" "}
                              <span className="font-mono text-white/80">
                                {new Date(position.followedAt).toLocaleDateString()}
                              </span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Action button */}
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      {isFollowing ? (
                        <button
                          onClick={() =>
                            alert(
                              `Unfollow: call AuraSocialTrading.unfollow(${s.id})`
                            )
                          }
                          className="px-5 py-2.5 rounded-none border border-[#ff2a6d]/30 bg-[#ff2a6d]/10 text-[#ff2a6d] text-xs font-mono uppercase hover:bg-[#ff2a6d]/20 transition-colors"
                        >
                          Unfollow
                        </button>
                      ) : (
                        <button
                          onClick={() => openCopyTradeModal(s)}
                          disabled={!account}
                          className="px-5 py-2.5 rounded-none border border-[#00f0ff]/30 bg-[#00f0ff]/10 text-[#00f0ff] text-xs font-mono uppercase hover:bg-[#00f0ff]/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                          Follow
                        </button>
                      )}
                      <span className="text-[10px] text-white/40 font-mono">
                        ID #{s.id}
                      </span>
                    </div>
                  </div>
                </motion.div>
              );
            })}

            {strategies.length === 0 && (
              <div className="bg-[#050505] border border-[#00f0ff]/10 rounded-none p-12 flex flex-col items-center justify-center text-white/80 gap-3">
                <Star size={32} className="opacity-20" />
                <p className="font-mono text-sm">
                  No strategies published yet.
                </p>
              </div>
            )}
          </div>
        </motion.section>
      </main>

      {/*  COPY TRADING MODAL  */}
      <AnimatePresence>
        {showModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            {/* Backdrop */}
            <div
              className="absolute inset-0 bg-black/70 backdrop-blur-md"
              onClick={() => setShowModal(false)}
            />

            {/* Modal */}
            <motion.div
              initial={{ scale: 0.92, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.92, opacity: 0, y: 20 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="relative w-full max-w-lg bg-[#050505] border border-[#00f0ff]/10 rounded-none overflow-hidden"
            >
              {/*  HEADER  */}
              <div className="h-1 w-full bg-gradient-to-r from-neon-cyan via-neon-green to-neon-cyan" />

              <div className="p-6 sm:p-8">
                {/* Close button */}
                <button
                  onClick={() => setShowModal(false)}
                  className="absolute top-4 right-4 p-1.5 rounded-none text-white/80 hover:text-white/80 hover:bg-white/10 transition-all"
                >
                  <X size={18} />
                </button>

                {/* Title */}
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-none bg-neon-cyan/10">
                    <Zap size={18} className="text-white/80" />
                  </div>
                  <h2 className="text-xl font-display font-bold">Copy Trade</h2>
                </div>
                <p className="text-sm text-white/80 mb-6 pl-11">
                  Follow{" "}
                  <span className="text-white/80 font-semibold font-mono">
                    {shortAddr(address)}
                  </span>
                  's strategies
                </p>

                {/* Strategy selector */}
                <div className="mb-5">
                  <label className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-2 block">
                    Strategy
                  </label>
                  <div className="relative">
                    <select
                      value={modalStrategy?.id ?? "all"}
                      onChange={(e) => {
                        if (e.target.value === "all") {
                          setModalStrategy(null);
                        } else {
                          const s = strategies.find(
                            (s) => s.id === Number(e.target.value)
                          );
                          setModalStrategy(s || null);
                        }
                      }}
                      className="w-full appearance-none bg-white/[0.03] border border-[#00f0ff]/20 rounded-none px-4 py-3 text-sm text-white/80 focus:outline-none focus:border-neon-cyan/40 transition-colors cursor-pointer pr-10"
                    >
                      <option value="all" className="bg-cyber-dark">
                        All Strategies
                      </option>
                      {strategies.map((s) => (
                        <option
                          key={s.id}
                          value={s.id}
                          className="bg-cyber-dark"
                        >
                          {s.name} ({(s.performanceFeeBps / 100).toFixed(0)}% fee)
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={16}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 pointer-events-none"
                    />
                  </div>
                </div>

                {/* Amount input */}
                <div className="mb-5">
                  <div className="flex justify-between items-end mb-2">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-white/50 block">
                      Amount (aUSD)
                    </label>
                    <div className="text-[10px] font-mono text-white/80">
                      Balance:{" "}
                      {loadingBalance ? (
                        <span className="animate-pulse">...</span>
                      ) : (
                        <span className="text-white/80">
                          {parseFloat(ausdBalance).toFixed(2)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      min="0"
                      placeholder="Enter amount to allocate"
                      value={followAmount}
                      onChange={(e) => setFollowAmount(e.target.value)}
                      className="w-full bg-white/[0.03] border border-[#00f0ff]/20 rounded-none px-4 py-3 text-white/60 text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-neon-cyan/40 transition-colors"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                      <button
                        onClick={handleMaxClick}
                        className="text-[10px] bg-white/5 hover:bg-white/10 px-2 py-1 rounded text-white/80 font-bold transition-colors uppercase tracking-wider"
                      >
                        Max
                      </button>
                      <span className="text-xs text-white/80 font-mono pr-2">
                        aUSD
                      </span>
                    </div>
                  </div>
                </div>

                {/* Allocation slider */}
                <div className="mb-6">
                  <div className="flex items-center justify-between mb-2">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-white/50">
                      Portfolio Allocation
                    </label>
                    <span className="text-sm font-mono font-bold text-white/80">
                      {allocationPct}%
                    </span>
                  </div>
                  <div className="relative">
                    <input
                      type="range"
                      min={10}
                      max={100}
                      value={allocationPct}
                      onChange={(e) =>
                        setAllocationPct(Math.max(10, parseInt(e.target.value)))
                      }
                      className="w-full h-2 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, #00f0ff ${allocationPct}%, rgba(255,255,255,0.06) ${allocationPct}%)`,
                      }}
                    />
                    {/* Tick marks */}
                    <div className="flex justify-between mt-1 text-[9px] text-white/80 font-mono px-1">
                      <span>0%</span>
                      <span>25%</span>
                      <span>50%</span>
                      <span>75%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>

                {/* Fee breakdown */}
                <div className="bg-white/[0.02] rounded-none p-4 border border-white/[0.05] mb-5">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-white/50 mb-3">
                    Fee Breakdown
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-white/80">Performance Fee</span>
                      <span className="font-mono text-neon-yellow font-bold">
                        {modalStrategy
                          ? `${(modalStrategy.performanceFeeBps / 100).toFixed(
                              1
                            )}%`
                          : "varies"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/80">Your Investment</span>
                      <span className="font-mono text-white/80 font-bold">
                        {followAmount
                          ? `${parseFloat(followAmount).toFixed(2)} aUSD`
                          : ""}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/80">Allocation</span>
                      <span className="font-mono text-white/80 font-bold">
                        {allocationPct}% of portfolio
                      </span>
                    </div>
                    {followAmount && modalStrategy && (
                      <>
                        <div className="border-t border-white/[0.05] my-2" />
                        <div className="flex justify-between">
                          <span className="text-white/80">
                            Max Fee (on profit)
                          </span>
                          <span className="font-mono text-white/80 text-xs">
                            {(
                              (modalStrategy.performanceFeeBps / 10000) *
                              parseFloat(followAmount) *
                              0.3
                            ).toFixed(2)}{" "}
                            aUSD @ 30% gain
                          </span>
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* Risk warning */}
                <div className="flex items-start gap-3 p-3 rounded-none bg-neon-orange/[0.05] border border-neon-orange/15 mb-6">
                  <AlertTriangle
                    size={16}
                    className="text-neon-orange shrink-0 mt-0.5"
                  />
                  <p className="text-[11px] text-white/80 leading-relaxed">
                    <span className="text-neon-orange font-bold">Risk Warning:</span>{" "}
                    Past performance does not guarantee future results. Copy
                    trading involves risk of loss. You can unfollow and withdraw
                    your capital at any time.
                  </p>
                </div>

                {txError && (
                  <div className="mb-4 p-3 rounded-none border border-red-500/30 bg-red-500/10 text-white/80 text-xs text-center font-mono break-words">
                    {txError}
                  </div>
                )}

                {/* Action buttons */}
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowModal(false)}
                    disabled={txStatus !== "idle" && txStatus !== "error"}
                    className="flex-1 py-3 rounded-none border border-white/10 text-white/60 text-xs font-mono uppercase hover:bg-white/5 hover:text-white/80 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleConfirmFollow}
                    disabled={
                      !followAmount ||
                      parseFloat(followAmount) <= 0 ||
                      parseFloat(followAmount) > parseFloat(ausdBalance) ||
                      (txStatus !== "idle" && txStatus !== "error")
                    }
                    className="flex-1 py-3 rounded-none font-mono uppercase text-xs transition-colors bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    <span className="flex items-center justify-center gap-2">
                      {txStatus === "approving" && (
                        <>
                          <div className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
                          Approving aUSD...
                        </>
                      )}
                      {txStatus === "following" && (
                        <>
                          <div className="w-4 h-4 border-2 border-neon-cyan border-t-transparent rounded-full animate-spin" />
                          Confirming...
                        </>
                      )}
                      {txStatus === "done" && (
                        <>
                          <Zap size={16} />
                          Copied!
                        </>
                      )}
                      {(txStatus === "idle" || txStatus === "error") && (
                        <>
                          <Zap size={14} />
                          {parseFloat(followAmount) > parseFloat(ausdBalance)
                            ? "Insufficient Balance"
                            : "Confirm Copy Trade"}
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Range slider custom styles */}
      <style jsx>{`
        input[type="range"]::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #00f0ff;
          cursor: pointer;
          border: 2px solid #020204;
          box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
        }
        input[type="range"]::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: #00f0ff;
          cursor: pointer;
          border: 2px solid #020204;
          box-shadow: 0 0 10px rgba(0, 240, 255, 0.5);
        }
      `}</style>
    </div>
  );
}
