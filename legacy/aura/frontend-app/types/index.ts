export interface MacroAnalysis {
  sentiment: string;
  impact: string;
  reasoning: string;
  metrics: {
    volatility: string;
    trend: string;
    correlation: string;
  };
}

export interface TransactionProposal {
  id: string;
  strategyName: string;
  from: { token: string; amount: string };
  to: { token: string };
  frequency: string;
  duration: string;
  gasEstimate: string;
  totalEstimate: string;
  rawData: string;
  txHash?: string;
  confirmedAt?: string;
  status: 'proposed' | 'signed' | 'submitted' | 'confirmed' | 'rejected';
  rationale?: string;
  macroAnalysis?: MacroAnalysis;

  // ── Wave 4: Limit Order extensions ──
  kind?: 'SWAP' | 'LIMIT_ORDER';
  chainId?: number;
  network?: string; // human-readable network name for display
  limitOrder?: {
    asset: string;
    isLong: boolean;
    leverage: number;
    limitPrice: number;
    collateral: number;
  };

  // ── Wave 5: AI Confidence Score ──
  confidenceScore?: number; // 0-100, from Risk Auditor
}

export interface Message {
  id: string;
  type: 'user' | 'ai' | 'system';
  content: string;
  timestamp: Date;
  transaction?: TransactionProposal;
  macroAnalysis?: MacroAnalysis;
  rationale?: string;
  isProactive?: boolean;
  proactiveActions?: string[];
}

export interface ReasoningStep {
  id: string;
  phase: string;
  label: string;
  status: 'pending' | 'active' | 'done';
  detail?: string;
  durationMs?: number;
}

export interface Strategy {
  id: string;
  name: string;
  from: string;
  to: string;
  amount: string;
  frequency: string;
  status: 'active' | 'paused' | 'completed' | 'cancelled';
  nextExecution: string;
  completedSwaps?: number;
  totalSwaps?: number;
}

export interface WalletState {
  connected: boolean;
  address: string;
  balance: string;
}

export interface AgentContract {
  deployed: boolean;
  address: string;
}
