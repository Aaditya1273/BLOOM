"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Activity,
  ExternalLink,
  Terminal,
  Shield,
  Brain,
  TrendingUp,
  Lock,
  Zap,
  FileText,
} from "lucide-react";
import Navigation from "@/sections/Navigation";
import Footer from "@/sections/Footer";

const sections = [
  {
    num: "01",
    title: "Agent AI (/chat)",
    icon: Terminal,
    iconColor: "text-neon-cyan",
    glowClass: "cyber-glow-cyan",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          The <strong className="text-neon-cyan">Agent AI Interface</strong> is your conversational copilot for Web3. Instead of navigating complex dashboards to bridge, swap, or analyze tokens, users can express their financial intents in pure natural language.
        </p>
        <p className="text-white/80 leading-relaxed mt-4">
          Powered by a customized Large Language Model combined with LangChain, the Agent deciphers queries like <em>&quot;Swap 100 USDC for TSLA&quot;</em> or <em>&quot;What is the current market sentiment?&quot;</em>. It autonomously prepares transaction calldata, validates it through the Stylus guardrails, and executes it via the Paymaster.
        </p>
      </>
    ),
  },
  {
    num: "02",
    title: "Intelligence Vault (/vault)",
    icon: Brain,
    iconColor: "text-neon-purple",
    glowClass: "cyber-glow-pink",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          The <strong className="text-neon-purple">Intelligence Vault</strong> represents the next evolution of yield generation. Rather than relying on static smart contract logic, this vault is actively managed by an autonomous Multi-Agent Consensus System.
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-purple shadow-[0_0_5px_#b026ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-pink">Macro Analysis:</strong> Constantly monitors real-time market data (RSI, MACD, Pyth Network Oracles) across crypto and tokenized RWA stocks.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-purple shadow-[0_0_5px_#b026ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-pink">Automated Execution:</strong> Automatically rebalances the portfolio (e.g., swapping aUSD to WETH when bullish momentum is detected) using the backend execution pipeline.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    num: "03",
    title: "Pro Trading (/trade)",
    icon: Activity,
    iconColor: "text-neon-green",
    glowClass: "cyber-glow-green",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          The <strong className="text-neon-green">Pro Trading Dashboard</strong> provides an immersive, cyberpunk-themed interface for manual and AI-assisted perpetuals trading.
        </p>
        <p className="text-white/80 leading-relaxed mt-4">
          It features real-time TradingView charts, an interactive order book, and instant execution through the Aura Smart Account. Traders can toggle between Long/Short positions, adjust leverage with zero slippage tolerance, and leverage AI signals directly integrated into the trading view to make informed decisions on both Crypto and Tokenized Stocks.
        </p>
      </>
    ),
  },
  {
    num: "04",
    title: "Stylus-Native Order Book",
    icon: Shield,
    iconColor: "text-neon-pink",
    glowClass: "cyber-glow-pink",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          Aura deploys a <strong className="text-neon-pink">Rust/WASM perpetual order book</strong> on Arbitrum Stylus — the first hackathon project to combine a WASM LOB with a Solidity Vault LP for hybrid execution.
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-pink shadow-[0_0_5px_#ff00a0] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-pink">34% gas savings</strong> on <code>get_active_orders_sorted</code> vs pure Solidity at scale (60 resting orders). Stylus excels on compute-heavy hot paths.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-pink shadow-[0_0_5px_#ff00a0] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-pink">AI Market Maker</strong> places symmetric bid/ask quotes around Pyth mid price. AI Keeper polls Pyth every 10s and calls <code>match_orders</code> to fill triggered limits.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-pink shadow-[0_0_5px_#ff00a0] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-pink">Cross-chain hybrid:</strong> Stylus LOB on Arbitrum Sepolia (compute layer) + AuraPerps on Robinhood Chain (settlement layer). Market orders hit the Vault LP; limit orders rest in the WASM book.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    num: "05",
    title: "Multi-Agent Safety Committee",
    icon: Lock,
    iconColor: "text-neon-orange",
    glowClass: "cyber-glow-cyan",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          Every user intent passes through a <strong className="text-neon-orange">dual-agent safety architecture</strong> before reaching the blockchain:
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-orange shadow-[0_0_5px_#ffae00] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-orange">Executor Agent</strong> (NVIDIA Llama 3.1 70B): translates natural language into precise on-chain calldata — swap routing, DCA scheduling, limit order encoding.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-orange shadow-[0_0_5px_#ffae00] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-orange">Risk Auditor Agent</strong>: independently verifies balances, allowances, slippage, and macro context (Pyth + NewsAPI + correlation matrix) before approving execution.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-orange shadow-[0_0_5px_#ffae00] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              Result: the user sees a single signature prompt with full reasoning visible. If the Auditor rejects, the trade is blocked with an explanation — no silent failures.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    num: "06",
    title: "Why Robinhood Chain?",
    icon: TrendingUp,
    iconColor: "text-neon-yellow",
    glowClass: "cyber-glow-cyan",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          The Robinhood Chain is uniquely positioned to onboard the next million retail users into Web3. Aura is built natively for this ecosystem to provide the &quot;missing link&quot;: an intelligent, gasless copilot that makes interacting with DeFi and Real World Assets (RWAs) as intuitive as using a traditional fintech app.
        </p>
        <p className="text-white/80 leading-relaxed mt-4">
          With Account Abstraction (EIP-4337), users never need to hold ETH for gas. The AuraPaymaster sponsors transactions, and the AuraAccount smart wallet enables batch execution — multiple approvals and swaps in a single signature.
        </p>
      </>
    ),
  },
  {
    num: "07",
    title: "On-Chain Safety Layer (Stylus Guardrail + Audit Trail)",
    icon: Zap,
    iconColor: "text-neon-cyan",
    glowClass: "cyber-glow-cyan",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          Aura deploys a <strong className="text-neon-cyan">second Stylus WASM contract</strong> — the <strong>AuraGuardrail</strong> — as an on-chain safety layer that validates every trade <em>before</em> execution, even if the AI agent is compromised.
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-cyan">5 on-chain checks:</strong> asset whitelist, max leverage (50x), min collateral, max position size, daily volume cap per user — all enforced in WASM at near-zero gas cost.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-cyan">Audit Trail:</strong> Before every gasless execution, the agent records a <code>keccak256</code> hash of its full reasoning (executor + auditor + macro analysis) on-chain via the <code>AuraAuditTrail</code> contract. This creates a verifiable, immutable proof that the AI committee approved the trade.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-cyan">Slippage Protection:</strong> Every swap calculates a <code>minAmountOut</code> from real-time Pyth oracle prices (1% max slippage). No more zero-slippage exploits.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-cyan">Real-time Reasoning Stream:</strong> The multi-agent committee&apos;s decision process is streamed live to the frontend via SSE — users see each step (Intent Parsing → Macro Audit → On-Chain Audit → Consensus) as it happens.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    num: "08",
    title: "MCP Server — Any AI Can Trade (23 Tools)",
    icon: FileText,
    iconColor: "text-neon-green",
    glowClass: "cyber-glow-green",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          Aura exposes a <strong className="text-neon-green">Model Context Protocol (MCP) server</strong> so any AI agent — Claude, ChatGPT, Cursor, Kiro, or custom agents — can connect and trade perpetuals, swap tokens, manage positions, and analyze markets by simply adding a URL.
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_5px_#39ff14] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-green">24 tools exposed:</strong> get_price, get_orderbook, place_limit_order, get_limit_orders, place_market_order, get_positions, close_position, get_account_balance, set_stop_loss_take_profit, add_margin, get_market_analysis, get_funding_rate, partial_close, dca_order, cancel_dca, schedule_swap, get_audit_trail, get_pnl_summary, get_liquidation_price, get_supported_assets, cancel_limit_order, swap, deposit_vault, authenticate.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_5px_#39ff14] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-green">Delegation model:</strong> Users authorize the MCP agent via <code>setAiAgent()</code> on their AuraAccount. No private key is ever exposed. Revocable at any time. Per-user API keys for authenticated trading.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_5px_#39ff14] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-green">On-chain audit trail:</strong> Every trade executed via MCP automatically records a reasoning hash + AI confidence score (0-100) on-chain in the AuraAuditTrail contract — verifiable proof of AI decision-making.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_5px_#39ff14] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-green">Multi-transport:</strong> SSE (Claude Code, Cursor) + Streamable HTTP (Claude.ai web, ChatGPT) — compatible with all major AI platforms.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-green shadow-[0_0_5px_#39ff14] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-green">No other DeFi project has this.</strong> The most complete DeFi MCP server ever built. Any AI in the world can read our Stylus order book, execute trades, manage risk, and earn yield via a single URL endpoint.
            </span>
          </li>
        </ul>
      </>
    ),
  },
  {
    num: "09",
    title: "Decoupled Architecture (Relayer vs Vault)",
    icon: Shield,
    iconColor: "text-neon-cyan",
    glowClass: "cyber-glow-cyan",
    content: (
      <>
        <p className="text-white/80 leading-relaxed">
          Aura enforces strict separation of concerns at the private key level to eliminate nonce collisions and secure the autonomous trading loop.
        </p>
        <ul className="mt-4 space-y-3">
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-cyan">Dedicated Chat Wallet:</strong> The AI Agent MCP and the gasless relayer operate on a separate wallet (the Chat Wallet) authorized via <code>setAiAgent</code> on the AuraAccount. This ensures AI intents never conflict with core protocol execution.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <div className="w-1.5 h-1.5 rounded-full bg-neon-cyan shadow-[0_0_5px_#00f0ff] mt-2 shrink-0" />
            <span className="text-white/80 leading-relaxed">
              <strong className="text-neon-cyan">Router-Level Abstraction:</strong> Swaps are executed through the Synthra V3 Router, shielding the Vault LP from direct external calls. The Agent only interacts with the router.
            </span>
          </li>
        </ul>
      </>
    ),
  },
];

