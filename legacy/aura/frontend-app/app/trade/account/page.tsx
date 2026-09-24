"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { ArrowLeft, Wallet, Send, Download, Droplets, Copy, Check, Shield } from "lucide-react";
import { useActiveAccount, ConnectButton } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { defineChain } from "thirdweb";
import { client } from "@/app/client";
import { createPublicClient, http, formatUnits, createWalletClient, custom, parseUnits } from "viem";
import { CONTRACT_ADDRESSES, AUSD_ABI } from "@/lib/contracts";

const publicClient = createPublicClient({ transport: http("https://rpc.testnet.chain.robinhood.com") });
const robinhoodChain = defineChain({ id: 46630, name: "Robinhood Chain Testnet", rpc: "https://rpc.testnet.chain.robinhood.com", nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 }, blockExplorers: [{ name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" }] });
const wallets = [createWallet("io.metamask"), createWallet("com.coinbase.wallet"), createWallet("me.rainbow")];
const FACTORY = "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550";

const AURA_DAO_ADDRESS = "0xC8fF29922564556aAEE591e7BCa11667F71FeD32";
const DAO_ABI = [
  { inputs: [{ name: "agent", type: "address" }], name: "isAgentKYA", outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "agent", type: "address" }], name: "certifyAgent", outputs: [], stateMutability: "nonpayable", type: "function" }
];

export default function AccountPage() {
  const account = useActiveAccount();
  const [auraAccount, setAuraAccount] = useState("");
  const [eoaBalance, setEoaBalance] = useState("0");
  const [accountBalance, setAccountBalance] = useState("0");
  const [eoaEth, setEoaEth] = useState("0");
  const [accountEth, setAccountEth] = useState("0");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [depositAmount, setDepositAmount] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const [withdrawToken, setWithdrawToken] = useState("AUSD");
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [tokenBalance, setTokenBalance] = useState("0");
  const [aiAgent, setAiAgent] = useState("");
  const [isKYA, setIsKYA] = useState(false);

  const refresh = useCallback(async () => {
    if (!account?.address) return;
    try {
      const acct = await publicClient.readContract({ address: FACTORY as `0x${string}`, abi: [{ inputs: [{ type: "address" }], name: "getAccount", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }], functionName: "getAccount", args: [account.address as `0x${string}`] }) as string;
      if (acct && acct !== "0x0000000000000000000000000000000000000000") setAuraAccount(acct);

      const [eoaBal, acctBal, eoaE, acctE] = await Promise.all([
        publicClient.readContract({ address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "balanceOf", args: [account.address as `0x${string}`] }),
        acct && acct !== "0x0000000000000000000000000000000000000000" ? publicClient.readContract({ address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "balanceOf", args: [acct as `0x${string}`] }) : 0n,
        publicClient.getBalance({ address: account.address as `0x${string}` }),
        acct && acct !== "0x0000000000000000000000000000000000000000" ? publicClient.getBalance({ address: acct as `0x${string}` }) : 0n,
      ]);
      
      let aiAgentAddr = "";
      let kyaStatus = false;
      if (acct && acct !== "0x0000000000000000000000000000000000000000") {
        try {
          aiAgentAddr = await publicClient.readContract({ address: acct as `0x${string}`, abi: [{ inputs: [], name: "aiAgent", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }], functionName: "aiAgent" }) as string;
          if (aiAgentAddr && aiAgentAddr !== "0x0000000000000000000000000000000000000000") {
            kyaStatus = await publicClient.readContract({ address: AURA_DAO_ADDRESS as `0x${string}`, abi: DAO_ABI, functionName: "isAgentKYA", args: [aiAgentAddr as `0x${string}`] }) as boolean;
          }
        } catch(e) {}
      }

      setEoaBalance(Number(formatUnits(eoaBal as bigint, 18)).toFixed(2));
      setAccountBalance(Number(formatUnits(acctBal as bigint, 18)).toFixed(2));
      setEoaEth(Number(formatUnits(eoaE as bigint, 18)).toFixed(4));
      setAccountEth(Number(formatUnits(acctE as bigint, 18)).toFixed(4));
      setAiAgent(aiAgentAddr);
      setIsKYA(kyaStatus);
    } catch {}
  }, [account?.address]);

  useEffect(() => { refresh(); const i = setInterval(refresh, 10000); return () => clearInterval(i); }, [refresh]);

  const getWc = () => createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account!.address as `0x${string}`, transport: custom(window.ethereum as any) });

  const handleMint = async () => {
    setLoading(true); setStatus("");
    try {
      const wc = getWc();
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "faucet", args: [] });
      setStatus(`Minted 1000 aUSD! TX: ${tx.slice(0, 10)}...`);
      setTimeout(refresh, 3000);
    } catch (e: any) { setStatus(`Mint failed: ${e.message.slice(0, 60)}`); }
    setLoading(false);
  };

  const handleDeposit = async () => {
    if (!depositAmount || !auraAccount) return;
    setLoading(true); setStatus("");
    try {
      const wc = getWc();
      const amount = parseUnits(depositAmount, 18);
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "transfer", args: [auraAccount as `0x${string}`, amount] });
      setStatus(`Deposited ${depositAmount} aUSD to AuraAccount! TX: ${tx.slice(0, 10)}...`);
      setDepositAmount("");
      setTimeout(refresh, 3000);
    } catch (e: any) { setStatus(`Deposit failed: ${e.message.slice(0, 60)}`); }
    setLoading(false);
  };

  const handleTransferBack = async () => {
    if (!transferAmount || !auraAccount) return;
    setLoading(true); setStatus("");
    try {
      const wc = getWc();
      const amount = parseUnits(transferAmount, 18);
      // Call executeBatch on AuraAccount to transfer aUSD back to EOA
      const transferData = `0xa9059cbb${account!.address.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
      const tx = await wc.writeContract({ chain: null, address: auraAccount as `0x${string}`, abi: [{ inputs: [{ name: "dest", type: "address[]" }, { name: "value", type: "uint256[]" }, { name: "func", type: "bytes[]" }], name: "executeBatch", outputs: [], stateMutability: "nonpayable", type: "function" }] as any, functionName: "executeBatch", args: [[CONTRACT_ADDRESSES.AUSD], [0n], [transferData]] });
      setStatus(`Withdrawn ${transferAmount} aUSD! TX: ${tx.slice(0, 10)}...`);
      setTransferAmount("");
      setTimeout(refresh, 3000);
    } catch (e: any) { setStatus(`Withdraw failed: ${e.message.slice(0, 60)}`); }
    setLoading(false);
  };

  const copyAddress = () => { navigator.clipboard.writeText(auraAccount); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  const handleCertify = async () => {
    if (!aiAgent || aiAgent === "0x0000000000000000000000000000000000000000") {
      setStatus("No AI Agent authorized yet. Go to Trade to authorize first.");
      return;
    }
    setLoading(true); setStatus("");
    try {
      const wc = getWc();
      const tx = await wc.writeContract({ chain: null, address: AURA_DAO_ADDRESS as `0x${string}`, abi: DAO_ABI as any, functionName: "certifyAgent", args: [aiAgent as `0x${string}`] });
      setStatus(`Agent certified! TX: ${tx.slice(0, 10)}...`);
      setTimeout(refresh, 3000);
    } catch (e: any) { setStatus(`Certification failed: ${e.message.slice(0, 60)}`); }
    setLoading(false);
  };

  const TOKEN_MAP: Record<string, string> = { AUSD: CONTRACT_ADDRESSES.AUSD, TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E", AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02", NFLX: "0x3b8262A63d25f0477c4DDE23F83cfe22Cb768C93", AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d", PLTR: "0x1FBE1a0e43594b3455993B5dE5Fd0A7A266298d0" };

  useEffect(() => {
    if (!auraAccount || !withdrawToken) return;
    const addr = TOKEN_MAP[withdrawToken];
    if (!addr) return;
    publicClient.readContract({ address: addr as `0x${string}`, abi: AUSD_ABI as any, functionName: "balanceOf", args: [auraAccount as `0x${string}`] })
      .then((bal: any) => setTokenBalance(Number(formatUnits(bal as bigint, 18)).toFixed(4)))
      .catch(() => setTokenBalance("0"));
  }, [withdrawToken, auraAccount, status]);

  const handleWithdrawToken = async () => {
    if (!withdrawAmount || !auraAccount) return;
    setLoading(true); setStatus("");
    try {
      const wc = getWc();
      const tokenAddr = TOKEN_MAP[withdrawToken];
      const amount = parseUnits(withdrawAmount, 18);
      const transferData = `0xa9059cbb${account!.address.slice(2).padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`;
      const tx = await wc.writeContract({ chain: null, address: auraAccount as `0x${string}`, abi: [{ inputs: [{ name: "dest", type: "address[]" }, { name: "value", type: "uint256[]" }, { name: "func", type: "bytes[]" }], name: "executeBatch", outputs: [], stateMutability: "nonpayable", type: "function" }] as any, functionName: "executeBatch", args: [[tokenAddr], [0n], [transferData]] });
      setStatus(`Withdrawn ${withdrawAmount} ${withdrawToken}! TX: ${tx.slice(0, 10)}...`);
      setWithdrawAmount("");
      setTimeout(refresh, 3000);
    } catch (e: any) { setStatus(`Withdraw failed: ${e.message.slice(0, 60)}`); }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#020204] text-white font-mono relative overflow-hidden">
      <img src="/assets/fond_chat.png" className="fixed inset-0 w-full h-full object-cover opacity-40 pointer-events-none z-0" alt="" />
      <div className="cyber-grid-bg fixed inset-0 z-0" />
      <div className="scanlines fixed inset-0 z-[1]" />
      <div className="noise-overlay fixed inset-0 z-[1]" />

      <header className="h-[48px] border-b border-[#00f0ff]/30 flex items-center justify-between px-4 bg-[#050505] relative z-50">
        <div className="flex items-center gap-3">
          <Link href="/" className="text-white/40 hover:text-[#00f0ff] transition flex items-center gap-1.5">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="font-mono text-[10px] font-bold uppercase tracking-widest">AURA</span>
          </Link>
          <div className="border-l border-[#00f0ff]/20 pl-3 ml-1 flex items-center gap-3">
            <Link href="/trade" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Trade</Link>
            <Link href="/portfolio" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Portfolio</Link>
            <Link href="/perp-vault" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Earn Yield</Link>
            <Link href="/social" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Copy Trade</Link>
            <Link href="/social/dashboard" className="text-[9px] text-white/30 hover:text-[#00f0ff] font-bold uppercase tracking-widest transition">Dashboard</Link>
            <span className="text-[9px] text-[#00f0ff] font-bold uppercase tracking-widest bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5">Account</span>
          </div>
        </div>
        <div className="scale-90 origin-right"><ConnectButton client={client} theme="dark" wallets={wallets} chain={robinhoodChain} /></div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 py-8 space-y-6">
        {!account?.address ? (
          <div className="text-center py-20 text-white/30 text-sm">Connect your wallet to manage your AuraAccount</div>
        ) : !auraAccount ? (
          <div className="text-center py-20 space-y-4">
            <p className="text-white/30 text-sm">No AuraAccount found for this wallet.</p>
            <button
              onClick={async () => {
                setLoading(true); setStatus("");
                try {
                  const wc = getWc();
                  const tx = await wc.writeContract({ chain: null, address: FACTORY as `0x${string}`, abi: [{ inputs: [{ type: "address", name: "owner" }], name: "createAccount", outputs: [{ type: "address" }], stateMutability: "payable", type: "function" }] as any, functionName: "createAccount", args: [account.address as `0x${string}`], value: 0n });
                  setStatus(`AuraAccount deployed! TX: ${tx.slice(0, 10)}...`);
                  setTimeout(refresh, 3000);
                } catch (e: any) { setStatus(`Deploy failed: ${e.message?.slice(0, 60)}`); }
                setLoading(false);
              }}
              disabled={loading}
              className="px-6 py-3 bg-[#00f0ff]/10 border border-[#00f0ff] text-[#00f0ff] text-xs font-bold uppercase tracking-widest hover:bg-[#00f0ff]/20 transition disabled:opacity-50"
            >
              {loading ? "Deploying..." : "Deploy AuraAccount"}
            </button>
            {status && (
              <div className={`p-3 border text-[10px] font-mono ${status.includes("failed") ? "border-red-500/30 text-red-400 bg-red-500/5" : "border-[#00f0ff]/30 text-[#00f0ff] bg-[#00f0ff]/5"}`}>
                {status}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Account Info */}
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-5">
              <div className="flex items-center gap-2 mb-4">
                <Wallet className="w-4 h-4 text-[#00f0ff]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00f0ff]">AuraAccount</span>
                
                {aiAgent && aiAgent !== "0x0000000000000000000000000000000000000000" && (
                  <div className="ml-auto flex items-center gap-2">
                    {isKYA ? (
                      <span className="px-2 py-1 bg-green-500/10 border border-green-500/30 text-green-400 text-[8px] font-bold uppercase tracking-widest flex items-center gap-1">
                        <Check className="w-3 h-3" /> Agent KYA Verified
                      </span>
                    ) : (
                      <button onClick={handleCertify} disabled={loading} className="px-2 py-1 bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-[8px] font-bold uppercase tracking-widest hover:bg-yellow-500/20 transition flex items-center gap-1 disabled:opacity-50">
                        <Shield className="w-3 h-3" /> Certify Agent
                      </button>
                    )}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 mb-4">
                <code className="text-[11px] text-white/70 font-mono">{auraAccount}</code>
                <button onClick={copyAddress} className="p-1 hover:bg-[#00f0ff]/10 transition">
                  {copied ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3 text-[#00f0ff]" />}
                </button>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-[#050505] border border-[#00f0ff]/10 p-3">
                  <p className="text-[8px] text-white/30 uppercase tracking-widest mb-1">EOA Wallet</p>
                  <p className="text-lg font-bold text-white">{eoaBalance} <span className="text-[10px] text-[#00f0ff]">aUSD</span></p>
                  <p className="text-[10px] text-white/30">{eoaEth} ETH</p>
                </div>
                <div className="bg-[#050505] border border-[#00f0ff]/10 p-3">
                  <p className="text-[8px] text-white/30 uppercase tracking-widest mb-1">AuraAccount</p>
                  <p className="text-lg font-bold text-[#00f0ff]">{accountBalance} <span className="text-[10px] text-[#00f0ff]">aUSD</span></p>
                  <p className="text-[10px] text-white/30">{accountEth} ETH</p>
                </div>
              </div>
            </div>

            {/* Mint Faucet */}
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Droplets className="w-4 h-4 text-[#00f0ff]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00f0ff]">Testnet Faucet</span>
              </div>
              <p className="text-[9px] text-white/40 mb-3">Mint 1000 aUSD testnet tokens to your EOA wallet</p>
              <button onClick={handleMint} disabled={loading} className="w-full py-2.5 bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] text-[10px] font-bold uppercase tracking-widest hover:bg-[#00f0ff]/20 transition disabled:opacity-50">
                {loading ? "..." : "Mint 1000 aUSD"}
              </button>
            </div>

            {/* Deposit to AuraAccount */}
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Download className="w-4 h-4 text-[#00f0ff]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00f0ff]">Deposit to AuraAccount</span>
              </div>
              <p className="text-[9px] text-white/40 mb-3">Transfer aUSD from your EOA to your AuraAccount for MCP trading</p>
              <div className="flex gap-2">
                <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} placeholder="Amount (aUSD)" className="flex-1 bg-[#050505] border border-[#00f0ff]/20 px-3 py-2 text-[11px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-[#00f0ff]" />
                <button onClick={handleDeposit} disabled={loading || !depositAmount} className="px-4 py-2 bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] text-[9px] font-bold uppercase tracking-widest hover:bg-[#00f0ff]/20 transition disabled:opacity-50">
                  Deposit
                </button>
              </div>
            </div>

            {/* Withdraw from AuraAccount */}
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Send className="w-4 h-4 text-[#00f0ff]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00f0ff]">Withdraw from AuraAccount</span>
              </div>
              <p className="text-[9px] text-white/40 mb-3">Transfer aUSD back from your AuraAccount to your EOA</p>
              <div className="flex gap-2">
                <input type="number" value={transferAmount} onChange={e => setTransferAmount(e.target.value)} placeholder="Amount (aUSD)" className="flex-1 bg-[#050505] border border-[#00f0ff]/20 px-3 py-2 text-[11px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-[#00f0ff]" />
                <button onClick={handleTransferBack} disabled={loading || !transferAmount} className="px-4 py-2 bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] text-[9px] font-bold uppercase tracking-widest hover:bg-[#00f0ff]/20 transition disabled:opacity-50">
                  Withdraw
                </button>
              </div>
            </div>

            {/* Withdraw Any Token */}
            <div className="bg-[#0a0a0a] border border-[#00f0ff]/20 p-5">
              <div className="flex items-center gap-2 mb-3">
                <Send className="w-4 h-4 text-[#00f0ff]" />
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#00f0ff]">Withdraw Tokens</span>
              </div>
              <p className="text-[9px] text-white/40 mb-3">Transfer any token (TSLA, AMZN, NFLX, AMD, PLTR) from AuraAccount to your EOA</p>
              <div className="flex gap-2">
                <select value={withdrawToken} onChange={e => setWithdrawToken(e.target.value)} className="bg-[#050505] border border-[#00f0ff]/20 px-2 py-2 text-[11px] font-mono text-[#00f0ff] focus:outline-none focus:border-[#00f0ff]">
                  {Object.keys(TOKEN_MAP).map(t => <option key={t} value={t}>{t}</option>)}
                </select>
                <input type="number" value={withdrawAmount} onChange={e => setWithdrawAmount(e.target.value)} placeholder="Amount" className="flex-1 bg-[#050505] border border-[#00f0ff]/20 px-3 py-2 text-[11px] font-mono text-white placeholder:text-white/20 focus:outline-none focus:border-[#00f0ff]" />
                <button onClick={handleWithdrawToken} disabled={loading || !withdrawAmount} className="px-4 py-2 bg-[#00f0ff]/10 border border-[#00f0ff]/30 text-[#00f0ff] text-[9px] font-bold uppercase tracking-widest hover:bg-[#00f0ff]/20 transition disabled:opacity-50">
                  Withdraw
                </button>
              </div>
              <p className="text-[9px] text-white/30 mt-2">Available: <span className="text-[#00f0ff]">{tokenBalance} {withdrawToken}</span>
                <button onClick={() => setWithdrawAmount((parseFloat(tokenBalance) * 0.25).toFixed(4))} className="ml-2 px-1.5 py-0.5 text-[8px] border border-[#00f0ff]/20 text-[#00f0ff]/60 hover:bg-[#00f0ff]/10">25%</button>
                <button onClick={() => setWithdrawAmount((parseFloat(tokenBalance) * 0.5).toFixed(4))} className="ml-1 px-1.5 py-0.5 text-[8px] border border-[#00f0ff]/20 text-[#00f0ff]/60 hover:bg-[#00f0ff]/10">50%</button>
                <button onClick={() => setWithdrawAmount(tokenBalance)} className="ml-1 px-1.5 py-0.5 text-[8px] border border-[#00f0ff]/20 text-[#00f0ff]/60 hover:bg-[#00f0ff]/10">MAX</button>
              </p>
            </div>

            {status && (
              <div className={`p-3 border text-[10px] font-mono ${status.includes("failed") ? "border-red-500/30 text-red-400 bg-red-500/5" : "border-[#00f0ff]/30 text-[#00f0ff] bg-[#00f0ff]/5"}`}>
                {status}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
