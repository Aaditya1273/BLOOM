"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowLeft, Coins, ArrowDownToLine, ArrowUpFromLine, Loader2, Wallet, Layers } from "lucide-react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { client } from "../client";
import { createPublicClient, http, formatUnits, parseUnits, createWalletClient, custom } from "viem";
import { CONTRACT_ADDRESSES, AUSD_ABI, AURA_VAULT_ABI } from "../../lib/contracts";

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com") });

const CHAIN_CONFIG = {
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
} as any;

export default function PerpVaultPage() {
  const account = useActiveAccount();
  const [tvl, setTvl] = useState("0.00");
  const [userShares, setUserShares] = useState("0.00");
  const [ausdBalance, setAusdBalance] = useState("0.00");
  const [ausdRawBalance, setAusdRawBalance] = useState("0");
  const [userAssets, setUserAssets] = useState("0.00");
  const [userRawAssets, setUserRawAssets] = useState("0");
  const [isLoading, setIsLoading] = useState(true);

  const [tab, setTab] = useState<"deposit" | "withdraw">("deposit");
  const [amount, setAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [logMsg, setLogMsg] = useState("");

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      try {
        const addr = CONTRACT_ADDRESSES.AURA_VAULT as `0x${string}`;
        const total = await publicClient.readContract({ address: addr, abi: AURA_VAULT_ABI as any, functionName: "totalAssets" });
        
        if (active) {
          const totalAssets = Number(formatUnits(total as bigint, 18));
          setTvl(totalAssets.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
        }

        if (account?.address) {
          const [shares, bal] = await Promise.all([
            publicClient.readContract({ address: addr, abi: AURA_VAULT_ABI as any, functionName: "balanceOf", args: [account.address as `0x${string}`] }),
            publicClient.readContract({ address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "balanceOf", args: [account.address as `0x${string}`] }),
          ]);
          
          if (active) {
            const sharesNum = Number(formatUnits(shares as bigint, 18));
            const rawBal = formatUnits(bal as bigint, 18);
            
            setUserShares(sharesNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            setAusdRawBalance(rawBal);
            setAusdBalance(Number(rawBal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            
            if (sharesNum > 0) {
                // Approximate 1:1 for MVP if no complex math, or call a preview function.
                // Assuming 1 share = 1 aUSD for simplicity if no PnL applied yet.
                setUserAssets(sharesNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
                setUserRawAssets((shares as bigint).toString());
            } else {
                setUserAssets("0.00");
                setUserRawAssets("0");
            }
          }
        }
      } catch (e) { console.error("Perp Vault fetch error:", e); }
      if (active) setIsLoading(false);
    };
    
    fetchData();
    const iv = setInterval(fetchData, 5000);
    return () => { active = false; clearInterval(iv); };
  }, [account?.address]);

  const handleDeposit = async () => {
    if (!window.ethereum || !account?.address || !amount || Number(amount) <= 0) return;
    setIsProcessing(true);
    setLogMsg(`Initiating deposit of ${amount} aUSD...`);
    try {
      const wc = createWalletClient({ chain: CHAIN_CONFIG, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const amountWei = parseUnits(amount, 18);

      setLogMsg("Requesting aUSD approval for Perp Vault...");
      const approveTx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.AUSD as `0x${string}`,
        abi: AUSD_ABI as any,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.AURA_VAULT as `0x${string}`, amountWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      setLogMsg("Approval confirmed. Depositing into vault...");
      const depositTx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.AURA_VAULT as `0x${string}`,
        abi: AURA_VAULT_ABI as any,
        functionName: "deposit",
        args: [amountWei, account.address as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: depositTx });

      setLogMsg(`OK Deposited ${amount} aUSD. Shares minted. (Tx: ${depositTx.slice(0, 8)}...)`);
      setAmount("");
    } catch (e: any) {
      setLogMsg(`Deposit failed: ${e.message?.split("\n")[0]?.substring(0, 80) || "Unknown error"}`);
    }
    setIsProcessing(false);
  };

  const handleWithdraw = async () => {
    if (!window.ethereum || !account?.address || !amount || Number(amount) <= 0) return;
    setIsProcessing(true);
    setLogMsg(`Initiating withdrawal of ${amount} aUSD...`);
    try {
      const wc = createWalletClient({ chain: CHAIN_CONFIG, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const amountWei = parseUnits(amount, 18); // Note: we are passing assets, which is what the ERC4626 withdraw function takes.

      const withdrawTx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.AURA_VAULT as `0x${string}`,
        abi: AURA_VAULT_ABI as any,
        functionName: "withdraw",
        args: [amountWei, account.address as `0x${string}`, account.address as `0x${string}`],
      });
      await publicClient.waitForTransactionReceipt({ hash: withdrawTx });

      setLogMsg(`OK Withdrew ${amount} aUSD. Shares burned. (Tx: ${withdrawTx.slice(0, 8)}...)`);
      setAmount("");
    } catch (e: any) {
      setLogMsg(`Withdraw failed: ${e.message?.split("\n")[0]?.substring(0, 80) || "Unknown error"}`);
    }
    setIsProcessing(false);
  };

  const handleFaucet = async () => {
    if (!window.ethereum || !account?.address) return;
    setIsProcessing(true);
    try {
      const wc = createWalletClient({ chain: CHAIN_CONFIG, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "faucet", args: [] });
      await publicClient.waitForTransactionReceipt({ hash: tx });
      setLogMsg("OK Faucet: 1,000 aUSD minted to your wallet.");
    } catch (e: any) {
      setLogMsg(`Faucet failed: ${e.message?.split("\n")[0]?.substring(0, 50)}`);
    }
    setIsProcessing(false);
  };

  return (
    <div className="min-h-screen bg-[#050505] font-mono text-white selection:bg-[#00f0ff]/30 selection:text-[#00f0ff] relative overflow-hidden">
      <img src="/assets/fond_chat.png" className="fixed inset-0 w-full h-full object-cover opacity-40 pointer-events-none z-0" alt="" />
      {/* Header */}
      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] relative z-50">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-[#00f0ff] transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest">AURA</span>
          </Link>
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <Link href="/trade" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Trade</Link>
            <Link href="/portfolio" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Portfolio</Link>
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5">Earn Yield</span>
            <Link href="/social" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Copy Trade</Link>
            <Link href="/social/dashboard" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Dashboard</Link>
            <Link href="/trade/account" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Account</Link>
          </div>
        </div>
        <ConnectButton client={client} theme="dark" />
      </header>

      <main className="mx-auto max-w-4xl px-6 py-12 relative z-10">
        <div className="mb-8 bg-black/70 backdrop-blur-sm p-6 border border-[#00f0ff]/20">
          <Link href="/trade" className="group mb-8 inline-flex items-center gap-2 text-xs uppercase tracking-widest text-[#00f0ff]/60 transition hover:text-[#00f0ff]">
            <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-1" /> Return to Trading
          </Link>
          <div className="flex items-center gap-4">
            <Layers className="h-10 w-10 text-[#00f0ff]" />
            <div>
              <h1 className="text-4xl font-bold uppercase tracking-tight text-white drop-shadow-[0_0_15px_rgba(0,240,255,0.3)]">Perp Liquidity Pool</h1>
              <p className="mt-1 text-sm text-[#00f0ff]/60">Provide liquidity to the Aura Perpetual Exchange and earn market making yields.</p>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Stats Panel */}
          <div className="flex flex-col gap-4">
            <div className="border border-[#00f0ff]/30 bg-black/80 backdrop-blur-sm p-6">
              <p className="text-xs uppercase tracking-widest text-white/70 mb-2">Total Value Locked (aUSD)</p>
              <h2 className="text-3xl font-bold text-[#00f0ff]">{isLoading ? "---" : tvl}</h2>
            </div>
            
            <div className="border border-[#00f0ff]/30 bg-black/80 backdrop-blur-sm p-6">
              <p className="text-xs uppercase tracking-widest text-white/70 mb-2">Your Deposit (aUSD)</p>
              <h2 className="text-3xl font-bold text-white">{isLoading ? "---" : userAssets}</h2>
              <p className="mt-2 text-[10px] text-white/50 uppercase tracking-widest">Shares: {isLoading ? "---" : userShares}</p>
            </div>
          </div>

          {/* Action Panel */}
          <div className="border border-[#00f0ff] bg-black/80 backdrop-blur-sm">
            <div className="grid grid-cols-2 border-b border-[#00f0ff]/30 bg-[#050505]">
              {(["deposit", "withdraw"] as const).map((t) => {
                const isActive = tab === t;
                const Icon = t === "deposit" ? ArrowDownToLine : ArrowUpFromLine;
                return (
                  <button
                    key={t}
                    onClick={() => setTab(t)}
                    className={`flex items-center justify-center gap-2 rounded-none py-4 text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
                      isActive ? "border-[#00f0ff] bg-[#00f0ff]/10 text-[#00f0ff]" : "border-transparent text-white/40 hover:bg-[#00f0ff]/5 hover:text-[#00f0ff]/80"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {t}
                  </button>
                );
              })}
            </div>
            
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between text-xs">
                <span className="uppercase tracking-widest text-white/70">{tab === "deposit" ? "Available aUSD" : "Deposited aUSD"}</span>
                <button 
                  onClick={() => setAmount(tab === "deposit" ? ausdRawBalance : userRawAssets)}
                  className="font-bold text-[#00f0ff] hover:text-[#00f0ff]/70 border-b border-[#00f0ff]/50"
                >
                  {tab === "deposit" ? ausdBalance : userAssets}
                </button>
              </div>

              <div className="relative">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                  className="h-16 w-full border border-[#00f0ff]/50 bg-[#050505] px-4 pr-16 text-2xl font-bold text-[#00f0ff] placeholder:text-[#00f0ff]/20 focus:border-[#00f0ff] focus:outline-none"
                />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-[#00f0ff]/50">aUSD</span>
              </div>

              <div className="grid grid-cols-4 gap-2">
                {["100", "500", "1000"].map((v) => (
                  <button
                    key={v}
                    onClick={() => setAmount(v)}
                    className="border border-[#00f0ff]/30 bg-[#00f0ff]/5 py-2 text-[10px] font-bold text-[#00f0ff] transition hover:bg-[#00f0ff]/20"
                  >
                    +{v}
                  </button>
                ))}
                <button
                  onClick={() => setAmount(tab === "deposit" ? ausdRawBalance : userRawAssets)}
                  className="border border-[#00f0ff] bg-[#00f0ff]/20 py-2 text-[10px] font-bold text-[#00f0ff] transition hover:bg-[#00f0ff]/40"
                >
                  MAX
                </button>
              </div>

              <button
                onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
                disabled={isProcessing || !account?.address || !amount || Number(amount) <= 0}
                className={`h-14 w-full border font-bold uppercase tracking-[0.2em] transition-all disabled:opacity-35 ${
                  tab === "deposit" 
                    ? "border-[#00f0ff] bg-[#00f0ff]/10 text-[#00f0ff] hover:bg-[#00f0ff]/20" 
                    : "border-[#FF2A6D] bg-[#FF2A6D]/10 text-[#FF2A6D] hover:bg-[#FF2A6D]/20"
                }`}
              >
                {isProcessing ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> EXEC...
                  </span>
                ) : !account?.address ? (
                  "[ NO_WALLET ]"
                ) : (
                  `> ${tab.toUpperCase()}_${amount || "0"}_AUSD`
                )}
              </button>

              <button
                onClick={handleFaucet}
                disabled={isProcessing || !account?.address}
                className="flex h-10 w-full items-center justify-center gap-2 border border-dashed border-[#00f0ff]/30 text-[10px] text-[#00f0ff]/50 transition-all hover:border-[#00f0ff] hover:text-[#00f0ff] hover:bg-[#00f0ff]/10"
              >
                <Wallet className="h-3.5 w-3.5" /> [ REQUEST_FAUCET_MINT ]
              </button>
              
              {logMsg && (
                <div className="mt-4 border border-[#00f0ff]/20 bg-[#00f0ff]/5 p-3 text-[10px] text-[#00f0ff]">
                  &gt;_ {logMsg}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