const contracts = [
  {
    name: "Stylus LOB v2 (Rust/WASM)",
    address: "0x3346abe000118b25aca953f48deb1978a069e7de",
    chain: "Arbitrum Sepolia",
    explorer: "https://sepolia.arbiscan.io/address/",
  },
  {
    name: "AuraCrossChainEscrow (Stylus)",
    address: "0x19147627a4b6b0b803b097d3c6216c3351d4913e",
    chain: "Arbitrum Sepolia",
    explorer: "https://sepolia.arbiscan.io/address/",
  },
  {
    name: "AuraCopyTrading V2",
    address: "0xd879DcfE7e62a1aD5877A006322A5EaF87E31ce8",
    chain: "Robinhood Chain",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/",
  },
  {
    name: "AuraPerps (Perpetuals Engine)",
    address: "0x23aEa07e298d16b00d59c22c865065Be61edAa55",
    chain: "Robinhood Chain",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/",
  },
  {
    name: "AuraPerpsRouter (Hybrid LOB+AMM)",
    address: "0x35650De9a304BB4eE9A0c23F2bcf0D9E71F7cDe3",
    chain: "Robinhood Chain",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/",
  },
  {
    name: "AuraIntelligenceVault (ERC-4626)",
    address: "0x789b90ebAabC68858e9DEaAE8197793d582c66cb",
    chain: "Robinhood Chain",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/",
  },
  {
    name: "AuraAccount Factory (EIP-4337)",
    address: "0x95Aa20d53EB26f292a71D8B38515BBeC8905b550",
    chain: "Robinhood Chain",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/",
  },
  {
    name: "aUSD (Stablecoin)",
    address: "0x359961489f069F16E5dbA46d9b174bBF7b25147B",
    chain: "Robinhood Chain",
    explorer: "https://explorer.testnet.chain.robinhood.com/address/",
  },
];

