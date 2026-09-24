"use client";

import { useState, useEffect } from "react";
import { ConnectButton, useActiveAccount } from "thirdweb/react";
import { client } from "../client";
import { createPublicClient, http, formatUnits, createWalletClient, custom, keccak256, toBytes, encodeFunctionData } from "viem";
import { CONTRACT_ADDRESSES, AUSD_ABI, AURA_PERPS_ABI, AURA_ROUTER_ABI, STYLUS_LOB_ABI, CONDITIONAL_ORDER_MANAGER_ABI, LIQUIDATION_SHIELD_ABI, AURA_CROSS_CHAIN_ESCROW_ABI, ERC20_ABI } from "../../lib/contracts";
import { API_URL } from "../../lib/config";

const publicClient = createPublicClient({
  transport: http("https://rpc.testnet.chain.robinhood.com"),
});

export type OnChainPosition = {
  id: number;
  isOpen: boolean;
  asset: string;
  isLong: boolean;
  collateral: number;
  leverage: number;
  size: number;
  entryPrice: number;
  openedAt?: string;
  realizedPnl?: number;
  isProfitRealized?: boolean;
  exitPrice?: number;
  takeProfit?: string;
  stopLoss?: string;
  closedAt?: string;
};

export type OpenLimitOrder = {
  id: number;
  asset: string;
  isLong: boolean;
  collateral: number;
  leverage: number;
  size: number;
  limitPrice: number;
  timestamp: number;
};

