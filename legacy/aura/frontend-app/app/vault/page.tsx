"use client";

declare global { interface Window { ethereum?: any; } }

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowLeft, Brain, Shield, Zap, Activity, Lock, Cpu } from "lucide-react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain } from "thirdweb";
import { client } from "../client";
import { createPublicClient, http, formatUnits } from "viem";
import { CONTRACT_ADDRESSES, TOKENS, AUSD_ABI, INTELLIGENCE_VAULT_ABI } from "../../lib/contracts";
import VaultStats from "./VaultStats";
import AllocationChart, { AllocationData } from "./AllocationChart";
import DepositWithdraw from "./DepositWithdraw";
import NeuralFeed from "./NeuralFeed";
import { API_URL } from "../../lib/config";

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com") });

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

type NeuralLog = { id: number; time: string; agent: string; message: string; type: "analyst" | "risk" | "execution" | "guardrail" | "system"; };

export default function VaultPage() {
  const account = useActiveAccount();
  const [tvl, setTvl] = useState("0.00");
  const [userShares, setUserShares] = useState("0.00");
  const [userAssets, setUserAssets] = useState("0.00");
  const [userRawAssets, setUserRawAssets] = useState("0");
  const [ausdBalance, setAusdBalance] = useState("0.00");
  const [ausdRawBalance, setAusdRawBalance] = useState("0");
  const [utilization, setUtilization] = useState(0);
  const [maxRisk, setMaxRisk] = useState(70);
  const [strategyCount, setStrategyCount] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [neuralLogs, setNeuralLogs] = useState<NeuralLog[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [allocations, setAllocations] = useState<AllocationData[]>([]);
  const isAnalyzingRef = useRef(false);
  const hasAutoStarted = useRef(false);
  const autoAnalysisInterval = useRef<NodeJS.Timeout | null>(null);
  const AUTO_ANALYSIS_INTERVAL_MS = 20_000; // Re-run analysis every 20s (demo pace)

  const addLog = (agent: string, message: string, type: NeuralLog["type"], txHash?: string) => {
    setNeuralLogs(prev => [{ id: Date.now() + Math.random(), time: new Date().toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" }), agent, message, type, txHash }, ...prev].slice(0, 50));
  };

  const apy = (utilization * 0.15 + 5.2).toFixed(1);

  // Clear fake logs, start empty
  useEffect(() => {
    setNeuralLogs([]);
  }, []);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const addr = CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`;
        const [total, util, risk, nonce, paused] = await Promise.all([
          publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "totalAssets" }),
          publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "utilizationRateBps" }),
          publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "maxRiskScore" }),
          publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "strategyNonce" }),
          publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "paused" }),
        ]);
        if (active) {
          setTvl(Number(formatUnits(total as bigint, 18)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          setUtilization(Number(util) / 100);
          setMaxRisk(Number(risk));
          setStrategyCount(Number(nonce));
          setIsPaused(paused as boolean);
        }

        // Fetch dynamic allocations and real TVL
        try {
          // 1. Fetch prices
          const coinsRes = await fetch(`${API_URL}/api/coins`).then(r => r.json()).catch(() => ({}));
          const getPrice = (sym: string, fb: number) => (coinsRes[sym]?.currentPrice) || fb;
          const prices = {
            WETH: getPrice("ETH", 3100),
            TSLA: getPrice("TSLA", 175),
            AMZN: getPrice("AMZN", 180),
            BTC: getPrice("BTC", 67000),
          };

          // 2. Fetch balances
          const symbols = Object.keys(TOKENS);
          const balReqs = Object.values(TOKENS).map(tokenAddr => 
            publicClient.readContract({
              address: tokenAddr as `0x${string}`,
              abi: AUSD_ABI as any, // standard ERC20
              functionName: "balanceOf",
              args: [addr]
            }).catch(() => 0n)
          );
          const ausdBalReq = publicClient.readContract({
            address: CONTRACT_ADDRESSES.AUSD as `0x${string}`,
            abi: AUSD_ABI as any,
            functionName: "balanceOf",
            args: [addr]
          }).catch(() => 0n);

          const bals = await Promise.all([...balReqs, ausdBalReq]) as bigint[];
          const ausdBalNum = Number(formatUnits(bals[bals.length - 1], 18));

          // 3. Calculate allocations and real TVL
          let realTotalUsd = ausdBalNum;
          const newAllocations: AllocationData[] = [];
          const colors = ["#00f0ff", "#ff00a0", "#ffae00", "#f0e800", "#bd00ff", "#3b82f6", "#1FCB4F", "#E86A56"];
          const accents = ["bg-neon-cyan", "bg-neon-pink", "bg-neon-orange", "bg-neon-yellow", "bg-purple-500", "bg-blue-500", "bg-green-500", "bg-red-500"];

          symbols.forEach((sym, i) => {
            const balNum = Number(formatUnits(bals[i], 18));
            if (balNum > 0) {
              const usdValue = balNum * prices[sym as keyof typeof prices];
              realTotalUsd += usdValue;
            }
          });

          if (active) {
            setTvl(realTotalUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            // Utilization is just deployed / total
            if (realTotalUsd > 0) {
                setUtilization((realTotalUsd - ausdBalNum) / realTotalUsd);
            }
          }

          let totalDeployedPct = 0;
          if (realTotalUsd > 0) {
            symbols.forEach((sym, i) => {
              const balNum = Number(formatUnits(bals[i], 18));
              if (balNum > 0) {
                const usdValue = balNum * prices[sym as keyof typeof prices];
                const pct = (usdValue / realTotalUsd) * 100;
                totalDeployedPct += pct;
                newAllocations.push({
                  name: sym,
                  pct: Number(pct.toFixed(1)),
                  color: colors[i % colors.length],
                  accent: accents[i % accents.length]
                });
              }
            });

            // Add Idle aUSD
            const idlePct = Math.max(0, 100 - totalDeployedPct);
            newAllocations.unshift({
              name: "aUSD (Idle)",
              pct: Number(idlePct.toFixed(1)),
              color: "#39ff14",
              accent: "bg-neon-green"
            });

            if (active) setAllocations(newAllocations);
          } else {
            if (active) setAllocations([{ name: "aUSD (Idle)", pct: 100, color: "#39ff14", accent: "bg-neon-green" }]);
          }

          if (account?.address) {
            const [shares, bal, totalSupply] = await Promise.all([
              publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "balanceOf", args: [account.address as `0x${string}`] }),
              publicClient.readContract({ address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "balanceOf", args: [account.address as `0x${string}`] }),
              publicClient.readContract({ address: addr, abi: INTELLIGENCE_VAULT_ABI as any, functionName: "totalSupply" }),
            ]);
            if (active) {
              const sharesNum = Number(formatUnits(shares as bigint, 18));
              const rawBal = formatUnits(bal as bigint, 18);
              const supplyNum = Number(formatUnits(totalSupply as bigint, 18));
              
              setUserShares(sharesNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
              setAusdRawBalance(rawBal);
              setAusdBalance(Number(rawBal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
              
              if (sharesNum > 0 && supplyNum > 0) {
                const userAssetsValue = (sharesNum / supplyNum) * realTotalUsd;
                setUserAssets(userAssetsValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                setUserRawAssets((BigInt(shares as bigint) * BigInt(Math.floor(realTotalUsd * 1e18)) / BigInt(totalSupply as bigint)).toString());
              } else { 
                setUserAssets("0.00"); 
                setUserRawAssets("0");
              }
            }
          }
        } catch (e) { console.error("Vault dynamic fetch error:", e); }
      } catch (e) { console.error("Vault fetch error:", e); }
      if (active) setIsLoading(false);
    };
    fetchData();
    const iv = setInterval(fetchData, 5000);

    // Watch real on-chain events
    const unwatchExecution = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`,
      abi: INTELLIGENCE_VAULT_ABI as any,
      eventName: "StrategyExecuted",
      onLogs: (logs) => {
        logs.forEach(l => {
          const args = (l as any).args;
          addLog("Execution", `Strategy #${args.nonce} executed on ${String(args.target).slice(0, 6)}...${String(args.target).slice(-4)}. Risk: ${args.riskScore}/100.`, "execution");
        });
      }
    });

    const unwatchStylus = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`,
      abi: INTELLIGENCE_VAULT_ABI as any,
      eventName: "StrategyRejectedByStylus",
      onLogs: (logs) => {
        logs.forEach(l => {
          const args = (l as any).args;
          addLog("Guardrail", `Stylus WASM validation FAILED for strategy #${args.nonce}. Reason: ${args.reason}`, "guardrail");
        });
      }
    });

    const unwatchDeploy = publicClient.watchContractEvent({
      address: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`,
      abi: INTELLIGENCE_VAULT_ABI as any,
      eventName: "CapitalDeployed",
      onLogs: (logs) => {
        logs.forEach(l => {
          const args = (l as any).args;
          addLog("System", `Capital Deployed: ${formatUnits(args.amount as bigint, 18)} aUSD to protocol ${String(args.protocol).slice(0, 6)}...`, "system");
        });
      }
    });

    return () => {
      active = false;
      clearInterval(iv);
      unwatchExecution();
      unwatchStylus();
      unwatchDeploy();
    };
  }, [account?.address]);

  const handleAnalyze = useCallback(async () => {
    // Prevent overlapping runs
    if (isAnalyzingRef.current) return;
    isAnalyzingRef.current = true;
    setIsAnalyzing(true);
    addLog("System", "Triggering multi-agent strategy analysis...", "system");
    try {
      const res = await fetch(`${API_URL}/api/vault/analyze`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ vaultAddress: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT }) });
      const data = await res.json();
      if (data.proposal) addLog("Analyst Agent", `Strategy: ${data.proposal.action}. ${data.proposal.reasoning}`, "analyst");
      if (data.riskAssessment) addLog("Risk Officer", `${data.riskAssessment.approved ? "APPROVED" : "REJECTED"} - Risk: ${data.riskAssessment.riskScore}/100. ${data.riskAssessment.rationale}`, "risk");
      if (data.encodedStrategies?.length > 0) {
        [...data.encodedStrategies].reverse().forEach((s: any) => addLog("Execution", `Ready: ${s.description}`, "execution"));
        addLog("System", "Executing strategies on-chain via Agent Wallet...", "system");
        try {
          const execRes = await fetch(`${API_URL}/api/vault/execute`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ vaultAddress: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT, strategies: data.encodedStrategies })
          });
          const execData = await execRes.json();
          if (execData.status === "executed") {
            addLog("System", `Execution completed. ${execData.results?.length || 0} TX(s) submitted to Robinhood Chain.`, "system");
            execData.results?.forEach((res: any) => {
              if (res.success && res.txHash) {
                addLog("Execution", `Success! Strategy executed and confirmed.`, "execution", res.txHash);
              }
            });
          } else {
            addLog("System", `Execution error: ${execData.message}`, "system");
          }
        } catch (execErr: any) {
          addLog("System", `Execution request failed: ${execErr.message}`, "system");
        }
      } else if (data.status === "hold") {
        addLog("System", "Strategy: HOLD - No action needed at this time.", "system");
      }
    } catch (e: any) { addLog("System", `Analysis failed: ${e.message}`, "system"); }
    isAnalyzingRef.current = false;
    setIsAnalyzing(false);
  }, []);

  // ── Auto-start analysis on mount & repeat every 60s ──────────
  useEffect(() => {
    if (hasAutoStarted.current) return;
    hasAutoStarted.current = true;

    // Delay the first auto-run to let vault data load
    const initialTimeout = setTimeout(() => {
      handleAnalyze();

      // Set up recurring interval
      autoAnalysisInterval.current = setInterval(() => {
        handleAnalyze();
      }, AUTO_ANALYSIS_INTERVAL_MS);
    }, 3000);

    return () => {
      clearTimeout(initialTimeout);
      if (autoAnalysisInterval.current) clearInterval(autoAnalysisInterval.current);
    };
  }, [handleAnalyze]);

  return (
    <div className="min-h-screen bg-cyber-black text-white font-body selection:bg-neon-cyan selection:text-cyber-black relative overflow-hidden">
      <img
        src="/assets/fond_vault.jpg"
        alt=""
        className="fixed inset-0 z-0 h-full w-full object-cover opacity-20 pointer-events-none"
      />
      <div className="cyber-grid-bg relative z-0" />
      <div className="japanese-pattern relative z-0" />
      <div className="scanlines relative z-10" />
      <div className="noise-overlay relative z-10" />

      <div className="fixed left-5 top-24 z-20 hidden xl:flex flex-col gap-8 opacity-20 pointer-events-none">
        <div className="text-vertical font-kanji text-4xl cyber-glow-cyan">知能金庫</div>
        <div className="text-vertical font-kanji text-2xl cyber-glow-pink">安全運用</div>
      </div>
      <div className="fixed right-5 top-24 z-20 hidden xl:flex flex-col gap-8 opacity-20 pointer-events-none">
        <div className="text-vertical font-kanji text-4xl cyber-glow-green">自律管理</div>
        <div className="text-vertical font-kanji text-2xl cyber-glow-cyan">資産防衛</div>
      </div>

      <header className="sticky top-0 z-50 border-b border-[#00f0ff] bg-[#050505] shadow-[-10px_0_30px_rgba(0,240,255,0.05)]">
        <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex min-w-0 items-center gap-4">
            <Link href="/" className="group flex items-center gap-2 text-[#00f0ff]/60 transition hover:text-[#00f0ff]">
              <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" />
              <span className="font-mono text-xs font-bold uppercase tracking-widest">AURA</span>
            </Link>
            <div className="hidden h-7 w-px bg-[#00f0ff]/30 sm:block" />
            <div className="flex min-w-0 items-center gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-mono text-base font-bold uppercase tracking-[0.2em] text-[#00f0ff]">&gt;_ Intelligence Vault</span>
                  <span className="hidden font-mono text-[10px] text-[#00f0ff]/50 sm:inline">[ SYS.ACTIVE ]</span>
                </div>
                <span className="hidden font-mono text-[9px] uppercase tracking-widest text-[#00f0ff]/40 sm:block">Robinhood Chain // Arbitrum Orbit</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2 md:gap-3">
            {isPaused && (
              <span className="hidden items-center gap-1.5 border border-[#FF2A6D] bg-[#FF2A6D]/10 px-3 py-1.5 font-mono text-[10px] font-bold uppercase tracking-widest text-[#FF2A6D] sm:flex rounded-none">
                <Lock className="h-3 w-3" />
                Paused
              </span>
            )}
            <div className="hidden items-center gap-2 border border-[#00f0ff] bg-[#00f0ff]/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff] md:flex rounded-none">
              <span className="h-2 w-2 rounded-none bg-[#00f0ff] animate-pulse" />
              Stylus Active
            </div>
            <div className="origin-right scale-90">
              <ConnectButton client={client} theme="dark" wallets={wallets} chain={robinhoodChain} />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 mx-auto max-w-[1440px] px-4 py-8 md:px-6 lg:py-10">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="mb-8 grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end"
        >
          <div className="relative">
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <span className="font-mono text-xs uppercase tracking-[0.25em] text-[#00f0ff]">Autonomous Treasury //_</span>
              <span className="border border-[#00f0ff] bg-[#00f0ff]/10 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff] rounded-none">AI Managed</span>
            </div>
            <h1 className="font-mono text-[clamp(2rem,5vw,4.5rem)] font-bold uppercase leading-[1] text-[#00f0ff] tracking-widest">
              Vault_Command
            </h1>
            <p className="mt-5 max-w-3xl font-mono text-xs uppercase leading-6 text-[#00f0ff]/60 tracking-wider">
              &gt; ivAUSD treasury state, risk limits and agent execution telemetry in one live control room.
            </p>
            <div className="mt-6 grid gap-3 sm:grid-cols-3">
              {[
                { label: "Capital Guard", value: "Stylus WASM", icon: Shield, tone: "text-[#00f0ff] border-[#00f0ff] bg-[#00f0ff]/10" },
                { label: "Strategy Core", value: `${strategyCount} runs`, icon: Brain, tone: "text-[#00f0ff] border-[#00f0ff] bg-[#00f0ff]/10" },
                { label: "Risk Ceiling", value: `${maxRisk}/100`, icon: Zap, tone: "text-[#00f0ff] border-[#00f0ff] bg-[#00f0ff]/10" },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.label} className={`rounded-none border border-[#00f0ff] bg-[#050505] relative overflow-hidden group p-4`}>
                    <div className={`absolute left-0 top-0 bottom-0 w-1 ${item.tone.split(' ')[2]}`} />
                    <div className="flex items-center justify-between gap-3">
                      <Icon className={`h-4 w-4 ${item.tone.split(' ')[0]}`} />
                      <span className="font-mono text-[10px] text-[#00f0ff]/40">SYS.CHK</span>
                    </div>
                    <div className={`mt-4 font-mono text-lg font-bold tracking-widest ${item.tone.split(' ')[0]}`}>{item.value}</div>
                    <div className="mt-2 font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/60 border-t border-[#00f0ff]/20 pt-2">{item.label}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-none border border-[#00f0ff] bg-[#050505] p-5">
            <div className="mb-5 flex items-center justify-between border-b border-[#00f0ff]/30 pb-4">
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4 text-[#00f0ff]" />
                <span className="font-mono text-xs uppercase tracking-widest text-[#00f0ff]">Ops Monitor</span>
              </div>
              <span className="font-mono text-[10px] uppercase text-[#00f0ff]/50">SYS.MON</span>
            </div>
            <div className="space-y-4 font-mono">
              {[
                { label: "TVL", value: `$${tvl}`, accent: "text-[#00f0ff]" },
                { label: "Projected APY", value: `${apy}%`, accent: "text-[#00f0ff]" },
                { label: "Utilization", value: `${utilization.toFixed(1)}%`, accent: "text-[#00f0ff]" },
                { label: "State", value: isPaused ? "PAUSED" : "LIVE", accent: isPaused ? "text-[#FF2A6D]" : "text-[#00f0ff]" },
              ].map((row) => (
                <div key={row.label} className="flex items-center justify-between gap-4">
                  <span className="text-[10px] uppercase tracking-widest text-[#00f0ff]/60">{row.label}</span>
                  <span className={`text-sm font-bold ${row.accent}`}>{isLoading && row.label !== "State" ? "--" : row.value}</span>
                </div>
              ))}
            </div>
            <div className="mt-5 h-px bg-[#00f0ff]/20" />
            <div className="mt-4 flex items-center justify-between text-[10px] font-mono uppercase tracking-widest text-[#00f0ff]/50">
              <span className="flex items-center gap-2"><Activity className="h-3 w-3 text-[#00f0ff]" /> Live Audit</span>
              <span>ivAUSD</span>
            </div>
          </div>
        </motion.section>

        <motion.div initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1 }}>
          <VaultStats tvl={tvl} utilization={utilization} maxRisk={maxRisk} strategyCount={strategyCount} userShares={userShares} userAssets={userAssets} isLoading={isLoading} apy={apy} />
        </motion.div>

        <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-3">
          <motion.div className="space-y-6 lg:col-span-1" initial={{ opacity: 0, x: -18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.2 }}>
            <AllocationChart utilization={utilization} allocations={allocations.length > 0 ? allocations : undefined} />
            <DepositWithdraw
              account={account}
              ausdBalance={ausdBalance}
              ausdRawBalance={ausdRawBalance}
              userAssets={userAssets}
              userRawAssets={userRawAssets}
              addLog={addLog}
              publicClient={publicClient}
            />
          </motion.div>

          <motion.div className="lg:col-span-2" initial={{ opacity: 0, x: 18 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 }}>
            <NeuralFeed logs={neuralLogs} onAnalyze={handleAnalyze} isAnalyzing={isAnalyzing} />
          </motion.div>
        </div>
      </main>
    </div>
  );
}
