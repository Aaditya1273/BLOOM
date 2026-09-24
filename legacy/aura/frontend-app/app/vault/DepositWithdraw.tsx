"use client";

import { useState } from "react";
import { ArrowDownToLine, ArrowUpFromLine, Coins, Loader2, Wallet } from "lucide-react";
import { createWalletClient, custom, parseUnits } from "viem";
import { AUSD_ABI, CONTRACT_ADDRESSES, INTELLIGENCE_VAULT_ABI } from "../../lib/contracts";

const CHAIN_CONFIG = {
  id: 46630,
  name: "Robinhood Testnet",
  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
} as any;

interface Props {
  account: any;
  ausdBalance: string;
  ausdRawBalance: string;
  userAssets: string;
  userRawAssets: string;
  addLog: (agent: string, message: string, type: "analyst" | "risk" | "execution" | "guardrail" | "system") => void;
  publicClient: any;
}

type Tab = "deposit" | "withdraw";

export default function DepositWithdraw({ account, ausdBalance, ausdRawBalance, userAssets, userRawAssets, addLog, publicClient }: Props) {
  const [tab, setTab] = useState<Tab>("deposit");
  const [amount, setAmount] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const handleDeposit = async () => {
    if (!window.ethereum || !account?.address || !amount || Number(amount) <= 0) return;
    setIsProcessing(true);
    addLog("System", `Initiating deposit of ${amount} aUSD...`, "system");
    try {
      const wc = createWalletClient({ chain: CHAIN_CONFIG, account: account.address as `0x${string}`, transport: custom(window.ethereum) });
      const amountWei = parseUnits(amount, 18);

      addLog("System", "Requesting aUSD approval for Intelligence Vault...", "system");
      const approveTx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.AUSD as `0x${string}`,
        abi: AUSD_ABI as any,
        functionName: "approve",
        args: [CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`, amountWei],
      });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });

      addLog("System", "Approval confirmed. Depositing into vault...", "system");
      const depositTx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`,
        abi: INTELLIGENCE_VAULT_ABI as any,
        functionName: "deposit",
        args: [amountWei, account.address as `0x${string}`],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: depositTx });

      if (receipt.status === "reverted") {
        throw new Error("Deposit transaction reverted on-chain.");
      }

      addLog("Execution", `OK Deposited ${amount} aUSD. ivAUSD shares minted. (Tx: ${depositTx.slice(0, 8)}...)`, "execution");
      setAmount("");
    } catch (e: any) {
      const msg = e.message?.split("\n")[0]?.substring(0, 80) || "Unknown error";
      addLog("System", `Deposit failed: ${msg}`, "system");
    }
    setIsProcessing(false);
  };

  const handleWithdraw = async () => {
    if (!window.ethereum || !account?.address || !amount || Number(amount) <= 0) return;
    setIsProcessing(true);
    addLog("System", `Initiating withdrawal of ${amount} aUSD...`, "system");
    try {
      const wc = createWalletClient({ chain: CHAIN_CONFIG, account: account.address as `0x${string}`, transport: custom(window.ethereum) });
      const amountWei = parseUnits(amount, 18);

      const withdrawTx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.INTELLIGENCE_VAULT as `0x${string}`,
        abi: INTELLIGENCE_VAULT_ABI as any,
        functionName: "withdraw",
        args: [amountWei, account.address as `0x${string}`, account.address as `0x${string}`],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: withdrawTx });

      if (receipt.status === "reverted") {
        throw new Error("Transaction reverted on-chain (ERC4626ExceededMaxWithdraw or lack of idle capital).");
      }

      addLog("Execution", `OK Withdrew ${amount} aUSD. Shares burned. (Tx: ${withdrawTx.slice(0, 8)}...)`, "execution");
      setAmount("");
    } catch (e: any) {
      const msg = e.message?.split("\n")[0]?.substring(0, 80) || "Unknown error";
      if (msg.includes("ExposureExceeded")) addLog("Guardrail", "ExposureExceeded: capital is deployed. Wait for the AI rebalance.", "guardrail");
      else if (msg.includes("StylusGuardrailRejected")) addLog("Guardrail", "Stylus guardrail blocked this operation.", "guardrail");
      else addLog("System", `Withdraw failed: ${msg}`, "system");
    }
    setIsProcessing(false);
  };

  const handleFaucet = async () => {
    if (!window.ethereum || !account?.address) return;
    setIsProcessing(true);
    try {
      const wc = createWalletClient({ chain: CHAIN_CONFIG, account: account.address as `0x${string}`, transport: custom(window.ethereum) });
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "faucet", args: [] });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });

      if (receipt.status === "reverted") {
        throw new Error("Faucet transaction reverted on-chain.");
      }

      addLog("System", "OK Faucet: 1,000 aUSD minted to your wallet.", "system");
    } catch (e: any) {
      addLog("System", `Faucet failed: ${e.message?.split("\n")[0]?.substring(0, 50)}`, "system");
    }
    setIsProcessing(false);
  };

  const actionTone =
    tab === "deposit"
      ? "border-[#00f0ff] bg-[#00f0ff]/10 text-[#00f0ff] hover:bg-[#00f0ff]/20 hover:shadow-[0_0_15px_rgba(0,240,255,0.2)]"
      : "border-[#FF2A6D] bg-[#FF2A6D]/10 text-[#FF2A6D] hover:bg-[#FF2A6D]/20 hover:shadow-[0_0_15px_rgba(255,42,109,0.2)]";

  return (
    <div className="rounded-none border border-[#00f0ff] bg-[#0a0a0a]">
      <div className="flex items-center justify-between border-b border-[#00f0ff]/30 px-5 py-4 bg-[#050505]">
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-[#00f0ff]" />
          <span className="font-mono text-xs uppercase tracking-[0.2em] text-[#00f0ff]">CAPITAL_CONSOLE.exe</span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-widest text-[#00f0ff]/50">aUSD</span>
      </div>

      <div className="grid grid-cols-2 border-b border-[#00f0ff]/30 bg-[#050505]">
        {(["deposit", "withdraw"] as const).map((t) => {
          const isActive = tab === t;
          const Icon = t === "deposit" ? ArrowDownToLine : ArrowUpFromLine;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex items-center justify-center gap-2 rounded-none py-3 font-mono text-[10px] font-bold uppercase tracking-widest transition-all border-b-2 ${
                isActive ? "border-[#00f0ff] bg-[#00f0ff]/10 text-[#00f0ff]" : "border-transparent text-white/40 hover:bg-[#00f0ff]/5 hover:text-[#00f0ff]/80"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {t}
            </button>
          );
        })}
      </div>

<div className="space-y-4 p-5 bg-[#0a0a0a]">
          <div className="flex items-center justify-between text-[10px]">
            <span className="font-mono uppercase tracking-widest text-[#00f0ff]/50">
              &gt;_ SYS: {tab === "deposit" ? "AVAILABLE_AUSD" : "VAULT_ASSETS"}
            </span>
            <button 
              onClick={() => setAmount(tab === "deposit" ? ausdRawBalance : userRawAssets)} 
              className="font-mono font-bold text-[#00f0ff] transition hover:text-[#00f0ff]/70 border-b border-[#00f0ff]/50"
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
              className="h-14 w-full rounded-none border border-[#00f0ff] bg-[#050505] px-4 pr-16 font-mono text-xl font-bold text-[#00f0ff] placeholder:text-[#00f0ff]/20 transition-all focus:border-[#00f0ff] focus:outline-none focus:bg-[#0a0a0a]"
            />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 font-mono text-sm text-[#00f0ff]/40">aUSD</span>
          </div>
  
          <div className="grid grid-cols-4 gap-2">
            {["100", "500", "1000"].map((v) => (
              <button
                key={v}
                onClick={() => setAmount(v)}
                className="rounded-none border border-[#00f0ff]/50 bg-[#00f0ff]/5 py-2 font-mono text-[10px] font-bold text-[#00f0ff] transition hover:bg-[#00f0ff]/20"
              >
                +{v}
              </button>
            ))}
            <button
              onClick={() => setAmount(tab === "deposit" ? ausdRawBalance : userRawAssets)}
              className="rounded-none border border-[#00f0ff] bg-[#00f0ff]/20 py-2 font-mono text-[10px] font-bold text-[#00f0ff] transition hover:bg-[#00f0ff]/40 hover:shadow-[0_0_10px_rgba(0,240,255,0.3)]"
            >
              MAX
            </button>
          </div>
  
          <button
            onClick={tab === "deposit" ? handleDeposit : handleWithdraw}
            disabled={isProcessing || !account?.address || !amount || Number(amount) <= 0}
            className={`h-12 w-full rounded-none border font-mono text-sm font-bold uppercase tracking-[0.2em] transition-all disabled:cursor-not-allowed disabled:opacity-35 ${actionTone}`}
          >
            {isProcessing ? (
              <span className="flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                EXEC...
              </span>
            ) : !account?.address ? (
              "[ NO_WALLET ]"
            ) : tab === "deposit" ? (
              `> DEPOSIT_${amount || "0"}_AUSD`
            ) : (
              `> WITHDRAW_${amount || "0"}_AUSD`
            )}
          </button>
  
          <button
            onClick={handleFaucet}
            disabled={isProcessing || !account?.address}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-none border border-dashed border-[#00f0ff]/30 font-mono text-[10px] text-[#00f0ff]/50 bg-[#050505] transition-all hover:border-[#00f0ff] hover:text-[#00f0ff] hover:bg-[#00f0ff]/10 disabled:opacity-40"
          >
            <Wallet className="h-3.5 w-3.5" />
            [ REQUEST_FAUCET_MINT ]
        </button>
      </div>
    </div>
  );
}
