"use client";

import { useState, useEffect, useCallback } from "react";
import { Key, Copy, Check, AlertTriangle, Shield } from "lucide-react";
import { useActiveAccount, useSendTransaction } from "thirdweb/react";
import { getContract, prepareContractCall } from "thirdweb";
import { defineChain } from "thirdweb";
import { client } from "@/app/client";
import { API_URL } from "@/lib/config";

const MCP_SERVER_URL = process.env.NEXT_PUBLIC_MCP_URL || "https://mcp-serv-aura.up.railway.app";

const robinhoodChain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
});

interface McpKeyPanelProps {
  walletAddress?: string;
  auraAccountAddress?: string;
  agentOperatorAddress?: string;
}

export default function McpKeyPanel({ walletAddress, auraAccountAddress, agentOperatorAddress }: McpKeyPanelProps) {
  const account = useActiveAccount();
  const { mutate: sendTransaction } = useSendTransaction();
  const [hasKey, setHasKey] = useState(false);
  const [apiKeyPrefix, setApiKeyPrefix] = useState("");
  const [newApiKey, setNewApiKey] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState<"idle" | "signing" | "generating">("idle");
  const [paymentHash, setPaymentHash] = useState<string | null>(null);
  const [isPaying, setIsPaying] = useState(false);
  const [paymentCopied, setPaymentCopied] = useState(false);

  const AUSD_ADDRESS = "0x359961489f069F16E5dbA46d9b174bBF7b25147B";
  const TREASURY_ADDRESS = "0x4Ae6Ab5BCAb4F0f2FAcAA47aD2ea5832eBDF5792";
  const PAYMENT_AMOUNT = "1000000000000000000"; // 1 aUSD

  const fetchStatus = useCallback(async () => {
    if (!auraAccountAddress) return;
    try {
      const res = await fetch(`${API_URL}/api/mcp-keys?wallet=${auraAccountAddress}`);
      const data = await res.json();
      setHasKey(data.hasKey);
      setApiKeyPrefix(data.apiKeyPrefix || "");
    } catch { /* ignore */ }
  }, [auraAccountAddress]);

  useEffect(() => { fetchStatus(); }, [fetchStatus]);

  const handleAuthorize = async () => {
    if (!auraAccountAddress || !agentOperatorAddress || !account) return;
    setLoading(true); setError(""); setStep("signing");

    try {
      // Step 1: Sign setAiAgent tx to authorize the MCP agent
      const accContract = getContract({
        client,
        chain: robinhoodChain,
        address: auraAccountAddress,
        abi: [{
          inputs: [{ internalType: "address", name: "_aiAgent", type: "address" }],
          name: "setAiAgent",
          outputs: [],
          stateMutability: "nonpayable",
          type: "function"
        }] as const
      });

      const tx = prepareContractCall({
        contract: accContract,
        method: "setAiAgent",
        params: [agentOperatorAddress as `0x${string}`]
      });

      sendTransaction(tx, {
        onSuccess: async () => {
          setStep("generating");
          // Step 2: Generate API key linked to AuraAccount
          try {
            const res = await fetch(`${API_URL}/api/mcp-keys`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ auraAccountAddress, ownerWallet: walletAddress }),
            });
            const data = await res.json();
            if (!res.ok) { setError(data.error); return; }
            setNewApiKey(data.apiKey);
            setHasKey(true);
          } catch (e: any) { setError(e.message); }
          finally { setLoading(false); setStep("idle"); }
        },
        onError: (err) => {
          setError(`Transaction rejected: ${err.message}`);
          setLoading(false); setStep("idle");
        }
      });
    } catch (e: any) {
      setError(e.message);
      setLoading(false); setStep("idle");
    }
  };

  const handleRevoke = async () => {
    setLoading(true);
    try {
      await fetch(`${API_URL}/api/mcp-keys`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ wallet: auraAccountAddress }),
      });
      setHasKey(false); setNewApiKey(null); setApiKeyPrefix("");
    } catch { /* ignore */ }
    finally { setLoading(false); }
  };

  const copyKey = () => {
    if (newApiKey) { navigator.clipboard.writeText(newApiKey); setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const handleX402Payment = async () => {
    if (!account) return;
    setIsPaying(true);
    setError("");
    try {
      const ausdContract = getContract({
        client,
        chain: robinhoodChain,
        address: AUSD_ADDRESS,
        abi: [{
          inputs: [{ internalType: "address", name: "to", type: "address" }, { internalType: "uint256", name: "value", type: "uint256" }],
          name: "transfer",
          outputs: [{ internalType: "bool", name: "", type: "bool" }],
          stateMutability: "nonpayable",
          type: "function"
        }] as const
      });

      const tx = prepareContractCall({
        contract: ausdContract,
        method: "transfer",
        params: [TREASURY_ADDRESS, BigInt(PAYMENT_AMOUNT)]
      });

      sendTransaction(tx, {
        onSuccess: (receipt) => {
          setPaymentHash(receipt.transactionHash);
          setIsPaying(false);
        },
        onError: (err) => {
          setError(`Payment failed: ${err.message}`);
          setIsPaying(false);
        }
      });
    } catch (err: any) {
      setError(err.message);
      setIsPaying(false);
    }
  };

  const copyPaymentHash = () => {
    if (paymentHash) {
      navigator.clipboard.writeText(paymentHash);
      setPaymentCopied(true);
      setTimeout(() => setPaymentCopied(false), 2000);
    }
  };

  if (!walletAddress || !auraAccountAddress) return null;

  return (
    <div className="border border-[#00f0ff]/20 bg-[#050505] p-3 mt-2">
      <div className="flex items-center gap-2 mb-2">
        <Key className="w-3.5 h-3.5 text-[#00f0ff]" />
        <span className="text-[9px] font-bold uppercase tracking-widest text-[#00f0ff]">MCP Trading</span>
        <span className="text-[8px] text-white/30 ml-auto">Let any AI trade for you</span>
      </div>

      {newApiKey && (
        <div className="bg-[#00f0ff]/5 border border-[#00f0ff]/30 p-2 mb-2">
          <p className="text-[8px] text-[#00f0ff] uppercase tracking-widest mb-1 flex items-center gap-1">
            <AlertTriangle className="w-3 h-3" /> Save this key — shown only once
          </p>
          <div className="flex items-center gap-2 mb-2">
            <code className="text-[10px] text-white font-mono break-all flex-1">{newApiKey}</code>
            <button onClick={copyKey} className="p-1 border border-[#00f0ff]/30 hover:bg-[#00f0ff]/10 transition">
              {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-[#00f0ff]" />}
            </button>
          </div>
          <p className="text-[8px] text-white/40 mb-1">ChatGPT MCP URL:</p>
          <code className="text-[9px] text-white/60 font-mono block bg-black/50 p-1.5 break-all">{MCP_SERVER_URL}/sse</code>
        </div>
      )}

      {hasKey && !newApiKey && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-3 h-3 text-green-400" />
            <span className="text-[10px] text-green-400/80 font-mono">Agent authorized</span>
            <span className="text-[10px] text-white/40 font-mono">{apiKeyPrefix}</span>
          </div>
          <button onClick={handleRevoke} disabled={loading} className="text-[8px] px-2 py-0.5 text-red-400/70 border border-red-500/20 hover:border-red-500/50 hover:bg-red-500/10 transition uppercase tracking-widest">
            Revoke
          </button>
        </div>
      )}

      {!hasKey && !newApiKey && (
        <div>
          <p className="text-[8px] text-white/40 mb-2">Authorize the Aura AI Agent to trade on your behalf via your AuraAccount. No private key needed — you can revoke anytime.</p>
          <button onClick={handleAuthorize} disabled={loading || !agentOperatorAddress} className="w-full text-[9px] py-2 border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/10 transition uppercase tracking-widest font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            <Shield className="w-3 h-3" />
            {step === "signing" ? "Sign in wallet..." : step === "generating" ? "Generating key..." : "Authorize MCP Agent"}
          </button>
        </div>
      )}

      {error && <p className="text-[9px] text-red-400 mt-1">{error}</p>}

      {/* X402 Payment Section */}
      <div className="mt-4 pt-4 border-t border-[#00f0ff]/20">
        <div className="flex items-center gap-2 mb-2">
          <Shield className="w-3.5 h-3.5 text-[#00f0ff]" />
          <span className="text-[9px] font-bold uppercase tracking-widest text-[#00f0ff]">Premium Access (x402)</span>
        </div>
        <p className="text-[8px] text-white/40 mb-2">Pay 1 aUSD to access premium AI tools for this session.</p>
        
        {paymentHash ? (
          <div className="bg-green-500/5 border border-green-500/30 p-2 mb-2">
            <p className="text-[8px] text-green-400 uppercase tracking-widest mb-1 flex items-center gap-1">
              <Check className="w-3 h-3" /> Payment Successful
            </p>
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-white font-mono break-all flex-1">{paymentHash}</code>
              <button onClick={copyPaymentHash} className="p-1 border border-green-500/30 hover:bg-green-500/10 transition">
                {paymentCopied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-green-400" />}
              </button>
            </div>
            <p className="text-[8px] text-white/40 mt-1">Provide this hash (payment_tx_hash) to your AI agent.</p>
          </div>
        ) : (
          <button onClick={handleX402Payment} disabled={isPaying || !account} className="w-full text-[9px] py-2 border border-[#00f0ff]/30 text-[#00f0ff] hover:bg-[#00f0ff]/10 transition uppercase tracking-widest font-bold disabled:opacity-50 flex items-center justify-center gap-2">
            {isPaying ? "Sending Payment..." : "Pay 1 aUSD Access Fee"}
          </button>
        )}
      </div>
    </div>
  );
}
