"use client";

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import axios from "axios";
import { useActiveAccount, useActiveWallet, useDisconnect, useWalletBalance, useReadContract, useSendTransaction, ConnectButton } from "thirdweb/react";
import { createWallet } from "thirdweb/wallets";
import { client } from "@/app/client";
import { defineChain, getContract, prepareContractCall, prepareTransaction, toWei, waitForReceipt, readContract, eth_getBalance, getRpcClient } from "thirdweb";
import { API_URL } from "../../lib/config";

// UI Components from Kimi Template
import AnimatedGrid from '@/components/AnimatedGrid';
import Sidebar from '@/sections/Sidebar';
import ChatHeader from '@/sections/ChatHeader';
import ChatArea from '@/sections/ChatArea';
import ChatInput from '@/sections/ChatInput';
import DeployModal from '@/sections/DeployModal';
import SignModal from '@/sections/SignModal';
import HistoryArea from '@/sections/HistoryArea';
import StrategiesArea from '@/sections/StrategiesArea';
import MarketArea from '@/sections/MarketArea';
import AgentWorkspace from '@/sections/AgentWorkspace';

import { useReasoningStream } from '@/hooks/useReasoningStream';
import { useProactiveAlerts } from '@/hooks/useProactiveAlerts';

import type { Message, TransactionProposal, WalletState, AgentContract, Strategy } from '@/types';

// Simple UUID generator fallback
function generateId(): string {
  return Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
}

const robinhoodChain = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  rpc: "https://rpc.testnet.chain.robinhood.com",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ name: "Explorer", url: "https://explorer.testnet.chain.robinhood.com" }],
});

// Wave 4: Stylus LOB lives on Arbitrum Sepolia. LIMIT_ORDER intents land here,
// not on Robinhood Chain. The user wallet must switch network before signing.
const arbitrumSepoliaChain = defineChain({
  id: 421614,
  name: "Arbitrum Sepolia",
  rpc: "https://sepolia-rollup.arbitrum.io/rpc",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  blockExplorers: [{ name: "Arbiscan", url: "https://sepolia.arbiscan.io" }],
});

const wallets = [
  createWallet("io.metamask"),
  createWallet("com.coinbase.wallet"),
  createWallet("me.rainbow"),
  createWallet("org.uniswap"),
];

