"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  Settings,
  X,
  TrendingUp,
  Activity,
  PlusSquare,
  RefreshCw,
  Wallet,
  Shield,
  Zap,
} from "lucide-react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain, prepareContractCall, sendTransaction, waitForReceipt, getContract } from "thirdweb";
import { client } from "../../client";
import { createPublicClient, http, formatEther, parseEther } from "viem";
import { CONTRACT_ADDRESSES, AURA_COPY_TRADING_V2_ABI, AUSD_ABI } from "../../../lib/contracts";
import CubeButton from "../../trade/CubeButton";

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

const publicClient = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com"),
});

type FollowerAllocation = {
  leader: string;
  isActive: boolean;
  capitalDeposited: number;
  capitalInPositions: number;
  highWaterMark: number;
  scaleFactor: number;
  maxSlippageBps: number;
  joinedAt: number;
};

export default function SocialDashboardPage() {
  const account = useActiveAccount();
  const [allocations, setAllocations] = useState<FollowerAllocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  // Modals state
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const [modalType, setModalType] = useState<"add" | "settings" | "unfollow" | null>(null);
  
  // Inputs
  const [amountInput, setAmountInput] = useState("");
  const [scaleFactorInput, setScaleFactorInput] = useState(25);
  const [slippageInput, setSlippageInput] = useState(50);
  
  // Tx State
  const [txStatus, setTxStatus] = useState<"idle" | "approving" | "confirming" | "done" | "error">("idle");
  const [txError, setTxError] = useState("");

  const fetchDashboard = useCallback(async () => {
    if (!account?.address) {
      setAllocations([]);
      setLoading(false);
      return;
    }
    try {
      setRefreshing(true);
      // Get all active leaders
      const result = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2 as `0x${string}`,
        abi: AURA_COPY_TRADING_V2_ABI as any,
        functionName: "getActiveLeaders",
        args: [0n, 100n],
      }) as [readonly `0x${string}`[], readonly any[]];

      const activeAddrs = result[0];
      
      if (activeAddrs.length === 0) {
        setAllocations([]);
        return;
      }

      // Fetch allocations for the current user for all these leaders using Promise.all
      const allocPromises = activeAddrs.map(addr => 
        publicClient.readContract({
          address: CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2 as `0x${string}`,
          abi: AURA_COPY_TRADING_V2_ABI as any,
          functionName: "allocations",
          args: [addr, account.address],
        })
      );

      const allocResults = await Promise.all(allocPromises);
      
      const activeAllocations: FollowerAllocation[] = [];
      allocResults.forEach((res, index) => {
        if (res) {
          const alloc = res as any;
          if (alloc[0]) { // isActive
            activeAllocations.push({
              leader: activeAddrs[index],
              isActive: alloc[0],
              capitalDeposited: Number(formatEther(alloc[1])),
              capitalInPositions: Number(formatEther(alloc[2])),
              highWaterMark: Number(formatEther(alloc[3])),
              scaleFactor: Number(alloc[4]),
              maxSlippageBps: Number(alloc[5]),
              joinedAt: Number(alloc[6]),
            });
          }
        }
      });

      setAllocations(activeAllocations);
    } catch (err) {
      console.error("Failed to fetch dashboard:", err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [account?.address]);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  const shortAddr = (a: string) => `${a.slice(0, 6)}...${a.slice(-4)}`;

  const openModal = (type: "add" | "settings" | "unfollow", leader: string, currentSF: number = 2500, currentSlip: number = 50) => {
    setModalType(type);
    setSelectedLeader(leader);
    setTxStatus("idle");
    setTxError("");
    setAmountInput("");
    if (type === "settings") {
      setScaleFactorInput(currentSF / 100);
      setSlippageInput(currentSlip);
    }
  };

  const closeModal = () => {
    setModalType(null);
    setSelectedLeader(null);
  };

  const executeAction = async () => {
    if (!account?.address || !selectedLeader) return;
    try {
      setTxError("");
      const contract = getContract({
        client,
        chain: robinhoodChain,
        address: CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2,
        abi: AURA_COPY_TRADING_V2_ABI as any,
      });

      if (modalType === "unfollow") {
        setTxStatus("confirming");
        const tx = prepareContractCall({
          contract,
          method: "unfollowLeader",
          params: [selectedLeader],
        });
        const res = await sendTransaction({ account, transaction: tx });
        await waitForReceipt({ client, chain: robinhoodChain, transactionHash: res.transactionHash });
        
      } else if (modalType === "add") {
        if (!amountInput || isNaN(Number(amountInput))) throw new Error("Invalid amount");
        const parsedAmount = parseEther(amountInput);
        
        const ausdContract = getContract({
          client,
          chain: robinhoodChain,
          address: CONTRACT_ADDRESSES.AUSD,
          abi: AUSD_ABI as any,
        });

        setTxStatus("approving");
        const approveTx = prepareContractCall({
          contract: ausdContract,
          method: "approve",
          params: [CONTRACT_ADDRESSES.AURA_COPY_TRADING_V2, parsedAmount],
        });
        const appRes = await sendTransaction({ account, transaction: approveTx });
        await waitForReceipt({ client, chain: robinhoodChain, transactionHash: appRes.transactionHash });

        setTxStatus("confirming");
        const tx = prepareContractCall({
          contract,
          method: "addCapital",
          params: [selectedLeader, parsedAmount],
        });
        const res = await sendTransaction({ account, transaction: tx });
        await waitForReceipt({ client, chain: robinhoodChain, transactionHash: res.transactionHash });

      } else if (modalType === "settings") {
        setTxStatus("confirming");
        const sf = BigInt(Math.floor(scaleFactorInput * 100));
        const slip = BigInt(slippageInput);
        const tx = prepareContractCall({
          contract,
          method: "updateFollowerParams",
          params: [selectedLeader, sf, slip],
        });
        const res = await sendTransaction({ account, transaction: tx });
        await waitForReceipt({ client, chain: robinhoodChain, transactionHash: res.transactionHash });
      }

      setTxStatus("done");
      setTimeout(() => {
        closeModal();
        fetchDashboard();
      }, 2000);
      
    } catch (err: any) {
      console.error(err);
      setTxError(err.message || "Transaction failed");
      setTxStatus("error");
    }
  };

  return (
    <div className="min-h-screen bg-cyber-black text-white relative overflow-x-hidden font-sans">
      {/* Background */}
      <img src="/assets/fond_social.png" className="fixed inset-0 z-0 h-full w-full object-cover opacity-30 pointer-events-none" alt="" />
      <div className="cyber-grid-bg fixed inset-0 z-0" />
      <div className="scanlines fixed inset-0 z-[1]" />
      <div className="noise-overlay fixed inset-0 z-[1]" />

      {/* HEADER */}
      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] relative z-50 font-mono">
        <div className="flex items-center gap-3">
          <Link href="/social" className="text-white/40 hover:text-white transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-[10px] font-bold uppercase tracking-widest">Back</span>
          </Link>
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <Link href="/trade" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Trade</Link>
            <Link href="/portfolio" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Portfolio</Link>
            <Link href="/perp-vault" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Earn Yield</Link>
            <Link href="/social" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Copy Trade</Link>
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5">Dashboard</span>
            <Link href="/trade/account" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Account</Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <motion.button
            onClick={fetchDashboard}
            disabled={refreshing}
            whileTap={{ scale: 0.92 }}
            className="p-1 rounded border border-white/10 hover:border-neon-cyan/30 hover:bg-neon-cyan/5 transition-all group"
          >
            <RefreshCw size={12} className={`transition-colors ${refreshing ? "animate-spin text-white" : "text-white group-hover:text-white"}`} />
          </motion.button>
          <ConnectButton client={client} wallets={wallets} chain={robinhoodChain} connectButton={{ label: "Connect", style: { fontSize: "10px", padding: "6px 12px", height: "28px" } }} />
        </div>
      </header>

      {/* CONTENT */}
      <main className="relative z-10 p-4 max-w-6xl mx-auto mt-6">
        <h1 className="text-3xl font-bold mb-8 text-white font-mono">
          Dashboard: Copy Trading
        </h1>

        {!account ? (
          <div className="text-center py-20 border border-white/5 rounded-xl bg-black/40 backdrop-blur-md">
            <Wallet className="w-12 h-12 text-white mx-auto mb-4" />
            <p className="text-white font-mono">Connect your wallet to view active copy trades.</p>
          </div>
        ) : loading ? (
          <div className="flex items-center justify-center py-20">
            <RefreshCw className="w-6 h-6 text-white animate-spin" />
          </div>
        ) : allocations.length === 0 ? (
          <div className="text-center py-20 border border-white/5 rounded-xl bg-black/40 backdrop-blur-md">
            <Activity className="w-12 h-12 text-white mx-auto mb-4" />
            <p className="text-white mb-4 font-mono">You are not following any leaders.</p>
            <Link href="/social" className="px-4 py-2 bg-neon-cyan/10 border border-neon-cyan/30 text-white rounded hover:bg-neon-cyan/20 transition text-sm font-mono font-bold">
              Explore Leaderboard
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6">
            <AnimatePresence>
              {allocations.map((alloc) => (
                <motion.div
                  key={alloc.leader}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="bg-[#0a0a0a] border border-white/10 rounded-xl p-6 backdrop-blur-md relative overflow-hidden flex flex-col md:flex-row justify-between items-center gap-6"
                >
                  <div className="absolute top-0 right-0 w-48 h-48 bg-neon-cyan/5 blur-3xl pointer-events-none" />
                  
                  <div className="flex-1 w-full">
                    <div className="text-xs text-white uppercase tracking-widest font-bold mb-2 flex items-center gap-1.5 font-mono">
                      <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan animate-pulse" />
                      Active Following
                    </div>
                    <Link href={`/social/trader/${alloc.leader}`} className="text-2xl font-bold text-white hover:text-white transition font-mono mb-4 block">
                      {shortAddr(alloc.leader)}
                    </Link>
                    
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4 font-mono">
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                        <div className="text-[10px] text-white uppercase tracking-widest mb-1">Deposited</div>
                        <div className="text-lg font-bold">${alloc.capitalDeposited.toFixed(2)}</div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                        <div className="text-[10px] text-white uppercase tracking-widest mb-1">In Positions</div>
                        <div className="text-lg font-bold">${alloc.capitalInPositions.toFixed(2)}</div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                        <div className="text-[10px] text-white uppercase tracking-widest flex items-center gap-1 mb-1">
                          <TrendingUp size={10} /> Scale Factor
                        </div>
                        <div className="text-lg font-bold">{(alloc.scaleFactor / 100).toFixed(0)}%</div>
                      </div>
                      <div className="bg-white/5 border border-white/10 rounded-lg p-3">
                        <div className="text-[10px] text-white uppercase tracking-widest flex items-center gap-1 mb-1">
                          <Shield size={10} /> Max Slippage
                        </div>
                        <div className="text-lg font-bold">{(alloc.maxSlippageBps / 100).toFixed(1)}%</div>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-3 w-full md:w-48 shrink-0">
                    <CubeButton
                      onClick={() => openModal("add", alloc.leader)}
                      color="#00f0ff"
                      className="!py-3 text-xs w-full"
                    >
                      <PlusSquare size={14} className="inline mr-1" /> Add Capital
                    </CubeButton>
                    <CubeButton
                      onClick={() => openModal("settings", alloc.leader, alloc.scaleFactor, alloc.maxSlippageBps)}
                      color="#9e9e9e"
                      className="!py-3 text-xs w-full"
                    >
                      <Settings size={14} className="inline mr-1" /> Settings
                    </CubeButton>
                    <CubeButton
                      onClick={() => openModal("unfollow", alloc.leader)}
                      color="#FF2A6D"
                      className="!py-3 text-xs w-full"
                    >
                      <X size={14} className="inline mr-1" /> Unfollow
                    </CubeButton>
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </main>

      {/* MODAL */}
      <AnimatePresence>
        {modalType && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 font-mono">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
              onClick={closeModal}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-md bg-[#050505] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
            >
              <div className="p-5 border-b border-white/10 flex justify-between items-center bg-white/[0.02]">
                <h2 className="text-sm font-bold uppercase tracking-widest text-white flex items-center gap-2">
                  {modalType === "add" && <><PlusSquare size={14} className="text-white" /> Add Capital</>}
                  {modalType === "settings" && <><Settings size={14} className="text-white" /> Update Params</>}
                  {modalType === "unfollow" && <><X size={14} className="text-white" /> Stop Following</>}
                </h2>
                <button onClick={closeModal} className="text-white hover:text-white transition"><X size={16} /></button>
              </div>

              <div className="p-6">
                {modalType === "unfollow" ? (
                  <p className="text-white text-sm mb-6">
                    Are you sure you want to stop following {selectedLeader ? shortAddr(selectedLeader) : ""}? Your deposited capital and any realized profits will remain in your balance, but you will no longer copy their trades.
                  </p>
                ) : modalType === "add" ? (
                  <div className="mb-6">
                    <label className="text-xs text-white uppercase tracking-widest mb-2 block">Amount to add (aUSD)</label>
                    <input
                      type="text"
                      placeholder="0.00"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-neon-cyan/50 font-mono"
                    />
                  </div>
                ) : (
                  <div className="space-y-6 mb-6">
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-xs text-white uppercase tracking-widest block">Scale Factor</label>
                        <span className="text-white font-bold">{scaleFactorInput}%</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="200"
                        value={scaleFactorInput}
                        onChange={(e) => setScaleFactorInput(Number(e.target.value))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none"
                      />
                      <p className="text-[10px] text-white mt-2">Adjust position sizes relative to the leader.</p>
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className="text-xs text-white uppercase tracking-widest block">Max Slippage (BPS)</label>
                        <span className="text-white font-bold">{slippageInput} bps</span>
                      </div>
                      <input
                        type="range"
                        min="10"
                        max="200"
                        value={slippageInput}
                        onChange={(e) => setSlippageInput(Number(e.target.value))}
                        className="w-full h-1 bg-white/10 rounded-full appearance-none"
                      />
                    </div>
                  </div>
                )}

                {txError && (
                  <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-white text-xs break-words">
                    {txError}
                  </div>
                )}

                <button
                  onClick={executeAction}
                  disabled={txStatus === "approving" || txStatus === "confirming" || txStatus === "done"}
                  className={`w-full py-3.5 rounded-xl font-bold transition-all relative overflow-hidden ${
                    txStatus === "done" ? "bg-green-500 text-white" :
                    modalType === "unfollow" ? "bg-red-500 hover:bg-red-600 text-white" :
                    "bg-neon-cyan hover:bg-neon-cyan/90 text-black"
                  }`}
                >
                  {txStatus === "approving" ? "Approving aUSD..." :
                   txStatus === "confirming" ? "Confirming..." :
                   txStatus === "done" ? "Success!" :
                   modalType === "unfollow" ? "Confirm Unfollow" : "Submit"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