export default function Whitepaper() {
  const router = useRouter();
  return (
    <div className="bg-cyber-black text-white min-h-screen relative overflow-hidden font-body selection:bg-neon-cyan selection:text-cyber-black">
      {/* Background effects */}
      <video
        autoPlay
        loop
        muted
        playsInline
        className="fixed inset-0 w-full h-full object-cover opacity-20 pointer-events-none z-0"
      >
        <source src="/assets/cyber_wallpaper.mp4" type="video/mp4" />
      </video>
      <div className="cyber-grid-bg relative z-0" />
      <div className="scanlines relative z-10" />
      <div className="noise-overlay relative z-10" />

      <Navigation onNavigate={() => router.push('/')} />

      <main className="relative z-10 pt-32 pb-24 px-4 sm:px-6 lg:px-8">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="max-w-4xl mx-auto mb-16"
        >
          <div className="glass-card-cyber cyber-border p-8 md:p-12 text-center">
            <h1
              className="font-display text-5xl md:text-7xl font-bold glitch-text cyber-glow-cyan mb-4"
              data-text="AURA WHITEPAPER"
            >
              AURA WHITEPAPER
            </h1>
            <p className="font-mono-label text-neon-pink tracking-widest uppercase text-sm mb-4">
              CLASSIFIED DOCUMENT // v1.0 // ROBINHOOD CHAIN
            </p>
            <p className="text-white/60 text-lg md:text-xl max-w-2xl mx-auto">
              The Agentic Wealth Layer for the Robinhood Chain.
            </p>
          </div>
        </motion.div>

        {/* Content sections */}
        <div className="max-w-4xl mx-auto">
          {sections.map((section, index) => {
            const Icon = section.icon;
            return (
              <motion.section
                key={section.num}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="glass-card-cyber cyber-border p-6 md:p-8 mb-6 rounded-xl relative overflow-hidden"
              >
                {/* Section number watermark */}
                <span className="absolute top-2 right-4 text-6xl font-mono opacity-10 select-none pointer-events-none">
                  {section.num}
                </span>

                <div className="relative z-10">
                  <div className="flex items-center gap-3 mb-4">
                    <Icon className={`w-6 h-6 ${section.iconColor}`} />
                    <h2
                      className={`text-xl md:text-2xl font-display font-bold text-white ${section.glowClass}`}
                    >
                      {section.num}. {section.title}
                    </h2>
                  </div>
                  <div className="text-white/80">{section.content}</div>
                </div>
              </motion.section>
            );
          })}

          {/* Terminal Deployment Addresses */}
          <motion.section
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.6 }}
            className="bg-black/80 border border-neon-green/30 rounded-xl overflow-hidden shadow-[0_0_30px_rgba(57,255,20,0.1)] mb-6"
          >
            {/* Terminal header */}
            <div className="flex items-center justify-between px-4 py-3 bg-black/60 border-b border-neon-green/20">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <div className="w-3 h-3 rounded-full bg-green-500" />
              </div>
              <div className="flex items-center gap-2 text-neon-green font-mono-label text-xs tracking-wider">
                <Terminal className="w-4 h-4" />
                <span>ROOT ACCESS // DEPLOYMENT MANIFEST</span>
              </div>
              <div className="w-16" />
            </div>

            {/* Terminal body */}
            <div className="p-6 font-mono-label text-sm">
              <div className="flex flex-col sm:flex-row sm:items-center gap-4 sm:gap-8">
                <div>
                  <span className="text-white/40">Network:</span>{" "}
                  <span className="text-neon-green">Robinhood Chain + Arbitrum Sepolia</span>
                </div>
                <div>
                  <span className="text-white/40">Chain IDs:</span>{" "}
                  <span className="text-neon-green">46630 / 421614</span>
                </div>
              </div>

              <div className="border-t border-neon-green/20 my-4" />

              <div className="space-y-4">
                {contracts.map((contract) => (
                  <div key={contract.address}>
                    <div className="text-white/60">
                      {`> Contract: `}
                      <span className="text-white">{contract.name}</span>
                    </div>
                    <div className="pl-4 text-white/60">
                      {`Chain: `}
                      <span className="text-neon-cyan">{contract.chain}</span>
                    </div>
                    <div className="pl-4 text-white/60">
                      {`Address: `}
                      <span className="text-neon-green shadow-[0_0_8px_rgba(57,255,20,0.3)]">
                        {contract.address}
                      </span>
                    </div>
                    <div className="pl-4 text-white/60">
                      {`Status: `}
                      <span className="text-neon-green">[DEPLOYED]</span>
                    </div>
                    <div className="pl-4 mt-1">
                      <a
                        href={`${contract.explorer}${contract.address}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-neon-green/60 hover:text-neon-green transition-colors text-xs"
                      >
                        <ExternalLink size={12} />
                        View on Explorer
                      </a>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 text-neon-green/40">
                {`> End of manifest`}
                <span className="inline-block w-2 h-4 bg-neon-green animate-pulse ml-1" />
              </div>
            </div>
          </motion.section>

          {/* Technical Submission Details */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.7 }}
            className="bg-neon-green/5 border border-neon-green/20 rounded-xl p-6"
          >
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-5 h-5 text-neon-green" />
              <h3 className="font-display font-bold text-neon-green tracking-wide uppercase text-sm">
                Technical Specifications
              </h3>
            </div>
            <p className="text-sm text-neon-green/80 leading-relaxed">
              Deployed natively on the Robinhood Testnet + Arbitrum Sepolia. 265 passing tests (adversarial, fuzz, invariant). 23 MCP tools. 34% gas savings (Stylus). Leveraging Account Abstraction (EIP-4337), LangChain Multi-Agent frameworks, Pyth Network oracles, and Arbitrum Stylus (Rust/WASM) for on-chain risk management.
            </p>
          </motion.div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