const FACTORY_ABI = [
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "createAccount",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{ "internalType": "address", "name": "owner", "type": "address" }],
    "name": "getAccount",
    "outputs": [{ "internalType": "address", "name": "", "type": "address" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

const AURA_ACCOUNT_ABI = [
  {
    "inputs": [
      { "internalType": "address[]", "name": "dest", "type": "address[]" },
      { "internalType": "uint256[]", "name": "value", "type": "uint256[]" },
      { "internalType": "bytes[]", "name": "func", "type": "bytes[]" }
    ],
    "name": "executeBatch",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

const FACTORY_ADDRESS = "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550";

type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
};

export default function Home() {
  const account = useActiveAccount();
  const activeWallet = useActiveWallet();
  const { disconnect } = useDisconnect();
  const { data: balance } = useWalletBalance({ client, chain: robinhoodChain, address: account?.address });
  const { mutate: sendTransaction } = useSendTransaction();

  const [auraAccountAddress, setAuraAccountAddress] = useState<string>('');
  const [agentOperatorAddress, setAgentOperatorAddress] = useState<string>('');
  const [activeNav, setActiveNav] = useState('chat');
  const [pausedStrategies, setPausedStrategies] = useState<Record<string, boolean>>({});
  const [backendStrategies, setBackendStrategies] = useState<any[]>([]);

  // Load Agent address from backend
  useEffect(() => {
    axios.get(`${API_URL}/agent-address`)
      .then(res => setAgentOperatorAddress(res.data.address))
      .catch(err => console.error("Failed to fetch agent address:", err));
  }, []);

  const factoryContract = useMemo(() => getContract({
    client,
    chain: robinhoodChain,
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI
  }), []);

  const { data: existingAccount, isLoading: isCheckingAccount } = useReadContract({
    contract: factoryContract,
    method: "getAccount",
    params: [account?.address || "0x0000000000000000000000000000000000000000"]
  });

  useEffect(() => {
    if (existingAccount && existingAccount !== "0x0000000000000000000000000000000000000000") {
      setAuraAccountAddress(existingAccount);
    } else {
      setAuraAccountAddress('');
    }
  }, [existingAccount]);

  const accountContractForAgentCheck = useMemo(() => {
    return getContract({
      client,
      chain: robinhoodChain,
      address: auraAccountAddress || "0x0000000000000000000000000000000000000000",
      abi: [{ "inputs": [], "name": "aiAgent", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }] as const
    });
  }, [auraAccountAddress]);

  const { data: currentAiAgent, refetch: refetchAiAgent } = useReadContract({
    contract: accountContractForAgentCheck,
    method: "aiAgent",
    params: [],
    queryOptions: {
      enabled: !!auraAccountAddress
    }
  });

  // UI State
  const defaultMessages: Message[] = [];

  const [messages, setMessages] = useState<Message[]>(defaultMessages);

  // ── Conversation history (per-wallet) ──────────────────────────────
  // Multiple chats stored per wallet. Always boots on a fresh "Neural
  // Terminal Ready" empty state — the user picks a past conversation from
  // the dropdown to resume it.
  const conversationsKey = (addr: string) => `aura_conversations_${addr}`;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);

  // Load the list of conversations whenever the wallet changes, but ALWAYS
  // start the chat surface on the empty "Neural Terminal Ready" state.
  useEffect(() => {
    if (!account?.address) {
      setConversations([]);
      setActiveConversationId(null);
      setMessages([]);
      return;
    }
    try {
      const saved = localStorage.getItem(conversationsKey(account.address));
      const parsed: Conversation[] = saved ? JSON.parse(saved) : [];
      const rehydrated = parsed.map((c) => ({
        ...c,
        messages: c.messages.map((m: any) => ({ ...m, timestamp: new Date(m.timestamp) })),
      }));
      setConversations(rehydrated);
    } catch {
      setConversations([]);
    }
    setActiveConversationId(null);
    setMessages([]);
  }, [account?.address]);

  // Persist messages: either update the active conversation, or create a new
  // one the first time the user sends something in a fresh terminal.
  useEffect(() => {
    if (!account?.address || messages.length === 0) return;

    if (!activeConversationId) {
      const firstUserMsg = messages.find((m) => m.type === 'user');
      const title = ((firstUserMsg?.content as string) || 'New Conversation').slice(0, 60);
      const id = generateId();
      setActiveConversationId(id);
      setConversations((prev) => {
        const next: Conversation[] = [
          { id, title, createdAt: Date.now(), updatedAt: Date.now(), messages },
          ...prev,
        ];
        try {
          localStorage.setItem(conversationsKey(account.address!), JSON.stringify(next));
        } catch {}
        return next;
      });
    } else {
      setConversations((prev) => {
        const next = prev.map((c) =>
          c.id === activeConversationId
            ? { ...c, messages, updatedAt: Date.now() }
            : c
        );
        try {
          localStorage.setItem(conversationsKey(account.address!), JSON.stringify(next));
        } catch {}
        return next;
      });
    }
  }, [messages, account?.address, activeConversationId]);

  const handleSelectConversation = useCallback((id: string) => {
    const conv = conversations.find((c) => c.id === id);
    if (!conv) return;
    setActiveConversationId(id);
    setMessages(conv.messages);
    setActiveNav('chat');
  }, [conversations]);

  const handleDeleteConversation = useCallback((id: string) => {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (account?.address) {
        try {
          localStorage.setItem(conversationsKey(account.address), JSON.stringify(next));
        } catch {}
      }
      return next;
    });
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setMessages([]);
    }
  }, [account?.address, activeConversationId]);
  const [isThinking, setIsThinking] = useState(false);
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [showDeployModal, setShowDeployModal] = useState(false);
  const [showSignModal, setShowSignModal] = useState(false);
  const [pendingTxId, setPendingTxId] = useState<string | null>(null);
  const [txParamsMap, setTxParamsMap] = useState<Record<string, any>>({});
  const [configuringStrategy, setConfiguringStrategy] = useState<string | null>(null);
  const [strategyParams, setStrategyParams] = useState<Record<string, string>>({});
  const [backendExecutions, setBackendExecutions] = useState<any[]>([]);

  // Feature 1: Streaming Reasoning
  const { steps: reasoningSteps, isStreaming: isReasoningStreaming, startStream, pushStep, resolveStream } = useReasoningStream();

  // Feature 4: Proactive Alerts
  const { pendingAlert, dismissAlert } = useProactiveAlerts(!!account);

  // Inject proactive alert into chat when detected
  useEffect(() => {
    if (pendingAlert && activeNav === 'chat') {
      addMessage({
        id: pendingAlert.id,
        type: 'ai',
        content: pendingAlert.message,
        timestamp: new Date(),
        isProactive: true,
        proactiveActions: pendingAlert.actions,
      });
      dismissAlert();
    }
  }, [pendingAlert, activeNav]);

  // Fetch backend executions periodically
  useEffect(() => {
    const fetchExecutions = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/executions`);
        setBackendExecutions(res.data);
      } catch (err) {
        console.error("Failed to fetch executions:", err);
      }
    };
    
    fetchExecutions();
    const interval = setInterval(fetchExecutions, 10000); // Every 10s
    return () => clearInterval(interval);
  }, []);

  // Fetch backend-managed strategies periodically. The backend is the source
  // of truth so the user can cancel/pause/resume an active DCA even after a
  // page refresh that wipes local UI state.
  useEffect(() => {
    const fetchStrategies = async () => {
      try {
        const url = auraAccountAddress
          ? `${API_URL}/api/strategies?account=${auraAccountAddress}`
          : `${API_URL}/api/strategies`;
        const res = await axios.get(url);
        setBackendStrategies(Array.isArray(res.data) ? res.data : []);
      } catch (err) {
        // Backend offline is non-fatal; we just won't have strategies.
        console.error("Failed to fetch strategies:", err);
      }
    };

    fetchStrategies();
    const interval = setInterval(fetchStrategies, 5000); // Every 5s
    return () => clearInterval(interval);
  }, [auraAccountAddress]);

  const wallet: WalletState = {
    connected: !!account,
    address: account?.address || '',
    balance: balance ? `${parseFloat(balance.displayValue).toFixed(4)} ETH` : '0 ETH',
  };

  const agentContractState: AgentContract = {
    deployed: !!auraAccountAddress,
    address: auraAccountAddress,
  };

  const addMessage = useCallback((msg: Message) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleConnectWallet = useCallback(() => {
    // Handled by Thirdweb ConnectButton embedded in Sidebar
  }, []);

  const handleDeployContract = useCallback(async () => {
    if (!account) return;
    setShowDeployModal(false);

    addMessage({
      id: generateId(),
      type: 'system',
      content: "Deployment initiated. Step 1/2: Creating your Aura Account...",
      timestamp: new Date(),
    });

    const tx = prepareContractCall({
      contract: factoryContract,
      method: "createAccount",
      params: [account.address],
      value: toWei("0.001")
    });

    sendTransaction(tx, {
      onSuccess: async (result) => {
        // L'adresse de l'account sera récupérée via le prochain render (getAccount)
        // Mais pour l'immédiat, on attend un peu pour que la chaine se mette à jour
        setTimeout(async () => {
          // Tentative de récupération de l'adresse fraîchement créée
          try {
            const accountAddr = await existingAccount; // Si déjà mis à jour par useReadContract
            if (accountAddr && agentOperatorAddress) {
              addMessage({
                id: generateId(),
                type: 'system',
                content: "Step 2/2: Authorizing AI Agent for automated strategies...",
                timestamp: new Date(),
              });

              const accContract = getContract({
                client,
                chain: robinhoodChain,
                address: accountAddr as string,
                abi: [{
                  "inputs": [{ "internalType": "address", "name": "_aiAgent", "type": "address" }],
                  "name": "setAiAgent",
                  "outputs": [],
                  "stateMutability": "nonpayable",
                  "type": "function"
                }] as const
              });

              const authTx = prepareContractCall({
                contract: accContract,
                method: "setAiAgent",
                params: [agentOperatorAddress as `0x${string}`]
              });

              sendTransaction(authTx, {
                onSuccess: () => {
                  addMessage({ id: generateId(), type: 'system', content: "Aura Agent fully deployed and authorized!", timestamp: new Date() });
                }
              });
            }
          } catch (e) { }
        }, 3000);
      },
      onError: (err) => {
        addMessage({
          id: generateId(),
          type: 'system',
          content: `Agent deployment failed: ${err.message}`,
          timestamp: new Date(),
        });
      }
    });
  }, [account, factoryContract, sendTransaction, addMessage, agentOperatorAddress, existingAccount]);

  const handleSendMessage = useCallback(async (text: string) => {
    if (!account) {
      addMessage({ id: generateId(), type: 'system', content: 'Please connect your wallet first.', timestamp: new Date() });
      return;
    }
    if (!auraAccountAddress && !isCheckingAccount) {
      setShowDeployModal(true);
      return;
    }

    const userMsg: Message = { id: generateId(), type: 'user', content: text, timestamp: new Date() };
    addMessage(userMsg);

    if (text === 'authorize' && auraAccountAddress && agentOperatorAddress) {
      addMessage({ id: generateId(), type: 'system', content: "Authorizing Aura Agent...", timestamp: new Date() });
      const accContract = getContract({
        client,
        chain: robinhoodChain,
        address: auraAccountAddress,
        abi: [{ "inputs": [{ "internalType": "address", "name": "_aiAgent", "type": "address" }], "name": "setAiAgent", "outputs": [], "stateMutability": "nonpayable", "type": "function" }] as const
      });

      const authTx = prepareContractCall({
        contract: accContract,
        method: "setAiAgent",
        params: [agentOperatorAddress as `0x${string}`]
      });

      sendTransaction(authTx, {
        onSuccess: () => {
          addMessage({ id: generateId(), type: 'system', content: "Aura Agent manually authorized successfully!", timestamp: new Date() });
          refetchAiAgent();
        },
        onError: (err) => {
          addMessage({ id: generateId(), type: 'system', content: `❌ Authorization failed: ${err.message}`, timestamp: new Date() });
        }
      });
      return;
    }

    if (text === 'Custom Schedule') {
      setTimeout(() => {
        addMessage({
          id: generateId(),
          type: 'ai',
          content: 'What kind of recurring strategy would you like to set up? For example: "Swap 0.0001 ETH to AMZN every Monday for a month" or "Every day at 15:00 swap 0.1 TSLA to ETH".',
          timestamp: new Date()
        });
      }, 500);
      return;
    }

    if (text === 'Daily ETH → AMZN' || text === '+ Daily ETH→AMZN') {
      setConfiguringStrategy('daily-eth-amzn-amount');
      setStrategyParams({});
      setTimeout(() => {
        addMessage({
          id: generateId(),
          type: 'ai',
          content: 'Excellent choice. How much ETH would you like to swap for AMZN every day? (e.g., 0.01)',
          timestamp: new Date()
        });
      }, 500);
      return;
    }

    let finalPrompt = text;
    if (configuringStrategy === 'daily-eth-amzn-amount') {
      setStrategyParams({ amount: text });
      setConfiguringStrategy('daily-eth-amzn-time');
      setTimeout(() => {
        addMessage({
          id: generateId(),
          type: 'ai',
          content: 'Got it. At what time should this daily swap be executed? (e.g., 14:00 or 9 AM)',
          timestamp: new Date()
        });
      }, 500);
      return;
    } else if (configuringStrategy === 'daily-eth-amzn-time') {
      finalPrompt = `Swap ${strategyParams.amount} ETH to AMZN every day at ${text}`;
      setConfiguringStrategy(null);
      setStrategyParams({});
    }

    setIsThinking(true);
    startStream(); // Start reasoning animation


    try {
      // Use SSE streaming endpoint for real-time reasoning steps
      const response = await fetch(`${API_URL}/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: finalPrompt,
          account: auraAccountAddress,
          eoa: account.address,
          tzOffsetMin: -new Date().getTimezoneOffset()
        }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let resultData: any = null;
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') continue;

          try {
            const parsed = JSON.parse(payload);
            if (parsed.type === 'step') {
              pushStep(parsed.step);
            } else if (parsed.type === 'result') {
              resultData = parsed;
            } else if (parsed.type === 'error') {
              throw new Error(parsed.message);
            }
          } catch (parseErr: any) {
            if (parseErr.message && !parseErr.message.includes('JSON')) throw parseErr;
          }
        }
      }

      if (!resultData) throw new Error("No result received from stream");

      const { txParams, intent, rationale, status, macroAnalysis, confidenceScore } = resultData;

      if (status === "rejected") {
        addMessage({
          id: generateId(),
          type: 'ai',
          content: `Policy Violation: ${rationale}`,
          timestamp: new Date()
        });
        setIsThinking(false);
        return;
      }

      const txId = generateId();
      setTxParamsMap(prev => ({ ...prev, [txId]: txParams }));

      const tokenInSymbol = intent.tokenInSymbol || 'ETH';
      const tokenOutSymbol = intent.tokenOutSymbol || 'Asset';
      const amountMatch = intent.description?.match(/([\d.]+)\s*(ETH|TSLA|AMZN|NFLX|AMD|PLTR|BTC)/i);
      const amountStr = amountMatch ? amountMatch[1] : 'N/A';

      const isAutomated = txParams.automation?.isAutomated;
      const freq = isAutomated ? `${txParams.automation.totalSwaps} Executions (Every ${txParams.automation.intervalSeconds}s)` : 'Manual Execution';
      const duration = isAutomated ? 'Continuous' : 'Instant';

      // Build risk management info string
      const riskInfo = txParams.riskManagement;
      let riskText = '';
      if (riskInfo && (riskInfo.trailingStopPct > 0 || riskInfo.takeProfitPct > 0)) {
        const parts = [];
        if (riskInfo.trailingStopPct > 0) parts.push(`Trailing Stop: ${riskInfo.trailingStopPct}%`);
        if (riskInfo.takeProfitPct > 0) parts.push(`Take Profit: ${riskInfo.takeProfitPct}%`);
        riskText = ` | Risk Management: ${parts.join(', ')}`;
      }

      // Build macro context string
      let macroText = '';
      if (macroAnalysis) {
        const emoji = macroAnalysis.sentiment === 'BULLISH' ? '🟢' : macroAnalysis.sentiment === 'BEARISH' ? '🔴' : '🟡';
        macroText = `\n\n${emoji} **Market Sentiment:** ${macroAnalysis.sentiment} (Score: ${macroAnalysis.score}/100)\n${macroAnalysis.summary || ''}`;
        if (macroAnalysis.correlation_warnings && macroAnalysis.correlation_warnings.length > 0) {
          macroText += `\n⚠️ ${macroAnalysis.correlation_warnings.join(', ')}`;
        }
      }

      const transactionProposal: TransactionProposal = {
        id: txId,
        strategyName: txParams.kind === 'LIMIT_ORDER'
          ? (intent.description || `${txParams.limitOrder?.isLong ? 'Long' : 'Short'} ${txParams.limitOrder?.asset} ${txParams.limitOrder?.leverage}x @ $${txParams.limitOrder?.limitPrice}`)
          : (intent.description || 'Synthra Swap'),
        from: { token: tokenInSymbol, amount: amountStr },
        to: { token: tokenOutSymbol },
        frequency: freq,
        duration: duration,
        gasEstimate: txParams.kind === 'LIMIT_ORDER' ? '~0.0001 ETH (Stylus)' : '~0.0002 ETH',
        totalEstimate: 'N/A',
        rawData: rationale || 'Transaction validated by Multi-Agent Committee.',
        status: 'proposed',

        // Wave 4: limit-order metadata so SignModal / TransactionCard can label correctly
        kind: txParams.kind || 'SWAP',
        chainId: txParams.chainId,
        network: txParams.kind === 'LIMIT_ORDER' ? 'Arbitrum Sepolia' : 'Robinhood Chain',
        limitOrder: txParams.limitOrder,
        confidenceScore: typeof confidenceScore === 'number' ? confidenceScore : undefined,
      };

      addMessage({
        id: generateId(),
        type: 'ai',
        content: `Strategy Prepared. Our Risk Auditor has reviewed the plan.${riskText}${macroText}`,
        timestamp: new Date(),
        transaction: transactionProposal
      });

    } catch (error: any) {
      const errorMsg = error.response?.data?.message || error.message || "Unknown error";
      addMessage({ id: generateId(), type: 'system', content: `Coordination Error: ${errorMsg}`, timestamp: new Date() });
    } finally {
      resolveStream(); // Resolve all reasoning steps
      setIsThinking(false);
    }
  }, [account, auraAccountAddress, isCheckingAccount, addMessage, configuringStrategy, strategyParams]);

  const handleSignTransaction = useCallback((txId: string) => {
    setPendingTxId(txId);
    setShowSignModal(true);
  }, []);

  const handleConfirmSign = useCallback(() => {
    if (!pendingTxId || !auraAccountAddress) return;

    const txParams = txParamsMap[pendingTxId];
    if (!txParams) {
      setShowSignModal(false);
      return;
    }

    // --- AUTOMATION: Approval de l'EOA vers Aura Account si nécessaire ---
    const executeSwap = async () => {
        const totalValue = txParams.values ? txParams.values.reduce((acc: bigint, v: any) => acc + BigInt(v), BigInt(0)) : BigInt(0);

        // ──────────────────────────────────────────────────────────────
        // FIX: The deployed AuraAccount.executeBatch is NOT payable.
        // If the inner batch needs ETH (e.g., ETH→Token swap), we must
        // pre-fund the AuraAccount via a plain ETH transfer (its
        // SimpleAccount `receive()` is payable). The inner router call 
        // uses the account's own balance to forward ETH.
        // ──────────────────────────────────────────────────────────────
        if (totalValue > 0n && auraAccountAddress && txParams.kind !== 'LIMIT_ORDER') {
            try {
                const rpc = getRpcClient({ client, chain: robinhoodChain });
                const auraBalance = await eth_getBalance(rpc, { address: auraAccountAddress });

                if (auraBalance < totalValue) {
                    const shortfall = totalValue - auraBalance;
                    addMessage({
                        id: generateId(),
                        type: 'system',
                        content: `Step 1/2: Funding Aura Account with ${(Number(shortfall) / 1e18).toFixed(6)} ETH for the swap...`,
                        timestamp: new Date()
                    });

                    const fundingTx = prepareTransaction({
                        client,
                        chain: robinhoodChain,
                        to: auraAccountAddress,
                        value: shortfall
                    });

                    const fundingResult: any = await new Promise((resolve, reject) => {
                        sendTransaction(fundingTx, {
                            onSuccess: (tx) => resolve(tx),
                            onError: (err) => reject(err),
                        });
                    });

                    await waitForReceipt({
                        client,
                        chain: robinhoodChain,
                        transactionHash: fundingResult.transactionHash
                    });

                    addMessage({
                        id: generateId(),
                        type: 'system',
                        content: `Step 1/2 Complete: Aura Account funded. Executing swap...`,
                        timestamp: new Date()
                    });
                }
            } catch (err: any) {
                addMessage({
                    id: generateId(),
                    type: 'system',
                    content: `Funding failed: ${err.message || err}. Swap cancelled.`,
                    timestamp: new Date()
                });
                setMessages((prev) => prev.map((msg) => {
                    if (msg.transaction?.id === pendingTxId) {
                        return { ...msg, transaction: { ...msg.transaction, status: 'rejected' as const } };
                    }
                    return msg;
                }));
                return;
            }
        }

        // ─── Gasless Mode ─────────────────────────────────────────────
        // If the user has an AuraAccount with the backend agent registered,
        // we can execute via the backend relay (zero gas for the user).
        // The backend calls executeBatchByAgent on the AuraAccount.
        const useGasless = txParams.kind !== 'LIMIT_ORDER' && !txParams.automation?.isAutomated && auraAccountAddress;
        if (useGasless) {
            setShowSignModal(false);
            const pendingId = pendingTxId;
            setPendingTxId(null);

            addMessage({
                id: generateId(),
                type: 'system',
                content: `Executing gasless via AI Agent relay (you pay zero gas)...`,
                timestamp: new Date()
            });

            try {
                // Compute reasoning hash for on-chain audit trail
                const auditPayload = JSON.stringify({
                  rationale: messages.find(m => m.transaction?.id === pendingId)?.transaction?.rawData || '',
                  description: txParams.description || '',
                  timestamp: Date.now(),
                });
                const reasoningHash = typeof window !== 'undefined'
                  ? '0x' + Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(auditPayload)))).map(b => b.toString(16).padStart(2, '0')).join('')
                  : undefined;

                const resp = await axios.post(`${API_URL}/api/gasless-execute`, {
                    accountAddress: auraAccountAddress,
                    targets: txParams.targets,
                    values: txParams.values,
                    datas: txParams.datas,
                    reasoningHash,
                    action: txParams.description || 'SWAP',
                    confidenceScore: messages.find(m => m.transaction?.id === pendingId)?.transaction?.confidenceScore,
                });

                setMessages((prev) => prev.map((msg) => {
                    if (msg.transaction?.id === pendingId) {
                        return {
                            ...msg,
                            transaction: {
                                ...msg.transaction,
                                status: 'confirmed' as const,
                                txHash: resp.data.txHash,
                                confirmedAt: new Date().toISOString()
                            }
                        };
                    }
                    return msg;
                }));
                addMessage({
                    id: generateId(),
                    type: 'system',
                    content: `Gasless execution confirmed! Block ${resp.data.blockNumber}. TX: ${resp.data.txHash}. You paid $0 in gas.`,
                    timestamp: new Date()
                });
            } catch (err: any) {
                const errMsg = err.response?.data?.error || err.message;
                setMessages((prev) => prev.map((msg) => {
                    if (msg.transaction?.id === pendingId) {
                        return { ...msg, transaction: { ...msg.transaction, status: 'rejected' as const } };
                    }
                    return msg;
                }));
                addMessage({ id: generateId(), type: 'system', content: `Gasless execution failed: ${errMsg}`, timestamp: new Date() });
            }
            return;
        }

        // ─── Wave 4: Limit Order bypass ───────────────────────────────
        // LIMIT_ORDER tx lands directly on the Stylus LOB on Arbitrum Sepolia
        // — no Aura Account, no batch, no funding step. The user signs with
        // their EOA on the Sepolia chain (which is also the LOB's `router`,
        // initialized with the same EOA at deploy time).
        if (txParams.kind === 'LIMIT_ORDER') {
            setShowSignModal(false);
            const pendingId = pendingTxId;
            setPendingTxId(null);

            const target = txParams.targets[0];
            const data = txParams.datas[0] as `0x${string}`;
            const value = BigInt(txParams.values?.[0] ?? '0');

            const limitTx = prepareTransaction({
                client,
                chain: arbitrumSepoliaChain,
                to: target,
                data,
                value,
            });

            addMessage({
                id: generateId(),
                type: 'system',
                content: `Routing limit order to Stylus LOB on Arbitrum Sepolia (chain ${txParams.chainId})...`,
                timestamp: new Date()
            });

            sendTransaction(limitTx, {
                onSuccess: async (tx) => {
                    addMessage({ id: generateId(), type: 'system', content: `Limit order tx sent! Waiting for confirmation on Arbitrum Sepolia…`, timestamp: new Date() });
                    try {
                        const receipt = await waitForReceipt({
                            client,
                            chain: arbitrumSepoliaChain,
                            transactionHash: tx.transactionHash
                        });
                        setMessages((prev) => prev.map((msg) => {
                            if (msg.transaction?.id === pendingId) {
                                return {
                                    ...msg,
                                    transaction: {
                                        ...msg.transaction,
                                        status: receipt.status === 'success' ? 'confirmed' : 'rejected',
                                        txHash: tx.transactionHash,
                                        confirmedAt: new Date().toISOString()
                                    }
                                };
                            }
                            return msg;
                        }));
                        if (receipt.status === 'success') {
                            addMessage({ id: generateId(), type: 'system', content: `Limit order placed in Stylus LOB. Block ${receipt.blockNumber}. TX: ${tx.transactionHash}`, timestamp: new Date() });
                        } else {
                            addMessage({ id: generateId(), type: 'system', content: `Limit order tx reverted on-chain. TX: ${tx.transactionHash}`, timestamp: new Date() });
                        }
                    } catch (err: any) {
                        addMessage({ id: generateId(), type: 'system', content: `Wait-for-receipt failed: ${err?.message || err}`, timestamp: new Date() });
                    }
                },
                onError: (err) => {
                    setMessages((prev) => prev.map((msg) => {
                        if (msg.transaction?.id === pendingId) {
                            return { ...msg, transaction: { ...msg.transaction, status: 'rejected' as const } };
                        }
                        return msg;
                    }));
                    addMessage({ id: generateId(), type: 'system', content: `Limit order rejected: ${err.message}`, timestamp: new Date() });
                }
            });
            return;
        }

        const isAutomated = txParams.automation?.isAutomated;

        if (isAutomated) {
            setShowSignModal(false);
            const pendingId = pendingTxId;
            setPendingTxId(null);
            
            try {
                addMessage({ id: generateId(), type: 'system', content: `Scheduling strategy...`, timestamp: new Date() });
                
                await axios.post(`${API_URL}/approve-strategy`, {
                    strategyId: pendingId,
                    txParams: txParams,
                    accountAddress: auraAccountAddress
                });

                addMessage({ 
                    id: generateId(), 
                    type: 'system', 
                    content: `Success! Strategy scheduled by the Multi-Agent Committee. Initial execution will occur at the specified time.`, 
                    timestamp: new Date() 
                });

                setMessages((prev) => prev.map((msg) => {
                    if (msg.transaction?.id === pendingId) {
                        return { ...msg, transaction: { ...msg.transaction, status: 'confirmed' as const } };
                    }
                    return msg;
                }));
            } catch (err: any) {
                const errorMsg = err.response?.data?.message || err.message || "Unknown error";
                addMessage({ id: generateId(), type: 'system', content: `Failed to schedule strategy: ${errorMsg}`, timestamp: new Date() });
            }
            return;
        }

        const isDirectRouterCall = !isAutomated && txParams.targets.length === 1 && txParams.targets[0].toLowerCase() === "0x6f308b834595312f734e65e273f2210f43fc48f8";
        
        console.log("🚀 Routing Transaction:", isDirectRouterCall ? "DIRECT" : "AURA_ACCOUNT");
        console.log("Targets:", txParams.targets);
        console.log("Value:", txParams.values);

        let transaction;
        if (isDirectRouterCall) {
            transaction = prepareTransaction({
                client,
                chain: robinhoodChain,
                to: txParams.targets[0],
                data: txParams.datas[0] as `0x${string}`,
                value: BigInt(txParams.values[0])
            });
        } else {
            const contract = getContract({ client, chain: robinhoodChain, address: auraAccountAddress, abi: AURA_ACCOUNT_ABI });

            transaction = prepareContractCall({
                contract,
                method: "executeBatch",
                params: [
                    txParams.targets,
                    txParams.values.map((v: any) => BigInt(v)),
                    txParams.datas.map((d: any) => d as `0x${string}`)
                ],
                value: 0n, // executeBatch is non-payable; ETH is forwarded from the account's own balance
                gas: BigInt(3000000)
            });
        }

        sendTransaction(transaction, {
            onSuccess: async (tx) => {
                const pendingId = pendingTxId;
                addMessage({ id: generateId(), type: 'system', content: `Transaction sent! Waiting for block confirmation...`, timestamp: new Date() });
                
                // Wait for the transaction to be mined
                const receipt = await waitForReceipt({
                    client,
                    chain: robinhoodChain,
                    transactionHash: tx.transactionHash
                });
                
                setMessages((prev) => prev.map((msg) => {
                    if (msg.transaction?.id === pendingId) {
                        return { 
                            ...msg, 
                            transaction: { 
                                ...msg.transaction, 
                                status: receipt.status === 'success' ? 'confirmed' : 'rejected', 
                                txHash: tx.transactionHash, 
                                confirmedAt: new Date().toISOString() 
                            } 
                        };
                    }
                    return msg;
                }));

                if (receipt.status === 'success') {
                    addMessage({ id: generateId(), type: 'system', content: `Success! Strategy executed and confirmed in block ${receipt.blockNumber}. TX: ${tx.transactionHash}`, timestamp: new Date() });
                } else {
                    addMessage({ id: generateId(), type: 'system', content: `Transaction reverted on-chain. TX: ${tx.transactionHash}`, timestamp: new Date() });
                }
            },
            onError: (err) => {
                setMessages((prev) => prev.map((msg) => {
                    if (msg.transaction?.id === pendingTxId) {
                        return { ...msg, transaction: { ...msg.transaction, status: 'rejected' as const } };
                    }
                    return msg;
                }));
                addMessage({ id: generateId(), type: 'system', content: `Execution Rejected: ${err.message}`, timestamp: new Date() });
            }
        });
    };
    if (txParams.requiredApproval) {
      addMessage({ id: generateId(), type: 'system', content: `Step 1/2: Approving ${txParams.requiredApproval.symbol} usage...`, timestamp: new Date() });

      const erc20Contract = getContract({
        client,
        chain: robinhoodChain,
        address: txParams.requiredApproval.tokenAddress,
        abi: [{
          "inputs": [
            { "internalType": "address", "name": "spender", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
          ],
          "name": "approve",
          "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
          "stateMutability": "nonpayable",
          "type": "function"
        }] as const
      });

      const approvalTx = prepareContractCall({
        contract: erc20Contract,
        method: "approve",
        params: [txParams.requiredApproval.spender, BigInt(txParams.requiredApproval.amount)]
      });

      sendTransaction(approvalTx, {
        onSuccess: async (tx) => {
          addMessage({ id: generateId(), type: 'system', content: `Step 1/2: ${txParams.requiredApproval.symbol} approval sent. Waiting for confirmation...`, timestamp: new Date() });

          // Wait for the approval to be mined
          await waitForReceipt({
            client,
            chain: robinhoodChain,
            transactionHash: tx.transactionHash
          });

          addMessage({ id: generateId(), type: 'system', content: `Step 1/2 Complete: ${txParams.requiredApproval.symbol} approved! Proceeding to execution...`, timestamp: new Date() });

          executeSwap();
        },
        onError: (err) => {
          addMessage({ id: generateId(), type: 'system', content: `Approval failed: ${err.message}. Swap cancelled.`, timestamp: new Date() });
          setShowSignModal(false);
        }
      });
    } else {
      executeSwap();
    }

    setShowSignModal(false);
    setPendingTxId(null);
  }, [pendingTxId, auraAccountAddress, txParamsMap, sendTransaction, addMessage]);

  const handleDisconnect = useCallback(() => {
    if (activeWallet) {
      disconnect(activeWallet);
    }
  }, [activeWallet, disconnect]);

  const handleRejectTransaction = useCallback((txId: string) => {
    setMessages((prev) =>
      prev.map((msg) => {
        if (msg.transaction?.id === txId) {
          return { ...msg, transaction: { ...msg.transaction, status: 'rejected' as const } };
        }
        return msg;
      })
    );
  }, []);

  const currentTx = pendingTxId
    ? messages.find((m) => m.transaction?.id === pendingTxId)?.transaction || null
    : null;

  const handleNewStrategy = useCallback(() => {
    // Fresh terminal — back to "Neural Terminal Ready". Past conversation
    // remains accessible via the history dropdown.
    setActiveConversationId(null);
    setMessages([]);
    setActiveNav('chat');
  }, []);

  const handlePauseStrategy = useCallback(async (id: string) => {
    // Determine the desired action from current backend status.
    const current = backendStrategies.find((s) => s.id === id);
    const isActive = current?.status === 'active';
    const action = isActive ? 'pause' : 'resume';

    // Optimistic UI update so toggling feels instant; backend poll will
    // reconcile shortly.
    setPausedStrategies((prev) => ({ ...prev, [id]: isActive }));

    try {
      const res = await axios.post(`${API_URL}/api/strategies/${id}/${action}`);
      if (res.data?.strategy) {
        setBackendStrategies((prev) =>
          prev.map((s) => (s.id === id ? res.data.strategy : s))
        );
      }
    } catch (err: any) {
      // Roll back optimistic UI on failure.
      setPausedStrategies((prev) => ({ ...prev, [id]: !isActive }));
      const errorMsg = err.response?.data?.error || err.message || 'Unknown error';
      addMessage({
        id: generateId(),
        type: 'system',
        content: `Failed to ${action} strategy: ${errorMsg}`,
        timestamp: new Date(),
      });
    }
  }, [backendStrategies, addMessage]);

  const handleCancelStrategy = useCallback(async (id: string) => {
    try {
      const res = await axios.post(`${API_URL}/api/strategies/${id}/cancel`);
      if (res.data?.strategy) {
        setBackendStrategies((prev) =>
          prev.map((s) => (s.id === id ? res.data.strategy : s))
        );
      }
      addMessage({
        id: generateId(),
        type: 'system',
        content: `Strategy cancelled. The agent will not execute any further swaps.`,
        timestamp: new Date(),
      });
    } catch (err: any) {
      const errorMsg = err.response?.data?.error || err.message || 'Unknown error';
      addMessage({
        id: generateId(),
        type: 'system',
        content: `Failed to cancel strategy: ${errorMsg}`,
        timestamp: new Date(),
      });
    }
  }, [addMessage]);

  const handleEditStrategy = useCallback((strategy: any) => {
    setActiveNav('chat');
    setTimeout(() => {
      addMessage({
        id: generateId(),
        type: 'user',
        content: `I want to modify my strategy: ${strategy.name}`,
        timestamp: new Date()
      });
      setTimeout(() => {
        addMessage({
          id: generateId(),
          type: 'ai',
          content: `Sure! The current setup is: ${strategy.amount} ${strategy.from} to ${strategy.to} (${strategy.frequency}). What would you like to change?`,
          timestamp: new Date()
        });
      }, 500);
    }, 100);
  }, [addMessage]);

  // Strategies displayed in My Strategies / My Agents are sourced from the
  // backend, which persists them across page reloads. We enrich the backend
  // payload with display-friendly fields and merge it with any "in-flight"
  // local proposals (still pending signature) so the UI feels instant.
  const activeStrategies: Strategy[] = useMemo(() => {
    const backendList: Strategy[] = backendStrategies.map((s) => {
      const tx = s.txParams || {};
      const tokenIn = tx.tokenInSymbol || 'ETH';
      const tokenOut = tx.tokenOutSymbol || 'Asset';
      const amountMatch = (tx.description || '').match(/([\d.]+)\s*(ETH|TSLA|AMZN|NFLX|AMD|PLTR|BTC|AUSD)/i);
      const amountStr = amountMatch ? amountMatch[1] : 'N/A';

      let nextExecution = '—';
      if (s.status === 'active') {
        if (s.nextRunAt && s.nextRunAt > Date.now()) {
          const seconds = Math.max(1, Math.round((s.nextRunAt - Date.now()) / 1000));
          nextExecution = seconds < 60 ? `In ${seconds}s` : `In ${Math.round(seconds / 60)}m`;
        } else {
          nextExecution = 'In Progress...';
        }
      } else if (s.status === 'paused') {
        nextExecution = 'Halted';
      } else if (s.status === 'cancelled') {
        nextExecution = 'Cancelled';
      } else if (s.status === 'completed') {
        nextExecution = 'Finished';
      }

      return {
        id: s.id,
        name: tx.description || `${tokenIn} → ${tokenOut} DCA`,
        from: tokenIn,
        to: tokenOut,
        amount: amountStr,
        frequency: `${s.totalSwaps} Executions (Every ${s.intervalSeconds}s)`,
        status: s.status as Strategy['status'],
        nextExecution,
        completedSwaps: s.completedSwaps,
        totalSwaps: s.totalSwaps,
      };
    });

    // Add any locally-confirmed automated swaps that the backend doesn't yet
    // know about (e.g., race condition between sign success and the polling
    // loop). De-duplicate by id, preferring backend data.
    const knownIds = new Set(backendList.map((s) => s.id));
    const localList: Strategy[] = messages
      .filter(
        (m) =>
          m.transaction &&
          m.transaction.status === 'confirmed' &&
          m.transaction.duration === 'Continuous' &&
          !knownIds.has(m.transaction.id)
      )
      .map((m) => {
        const tx = m.transaction!;
        return {
          id: tx.id,
          name: tx.strategyName,
          from: tx.from.token,
          to: tx.to.token,
          amount: tx.from.amount,
          frequency: tx.frequency,
          status: 'active' as const,
          nextExecution: 'Scheduling...',
        };
      });

    return [...backendList, ...localList];
  }, [backendStrategies, messages]);

  return (
    <div className="bg-cyber-black text-white min-h-screen relative overflow-hidden font-body">
      <img
        src="/assets/fond_chat.png"
        className="fixed inset-0 w-full h-full object-cover opacity-40 pointer-events-none z-0"
        alt="Background"
      />
      <div className="cyber-grid-bg relative z-0" />
      <div className="japanese-pattern relative z-0" />
      <div className="scanlines relative z-10" />
      <div className="noise-overlay relative z-10" />
      <Sidebar
        wallet={wallet}
        agentContract={agentContractState}
        strategies={activeStrategies}
        onConnectWallet={handleConnectWallet}
        onSelectStrategy={() => setActiveNav('strategies')}
        mobileOpen={mobileSidebarOpen}
        onMobileClose={() => setMobileSidebarOpen(false)}
        activeNav={activeNav}
        setActiveNav={setActiveNav}
        onDisconnectWallet={handleDisconnect}
        connectButtonNode={
          <ConnectButton
            client={client}
            chain={robinhoodChain}
            theme="dark"
            wallets={wallets}
            connectButton={{
              className: "w-full bg-green text-white font-display font-semibold text-sm py-2.5 rounded-xl hover:bg-green-hover transition-all duration-200 cursor-pointer !w-full",
            }}
          />
        }
      />

      <div className="lg:ml-[280px] min-h-screen flex flex-col relative z-10">
        <ChatHeader
          onMenuClick={() => setMobileSidebarOpen(true)}
          onClearChat={() => {
            setActiveConversationId(null);
            setMessages([]);
          }}
          onNewStrategy={handleNewStrategy}
          conversations={conversations.map((c) => ({
            id: c.id,
            title: c.title,
            updatedAt: c.updatedAt,
          }))}
          activeConversationId={activeConversationId}
          onSelectConversation={handleSelectConversation}
          onDeleteConversation={handleDeleteConversation}
        />

        {activeNav === 'chat' && (
          <>
            <ChatArea
              messages={messages}
              isThinking={isThinking}
              onSignTransaction={handleSignTransaction}
              onRejectTransaction={handleRejectTransaction}
              onQuickAction={handleSendMessage}
              reasoningSteps={reasoningSteps}
              isReasoningStreaming={isReasoningStreaming}
            />

            <ChatInput
              onSendMessage={handleSendMessage}
              disabled={isThinking}
            />
          </>
        )}

        {activeNav === 'agents' && (
          <AgentWorkspace
            strategies={activeStrategies}
            executions={backendExecutions}
            onPause={handlePauseStrategy}
            onCancel={handleCancelStrategy}
            onAction={handleSendMessage}
          />
        )}

        {activeNav === 'history' && (
          <HistoryArea 
            messages={conversations.flatMap((c) => c.messages)} 
            backendExecutions={backendExecutions} 
            walletAddress={wallet.address} 
          />
        )}

        {activeNav === 'strategies' && (
          <StrategiesArea 
             strategies={activeStrategies} 
             onPause={handlePauseStrategy} 
             onCancel={handleCancelStrategy}
             onEdit={handleEditStrategy} 
          />
        )}

        {activeNav === 'market' && (
          <MarketArea />
        )}
      </div>

      <DeployModal
        isOpen={showDeployModal}
        onClose={() => setShowDeployModal(false)}
        onDeploy={handleDeployContract}
        walletAddress={wallet.address}
      />

      <SignModal
        isOpen={showSignModal}
        transaction={currentTx}
        walletAddress={wallet.address}
        balance={wallet.balance}
        onConfirm={handleConfirmSign}
        onCancel={() => setShowSignModal(false)}
      />
    </div>
  );
}