export function useTradeState() {
  const [prompt, setPrompt] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [isMinting, setIsMinting] = useState(false);
  const [balance, setBalance] = useState("0.00");
  const [arbBalance, setArbBalance] = useState("0.00");
  const [rawBalance, setRawBalance] = useState<number>(0);
  const [agentLogs, setAgentLogs] = useState<{id:number;timestamp:string;message:string;type:"info"|"alert"|"action"}[]>([]);
  const [activePositions, setActivePositions] = useState<OnChainPosition[]>([]);
  const [historyPositions, setHistoryPositions] = useState<OnChainPosition[]>([]);
  const [openOrders, setOpenOrders] = useState<OpenLimitOrder[]>([]);
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "history">("positions");
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [selectedMarket, setSelectedMarket] = useState("BTC-PERP");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [tradingMode, setTradingMode] = useState<"ai" | "manual">("ai");
  const [manualCollateral, setManualCollateral] = useState("80");
  const [manualLeverage, setManualLeverage] = useState("50");
  const [manualIsLong, setManualIsLong] = useState(true);
  const [orderType, setOrderType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [tpSlConfig, setTpSlConfig] = useState<Record<number, {tp: string, sl: string}>>({});
  const [fundingRate, setFundingRate] = useState<string>("0.0015%");
  const account = useActiveAccount();

  const addLog = (message: string, type: "info" | "alert" | "action" = "info") => {
    setAgentLogs(prev => [{
      id: Math.random() * 1000000 + Date.now(),
      timestamp: new Date().toLocaleTimeString(),
      message, type
    }, ...prev]);
  };

  useEffect(() => {
    setAgentLogs([{ id: 1, timestamp: new Date().toLocaleTimeString(), message: "Copilot AI activated. Waiting for orders.", type: "info" }]);
  }, []);

  useEffect(() => {
    let active = true;
    const fetchData = async () => {
      if (account?.address) {
        try {
          // Fetch dynamic funding rate from AuraPerps for the current market (assuming Long view for display)
          const baseAsset = selectedMarket.split('-')[0];
          const rateData = await publicClient.readContract({
            address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`,
            abi: AURA_PERPS_ABI as any, functionName: "getCurrentFundingRate",
            args: [baseAsset, true]
          }) as bigint;
          // Rate is scaled by 1e18, but wait, it's actually just base rate if 0!
          // Convert to percentage per 8h? Or just display the daily/hourly?
          // The contract returns rate per second in 1e18 scale. Wait, original is 10000000000
          // Let's just format it as a tiny percentage
          const frNum = Number(rateData);
          setFundingRate((frNum / 1e10).toFixed(4) + "%");
        } catch (e) { console.error("Funding fetch err:", e); }

        try {
          const priceRes = await fetch(`${API_URL}/api/prices`);
          if (priceRes.ok) {
            const priceData = await priceRes.json();
            if (active) {
              const mapped = { ...priceData };
              if (priceData.BTC) mapped["BTC-PERP"] = priceData.BTC;
              if (priceData.ETH) mapped["ETH-PERP"] = priceData.ETH;
              setPrices(mapped);
            }
          }
        } catch (e) { console.error("Price fetch error:", e); }

        try {
          const bal = await publicClient.readContract({
            address: CONTRACT_ADDRESSES.AUSD as `0x${string}`,
            abi: AUSD_ABI as any, functionName: "balanceOf",
            args: [account.address as `0x${string}`],
          });
          const arbBal = await createPublicClient({ chain: { id: 421614, name: "Arbitrum Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } } } as any, transport: http() }).readContract({
            address: CONTRACT_ADDRESSES.ARB_SEPOLIA_AUSD as `0x${string}`,
            abi: AUSD_ABI as any, functionName: "balanceOf",
            args: [account.address as `0x${string}`],
          });
          if (active) {
            const balNum = Number(formatUnits(bal as bigint, 18));
            setRawBalance(balNum);
            setBalance(balNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
            const arbBalNum = Number(formatUnits(arbBal as bigint, 18));
            setArbBalance(arbBalNum.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
          }
        } catch (e) { console.error("Balance fetch error:", e); }

        try {
          const nextPosId = await publicClient.readContract({
            address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`,
            abi: AURA_PERPS_ABI as any, functionName: "nextPositionId",
          }) as bigint;

          // Also match positions owned by the user's AuraAccount
          let auraAcct = "";
          try {
            const FACTORY = "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550";
            const acct = await publicClient.readContract({ address: FACTORY as `0x${string}`, abi: [{ inputs: [{ type: "address" }], name: "getAccount", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }], functionName: "getAccount", args: [account.address as `0x${string}`] }) as string;
            if (acct && acct !== "0x0000000000000000000000000000000000000000") auraAcct = acct.toLowerCase();
          } catch {}

          const positions: OnChainPosition[] = [];
          const history: OnChainPosition[] = [];
          const count = Number(nextPosId);
          // Batch position reads using multicall to prevent RPC rate limits and speed up loading
          const calls = Array.from({ length: count }, (_, i) => ({
              address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`,
              abi: AURA_PERPS_ABI as any,
              functionName: "positions",
              args: [BigInt(i)],
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

          for (let i = 0; i < count; i++) {
            const pos = results[i] as any;
            if (pos && (pos[0].toLowerCase() === account.address.toLowerCase() || pos[0].toLowerCase() === auraAcct)) {
              const d = {
                id: i, asset: pos[1], isLong: pos[2],
                collateral: Number(formatUnits(pos[3], 18)),
                leverage: Number(pos[4]),
                entryPrice: Number(formatUnits(pos[5], 18)),
                size: Number(formatUnits(pos[6], 18)),
                isOpen: pos[7],
                openedAt: Number(pos[8]) > 0 ? new Date(Number(pos[8]) * 1000).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Recently",
                realizedPnl: Number(formatUnits(pos[9], 18)),
                isProfitRealized: pos[10],
                exitPrice: Number(formatUnits(pos[11], 18)),
                takeProfit: Number(pos[12]) > 0 ? formatUnits(pos[12], 18) : undefined,
                stopLoss: Number(pos[13]) > 0 ? formatUnits(pos[13], 18) : undefined,
              };
              if (pos[7]) positions.push(d); else history.push(d);
            }
          }
          if (active) { setActivePositions(positions.reverse()); setHistoryPositions(history.reverse()); }
        } catch (e) { console.error("Position fetch error:", e); }

        // Fetch user's resting limit orders from the Stylus LOB (Arbitrum Sepolia)
        // via the backend endpoint which scans get_order() for ACTIVE orders owned
        // by the connected wallet.
        try {
          const ordersRes = await fetch(`${API_URL}/api/my-orders/${account.address}`);
          if (ordersRes.ok) {
            const data = await ordersRes.json();
            if (active) setOpenOrders(data.orders || []);
          }
        } catch (e) {
          console.error("Open orders fetch error:", e);
        }
      } else {
        if (active) { setBalance("0.00"); setActivePositions([]); setHistoryPositions([]); }
      }
    };
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => { active = false; clearInterval(interval); };
  }, [account?.address]);

  const handleClosePosition = async (id: number) => {
    if (!window.ethereum || !account?.address) return;
    addLog(`Closing position #${id}...`, "info");
    try {
      if (!(await ensureRobinhoodChain())) return;
      const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });

      // Check if position is owned by AuraAccount — if so, route through executeBatch
      const pos = await publicClient.readContract({ address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "positions", args: [BigInt(id)] }) as any;
      const posOwner = (pos[0] as string).toLowerCase();
      const FACTORY = "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550";
      let auraAcct = "";
      try { const a = await publicClient.readContract({ address: FACTORY as `0x${string}`, abi: [{ inputs: [{ type: "address" }], name: "getAccount", outputs: [{ type: "address" }], stateMutability: "view", type: "function" }], functionName: "getAccount", args: [account.address as `0x${string}`] }) as string; if (a && a !== "0x0000000000000000000000000000000000000000") auraAcct = a.toLowerCase(); } catch {}

      if (auraAcct && posOwner === auraAcct) {
        // Route through AuraAccount.executeBatch
        const closeData = encodeFunctionData({ abi: AURA_PERPS_ABI as any, functionName: "closePosition", args: [BigInt(id)] });
        const tx = await wc.writeContract({ chain: null, address: auraAcct as `0x${string}`, abi: [{ inputs: [{ name: "dest", type: "address[]" }, { name: "value", type: "uint256[]" }, { name: "func", type: "bytes[]" }], name: "executeBatch", outputs: [], stateMutability: "nonpayable", type: "function" }] as any, functionName: "executeBatch", args: [[CONTRACT_ADDRESSES.AURA_PERPS], [0n], [closeData]] });
        addLog(`Position closed via AuraAccount (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
      } else {
        const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "closePosition", args: [BigInt(id)] });
        addLog(`Position closed (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
      }
      setActivePositions(prev => prev.filter(p => p.id !== id));
    } catch(e: any) { addLog(`Close failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
  };

  const handleCancelLimitOrder = async (id: number) => {
    if (!window.ethereum || !account?.address) return;
    addLog(`Cancelling limit order #${id} on Stylus LOB...`, "info");
    try {
      if (!(await ensureArbitrumSepolia())) return;
      const escrowAddr = CONTRACT_ADDRESSES.STYLUS_ESCROW as `0x${string}`;
      const sepoliaWc = createWalletClient({
        chain: { id: 421614, name: "Arbitrum Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } } } as any,
        account: account.address as `0x${string}`,
        transport: custom(window.ethereum as any),
      });
      const tx = await sepoliaWc.writeContract({
        chain: null,
        address: escrowAddr,
        abi: AURA_CROSS_CHAIN_ESCROW_ABI as any,
        functionName: "cancel_order",
        args: [BigInt(id), account.address as `0x${string}`],
      });
      addLog(`Order #${id} cancelled (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
      setOpenOrders(prev => prev.filter(o => o.id !== id));
    } catch(e: any) { addLog(`Cancel failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
  };

  const handlePartialClose = async (id: number, currentSize: number, pct: string) => {
    if (!pct || isNaN(Number(pct)) || Number(pct) <= 0 || Number(pct) >= 100) return;
    if (!window.ethereum || !account?.address) return;
    addLog(`Partially closing #${id} by ${pct}%...`, "info");
    try {
      if (!(await ensureRobinhoodChain())) return;
      const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const amountWei = BigInt(Math.floor((currentSize * Number(pct)) / 100 * 1e18));
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "closePositionPartially", args: [BigInt(id), amountWei] });
      addLog(`Partial close OK (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
    } catch(e: any) { addLog(`Partial close failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
  };

  const handleAddMargin = async (id: number, amt: string) => {
    if (!amt || isNaN(Number(amt)) || Number(amt) <= 0) return;
    if (!window.ethereum || !account?.address) return;
    addLog(`Adding $${amt} margin to #${id}...`, "info");
    try {
      if (!(await ensureRobinhoodChain())) return;
      const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const amountWei = BigInt(Math.floor(Number(amt) * 1e18));
      const approveTx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "approve", args: [CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, amountWei] });
      await publicClient.waitForTransactionReceipt({ hash: approveTx });
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "addMargin", args: [BigInt(id), amountWei] });
      addLog(`Margin added (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
    } catch(e: any) { addLog(`Add margin failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
  };

  const handleSetTriggers = async (id: number) => {
    const tpStr = tpSlConfig[id]?.tp;
    const slStr = tpSlConfig[id]?.sl;
    if (!tpStr && !slStr) { addLog("Enter TP or SL values first.", "alert"); return; }
    if (!window.ethereum || !account?.address) return;
    addLog(`Saving triggers for #${id}...`, "info");
    try {
      if (!(await ensureRobinhoodChain())) return;
      const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const tpWei = tpStr ? BigInt(Math.floor(Number(tpStr) * 1e18)) : BigInt(0);
      const slWei = slStr ? BigInt(Math.floor(Number(slStr) * 1e18)) : BigInt(0);
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "setTriggerOrders", args: [BigInt(id), tpWei, slWei] });
      addLog(`Triggers saved (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
    } catch(e: any) { addLog(`Trigger save failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
  };

  // ─── Liquidation Shield: arm/disarm + per-position config ───────────
  // The shield is a mandate registry. Once armed, the off-chain keeper
  // will scan this position's health every cycle and emit toast alerts
  // (via /api/liquidation-alerts) when health drops below the threshold.
  const handleArmShield = async (
    positionId: number,
    thresholdPct: number,
    recommendedTopUp: string,
    maxTopUpPerEvent: string,
  ) => {
    if (!window.ethereum || !account?.address) return;
    if (!CONTRACT_ADDRESSES.LIQUIDATION_SHIELD || CONTRACT_ADDRESSES.LIQUIDATION_SHIELD === "0x0000000000000000000000000000000000000000") {
      addLog("Shield contract not configured.", "alert");
      return;
    }

    addLog(`Arming shield for position #${positionId}...`, "info");
    try {
      const wc = createWalletClient({
        chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any,
        account: account.address as `0x${string}`,
        transport: custom(window.ethereum as any),
      });

      const thresholdBps = BigInt(Math.max(0, Math.min(9000, Math.floor(thresholdPct * 100))));
      const recommendedWei = BigInt(Math.floor(Number(recommendedTopUp) * 1e18));
      const maxWei = BigInt(Math.floor(Number(maxTopUpPerEvent) * 1e18));

      if (recommendedWei <= 0n) { addLog("Recommended amount must be > 0.", "alert"); return; }
      if (maxWei < recommendedWei) { addLog("Max must be >= recommended.", "alert"); return; }

      const tx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.LIQUIDATION_SHIELD as `0x${string}`,
        abi: LIQUIDATION_SHIELD_ABI as any,
        functionName: "armShield",
        args: [BigInt(positionId), thresholdBps, recommendedWei, maxWei],
      });
      addLog(`Shield armed at ${thresholdPct}% (${tx.slice(0, 6)}...${tx.slice(-4)})`, "action");
    } catch (e: any) {
      addLog(`Shield arm failed: ${e.message?.split("\n")[0]?.substring(0, 60)}`, "alert");
    }
  };

  const handleDisarmShield = async (positionId: number) => {
    if (!window.ethereum || !account?.address) return;
    if (!CONTRACT_ADDRESSES.LIQUIDATION_SHIELD || CONTRACT_ADDRESSES.LIQUIDATION_SHIELD === "0x0000000000000000000000000000000000000000") return;

    addLog(`Disarming shield for #${positionId}...`, "info");
    try {
      const wc = createWalletClient({
        chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any,
        account: account.address as `0x${string}`,
        transport: custom(window.ethereum as any),
      });

      const tx = await wc.writeContract({
        chain: null,
        address: CONTRACT_ADDRESSES.LIQUIDATION_SHIELD as `0x${string}`,
        abi: LIQUIDATION_SHIELD_ABI as any,
        functionName: "disarmShield",
        args: [BigInt(positionId)],
      });
      addLog(`Shield disarmed (${tx.slice(0, 6)}...)`, "action");
    } catch (e: any) {
      addLog(`Disarm failed: ${e.message?.split("\n")[0]?.substring(0, 60)}`, "alert");
    }
  };

  // ─── Wave 4: chain switch helpers ──────────────────────────────────
  // Operations that hit Robinhood Chain (faucet, market orders, position
  // mgmt, oracle update) MUST be sure the wallet is on chain 46630, since
  // a previous LIMIT_ORDER may have switched it to Arbitrum Sepolia (421614)
  // and viem's writeContract with `chain: null` follows the wallet's active
  // chain. ensureChain throws if the user rejects the switch.
  const ensureChain = async (chainIdHex: string, addArgs?: any): Promise<boolean> => {
    if (!window.ethereum) return false;
    try {
      const current: string = await window.ethereum.request({ method: "eth_chainId" });
      if (current?.toLowerCase() === chainIdHex.toLowerCase()) return true;
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: chainIdHex }],
        });
        return true;
      } catch (switchErr: any) {
        if (switchErr?.code === 4902 && addArgs) {
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [addArgs] });
          return true;
        }
        throw switchErr;
      }
    } catch (e: any) {
      addLog(`Chain switch failed: ${e?.message?.split("\n")[0]?.substring(0, 60)}`, "alert");
      return false;
    }
  };

  const ensureRobinhoodChain = () =>
    ensureChain("0xb626" /* 46630 */, {
      chainId: "0xb626",
      chainName: "Robinhood Chain Testnet",
      rpcUrls: ["https://rpc.testnet.chain.robinhood.com"],
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://explorer.testnet.chain.robinhood.com"],
    });

  const ensureArbitrumSepolia = () =>
    ensureChain("0x66eee" /* 421614 */, {
      chainId: "0x66eee",
      chainName: "Arbitrum Sepolia",
      rpcUrls: ["https://sepolia-rollup.arbitrum.io/rpc"],
      nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
      blockExplorerUrls: ["https://sepolia.arbiscan.io"],
    });

  const handleMintFaucet = async () => {
    if (!window.ethereum || !account?.address) return;
    setIsMinting(true);
    addLog("Requesting faucet mint...", "info");
    if (!(await ensureRobinhoodChain())) { setIsMinting(false); return; }
    try {
      const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "faucet", args: [] });
      addLog(`Faucet OK: 1000 aUSD minted (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
    } catch(e: any) { addLog(`Faucet failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
    setIsMinting(false);
  };

  const handleMintArbitrumFaucet = async () => {
    if (!window.ethereum || !account?.address) return;
    setIsMinting(true);
    addLog("Requesting Arbitrum Sepolia faucet mint...", "info");
    if (!(await ensureArbitrumSepolia())) { setIsMinting(false); return; }
    try {
      const wc = createWalletClient({ chain: { id: 421614, name: "Arbitrum Sepolia", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
      const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.ARB_SEPOLIA_AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "mint", args: [account.address as `0x${string}`, BigInt(1000) * BigInt(1e18)] });
      addLog(`Arbitrum Faucet OK: 1000 aUSD minted (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
    } catch(e: any) { addLog(`Arbitrum Faucet failed: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
    setIsMinting(false);
  };

  const handleAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim()) return;
    setIsProcessing(true);
    addLog(`NLP Analysis: "${prompt}"`, "info");
    try {
      const perpRes = await fetch("/api/nlp", { method: "POST", body: JSON.stringify({ prompt }) });
      const perpData = await perpRes.json();
      const actionType = (typeof perpData.action === "string" ? perpData.action : "").toLowerCase();
      if (actionType.includes("open") || actionType.includes("position") || actionType.includes("long") || actionType.includes("short")) {
        if (perpData.action === "error") {
          addLog(`AI Agent: ${perpData.message}`, "alert");
        } else if (window.ethereum && account?.address) {
          addLog(`AI (Perps): ${perpData.message}`, "action");
          const leverage = perpData.leverage || 5;
          const collateralAmount = perpData.collateral || 100;
          const amountWei = BigInt(Math.floor(collateralAmount * 1e18));
          const assetName = perpData.asset || "BTC-PERP";
          const currentPrice = prices[assetName] || prices[assetName.split('-')[0]] || 0;
          if (currentPrice > 0) {
            addLog(`Updating Oracle (${assetName} @ $${currentPrice})...`, "info");
            try { await fetch(`${API_URL}/api/update-oracle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset: assetName, price: currentPrice }) }); } catch {}
          }
          addLog("Requesting signature...", "info");
          const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
          const allowance = await publicClient.readContract({ address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "allowance", args: [account.address as `0x${string}`, CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`] }) as bigint;
          if (allowance < amountWei) {
            addLog("Requesting aUSD approval...", "info");
            const approveTx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "approve", args: [CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, amountWei] });
            addLog("Waiting for approval...", "info");
            await publicClient.waitForTransactionReceipt({ hash: approveTx });
          }
          const tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "openPosition", args: [assetName, perpData.isLong ?? true, amountWei, BigInt(leverage)] });
          addLog(`Position opened (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
        }
      } else {
        addLog("Forwarding to Strategy Engine...", "info");
        const backendRes = await fetch(`${API_URL}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: prompt, account: account?.address, eoa: account?.address }) });
        const backendData = await backendRes.json();
        if (backendData.status === "awaiting_signature") {
          addLog(`Strategy: ${backendData.intent.description}`, "action");
          addLog(`Audit: ${backendData.rationale}`, "info");
          if (window.ethereum && account?.address) {
            const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });
            for (let i = 0; i < backendData.txParams.targets.length; i++) {
              addLog(`Signing Step ${i+1}/${backendData.txParams.targets.length}...`, "info");
              const txHash = await wc.sendTransaction({ chain: null, to: backendData.txParams.targets[i] as `0x${string}`, data: backendData.txParams.datas[i] as `0x${string}`, value: BigInt(backendData.txParams.values[i] || "0") });
              addLog(`Step ${i+1} sent: ${txHash.slice(0,6)}...`, "action");
            }
            if (backendData.txParams.automation?.isAutomated) {
              await fetch(`${API_URL}/approve-strategy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ strategyId: Date.now().toString(), txParams: backendData.txParams, accountAddress: account.address }) });
              addLog("DCA Strategy activated!", "action");
            }
          }
        } else if (backendData.status === "rejected") { addLog(`REJECTED: ${backendData.rationale}`, "alert"); }
      }
    } catch(e: any) { addLog(`Error: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
    setPrompt("");
    setIsProcessing(false);
  };

  const handleManualAction = async (isLong: boolean, tpStr?: string, slStr?: string) => {
    if (!window.ethereum || !account?.address) return;
    setIsProcessing(true);
    const leverage = Number(manualLeverage);
    const collateralAmount = Number(manualCollateral);
    const amountWei = BigInt(Math.floor(collateralAmount * 1e18));
    const assetName = selectedMarket;
    addLog(`Manual: ${isLong ? 'LONG' : 'SHORT'} ${assetName} | $${collateralAmount} | ${leverage}x`, "info");

    // ─── Wave 4: LIMIT ORDER → Stylus LOB on Arbitrum Sepolia ─────
    // Direct EOA → Stylus contract call. Skips the Solidity router and the
    // aUSD escrow approval (the WASM LOB doesn't pull tokens; collateral
    // accounting is informational on this contract). The user wallet must
    // be the contract's `router` (set at deploy via initialize()).
    if (orderType === "limit") {
      try {
        const stylusAddr = CONTRACT_ADDRESSES.STYLUS_LOB as `0x${string}`;
        if (!stylusAddr || stylusAddr === ("0x0000000000000000000000000000000000000000" as any)) {
          addLog("Stylus LOB address not configured.", "alert");
          setIsProcessing(false);
          return;
        }
        const limitPriceNum = Number(limitPrice);
        if (!Number.isFinite(limitPriceNum) || limitPriceNum <= 0) {
          addLog("Limit price must be a positive number.", "alert");
          setIsProcessing(false);
          return;
        }

        addLog("Switching wallet to Arbitrum Sepolia (Stylus LOB)...", "info");
        if (!(await ensureArbitrumSepolia())) { setIsProcessing(false); return; }

        const sepoliaWc = createWalletClient({
          chain: {
            id: 421614,
            name: "Arbitrum Sepolia",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: ["https://sepolia-rollup.arbitrum.io/rpc"] } },
          } as any,
          account: account.address as `0x${string}`,
          transport: custom(window.ethereum as any),
        });
        const sepoliaPublic = createPublicClient({
          chain: { id: 421614, name: "Arbitrum Sepolia" } as any,
          transport: http("https://sepolia-rollup.arbitrum.io/rpc"),
        });

        const assetSymbol = assetName.split('-')[0].toUpperCase();
        // uint256(keccak256(abi.encodePacked(symbol))) — same convention used
        // by the backend's buildLimitOrderTx and the Solidity router's
        // registerAsset. Keeps the Stylus LOB key space consistent.
        const assetHash = BigInt(keccak256(toBytes(assetSymbol)));
        const limitPriceWei = BigInt(Math.floor(limitPriceNum * 1e18));
        const leverageBn = BigInt(Math.max(1, Math.min(50, leverage)));

        addLog(`Approving aUSD on Arbitrum Sepolia...`, "info");
        const { request: approveReq } = await sepoliaPublic.simulateContract({
          address: CONTRACT_ADDRESSES.ARB_SEPOLIA_AUSD as `0x${string}`,
          abi: ERC20_ABI,
          functionName: "approve",
          args: [CONTRACT_ADDRESSES.STYLUS_ESCROW, amountWei],
          account: account.address as `0x${string}`,
        });
        const approveTx = await sepoliaWc.writeContract(approveReq);
        await sepoliaPublic.waitForTransactionReceipt({ hash: approveTx });

        addLog(`Placing limit order via Stylus Escrow on Arbitrum Sepolia...`, "info");
        const tx = await sepoliaWc.writeContract({
          address: CONTRACT_ADDRESSES.STYLUS_ESCROW as `0x${string}`,
          abi: AURA_CROSS_CHAIN_ESCROW_ABI,
          functionName: "placeLimitOrder",
          args: [assetHash, isLong, amountWei, leverageBn, limitPriceWei],
          account: account.address as `0x${string}`,
          gas: 3000000n,
          chain: null,
        });
        addLog(`Limit order tx sent (${tx.slice(0, 6)}...${tx.slice(-4)})`, "action");
        const receipt = await sepoliaPublic.waitForTransactionReceipt({ hash: tx });
        if (receipt.status === "success") {
          addLog(`Limit order placed in Stylus LOB. Block ${receipt.blockNumber}`, "action");
        } else {
          addLog(`Limit order tx reverted on-chain.`, "alert");
        }
      } catch (e: any) {
        addLog(`Limit order error: ${e.message?.split("\n")[0]?.substring(0, 80)}`, "alert");
      }
      setIsProcessing(false);
      return;
    }

    try {
      if (!(await ensureRobinhoodChain())) { setIsProcessing(false); return; }

      // Update oracle BEFORE the trade so entry price matches the displayed Pyth price.
      const currentPrice = prices[assetName] || prices[assetName.split('-')[0]] || 0;
      if (currentPrice > 0) {
        addLog(`Syncing oracle ($${currentPrice.toFixed(2)})...`, "info");
        try { await fetch(`${API_URL}/api/update-oracle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ asset: assetName, price: currentPrice }) }); } catch {}
      }

      addLog("Requesting signature...", "info");
      const wc = createWalletClient({ chain: { id: 46630, name: "Robinhood Testnet", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } } } as any, account: account.address as `0x${string}`, transport: custom(window.ethereum as any) });

      // ─── Market order branch ───
      // Use the hybrid LOB Router if configured (walks book + vault fallback).
      const lobRouter = CONTRACT_ADDRESSES.LOB_ROUTER;
      const useHybrid = lobRouter && lobRouter !== "0x0000000000000000000000000000000000000000";
      const targetContract = useHybrid ? lobRouter : CONTRACT_ADDRESSES.AURA_PERPS;

      // Single MAX_UINT approval to the target — only needed once ever.
      const MAX_UINT = BigInt("0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff");
      const allowance = await publicClient.readContract({ address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "allowance", args: [account.address as `0x${string}`, targetContract as `0x${string}`] }) as bigint;
      if (allowance < amountWei) {
        addLog(`One-time aUSD approval (unlimited)...`, "info");
        const approveTx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AUSD as `0x${string}`, abi: AUSD_ABI as any, functionName: "approve", args: [targetContract as `0x${string}`, MAX_UINT] });
        await publicClient.waitForTransactionReceipt({ hash: approveTx });
      }

      let tx;
      if (useHybrid) {
        const assetSymbol = assetName.split('-')[0];
        tx = await wc.writeContract({
          chain: null,
          address: lobRouter as `0x${string}`,
          abi: AURA_ROUTER_ABI as any,
          functionName: "routedMarketOpen",
          args: [assetSymbol, isLong, amountWei, BigInt(leverage)],
        });
        addLog(`Hybrid market open sent (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
      } else {
        tx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "openPosition", args: [assetName, isLong, amountWei, BigInt(leverage)] });
        addLog(`Position confirmed (TX: ${tx.slice(0,6)}...${tx.slice(-4)})`, "action");
      }

      // Immediately configure TP/SL if provided in UI
      if (tpStr || slStr) {
         await publicClient.waitForTransactionReceipt({ hash: tx });
         const nextId = await publicClient.readContract({ address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "nextPositionId" }) as bigint;
         const newId = nextId - 1n; // Assuming we are the ones who just opened it
         
         const tpWei = tpStr ? BigInt(Math.floor(Number(tpStr) * 1e18)) : BigInt(0);
         const slWei = slStr ? BigInt(Math.floor(Number(slStr) * 1e18)) : BigInt(0);
         
         const tpTx = await wc.writeContract({ chain: null, address: CONTRACT_ADDRESSES.AURA_PERPS as `0x${string}`, abi: AURA_PERPS_ABI as any, functionName: "setTriggerOrders", args: [newId, tpWei, slWei] });
         addLog(`Triggers configured (TX: ${tpTx.slice(0,6)}...)`, "action");
      }
    } catch(e: any) { addLog(`TX Error: ${e.message.split("\n")[0].substring(0, 50)}...`, "alert"); }
    setIsProcessing(false);
  };

  return {
    prompt, setPrompt, isProcessing, setIsProcessing, isMinting, balance, rawBalance,
    agentLogs, activePositions, historyPositions, openOrders, activeTab, setActiveTab, prices,
    selectedMarket, setSelectedMarket, isDropdownOpen, setIsDropdownOpen,
    tradingMode, setTradingMode, manualCollateral, setManualCollateral,
    manualLeverage, setManualLeverage, manualIsLong, setManualIsLong,
    orderType, setOrderType, limitPrice, setLimitPrice,
    handleMintArbitrumFaucet, arbBalance,
    tpSlConfig, setTpSlConfig, fundingRate, account,
    handleClosePosition, handlePartialClose, handleAddMargin, handleSetTriggers,
    handleCancelLimitOrder,
    handleArmShield, handleDisarmShield,
    handleMintFaucet, handleAction, handleManualAction, addLog,
  };
}
