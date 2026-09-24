import { useState, useEffect } from 'react';
import {
  MessageSquare,
  Briefcase,
  History,
  Settings,
  X,
  BarChart3,
  Bot,
  Home as HomeIcon,
  LogOut,
} from 'lucide-react';
import Link from 'next/link';
import type { WalletState, AgentContract, Strategy } from '@/types';
import MarketSentimentWidget from './MarketSentimentWidget';

interface SidebarProps {
  wallet: WalletState;
  agentContract: AgentContract;
  strategies: Strategy[];
  onConnectWallet: () => void;
  onSelectStrategy: (strategy: Strategy) => void;
  mobileOpen: boolean;
  onMobileClose: () => void;
  connectButtonNode?: React.ReactNode;
  activeNav: string;
  setActiveNav: (nav: string) => void;
  onDisconnectWallet?: () => void;
}

export default function Sidebar({
  wallet,
  agentContract,
  strategies,
  onConnectWallet,
  onSelectStrategy,
  mobileOpen,
  onMobileClose,
  connectButtonNode,
  activeNav,
  setActiveNav,
  onDisconnectWallet,
}: SidebarProps) {

  const [portfolio, setPortfolio] = useState<{ symbol: string, percentage: number, color: string }[]>([]);
  const [totalUsd, setTotalUsd] = useState<number>(0);

  useEffect(() => {
    if (!wallet.connected || !wallet.address) return;
    
    async function fetchPortfolio() {
      try {
        const res = await fetch(`https://explorer.testnet.chain.robinhood.com/api/v2/addresses/${wallet.address}/token-balances`);
        const data = await res.json();
        
        // Mock prices for demo purposes (as testnet API doesn't return real exchange rates)
        const mockPrices: Record<string, number> = {
          ETH: 3100,
          WETH: 3100,
          AMZN: 185,
          TSLA: 175,
          AMD: 160,
          NFLX: 600,
          PLTR: 22,
        };

        let totalValue = 0;
        let usdCalc = 0;

        const balances = data.map((item: any) => {
          if (item.token.symbol === "ivAUSD" || item.token.name === "Aura Intelligence Vault Share") {
            return null;
          }
          const amount = parseFloat(item.value) / Math.pow(10, parseInt(item.token.decimals || "18"));
          totalValue += amount;
          
          const price = mockPrices[item.token.symbol] || 1;
          usdCalc += amount * price;

          return { symbol: item.token.symbol, amount, usdValue: amount * price };
        }).filter((b: any) => b && b.amount > 0);
        
        const ethAmount = parseFloat(wallet.balance.split(' ')[0]) || 0;
        if (ethAmount > 0) {
           balances.push({ symbol: 'ETH', amount: ethAmount, usdValue: ethAmount * mockPrices.ETH });
           totalValue += ethAmount;
           usdCalc += ethAmount * mockPrices.ETH;
        }
        
        if (totalValue === 0) {
            setTotalUsd(0);
            return;
        }

        setTotalUsd(usdCalc);
        
        const colors = ['bg-[#00f0ff]', 'bg-[#00f0ff]/70', 'bg-[#00f0ff]/50', 'bg-[#00f0ff]/30'];
        
        // Sort by USD value for better representation
        balances.sort((a: any, b: any) => b.usdValue - a.usdValue);
        
        const breakdown = balances.slice(0, 4).map((b: any, index: number) => ({
          symbol: b.symbol,
          percentage: Math.round((b.usdValue / usdCalc) * 100),
          color: colors[index % colors.length]
        }));
        
        setPortfolio(breakdown);
      } catch (e) {
        console.error("Portfolio fetch failed", e);
        const mockBreakdown = [
          { symbol: 'ETH', percentage: 45, color: 'bg-[#00f0ff]' },
          { symbol: 'AMZN', percentage: 30, color: 'bg-[#00f0ff]/70' },
          { symbol: 'TSLA', percentage: 25, color: 'bg-[#00f0ff]/50' }
        ];
        setPortfolio(mockBreakdown);
        setTotalUsd(12450);
      }
    }
    
    fetchPortfolio();
    const interval = setInterval(fetchPortfolio, 15000);
    return () => clearInterval(interval);
  }, [wallet.connected, wallet.address, wallet.balance]);


  const navItems = [
    { id: 'chat', label: 'Chat', icon: MessageSquare },
    { id: 'agents', label: 'My Agents', icon: Bot },
    { id: 'market', label: 'Market', icon: BarChart3 },
    { id: 'strategies', label: 'My Strategies', icon: Briefcase },
    { id: 'history', label: 'Transaction History', icon: History },
  ];

  const sidebarContent = (
    <div className="h-full flex flex-col">
      {/* Logo */}
      <div className="px-5 pt-5 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="font-mono font-bold text-sm text-white uppercase tracking-[0.2em]">
            Aura AI
          </span>
        </div>
        <div className="flex items-center gap-1.5 mt-2">
          <span
            className="w-2 h-2 rounded-none bg-[#00f0ff]"
            style={{ animation: 'pulse-dot 2s infinite', boxShadow: '0 0 8px rgba(255,255,255,0.5)' }}
          />
          <span className="font-mono text-[0.6rem] text-white/70 uppercase tracking-widest">
            {agentContract.deployed ? '[ AGENT ONLINE ]' : '[ AGENT OFFLINE ]'}
          </span>
        </div>
      </div>

      {/* Wallet Section */}
      <div className="px-5 py-4 border-t border-[#00f0ff]/20 flex items-center justify-center min-h-[80px]" id="thirdweb-connect-container">
        {!wallet.connected ? (
          <div className="w-full flex justify-center">
            {connectButtonNode || (
              <button
                onClick={onConnectWallet}
                className="w-full bg-[#00f0ff]/10 text-white font-mono font-bold text-xs py-2.5 rounded-none border border-[#00f0ff] hover:bg-[#00f0ff]/20 transition-all duration-200 cursor-pointer uppercase tracking-widest"
              >
                Connect Wallet
              </button>
            )}
          </div>
        ) : (
          <div className="w-full">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-white/80 truncate">
                  {wallet.address.slice(0, 6)}...{wallet.address.slice(-4)}
                </span>
                <span className="font-mono text-[0.55rem] text-white bg-[#00f0ff]/10 border border-[#00f0ff]/30 px-2 py-0.5 rounded-none uppercase tracking-wider">
                  Robinhood
                </span>
              </div>
              {onDisconnectWallet && (
                <button onClick={onDisconnectWallet} className="text-white/40 hover:text-white transition-colors cursor-pointer" title="Disconnect">
                  <LogOut size={14} />
                </button>
              )}
            </div>
            <p className="font-mono font-bold text-white text-base mt-1 tracking-wider">
              {wallet.balance}
            </p>
          </div>
        )}
      </div>

      {/* Navigation */}
      <nav className="px-3 py-3 flex flex-col gap-0.5">
        <Link
          href="/"
          className="flex items-center gap-3 px-4 py-2.5 rounded-none transition-all duration-200 cursor-pointer text-white/40 hover:text-white hover:bg-[#00f0ff]/5 font-mono text-xs uppercase tracking-widest"
        >
          <HomeIcon size={14} />
          <span>Return Home</span>
        </Link>
        <div className="h-px w-full bg-[#00f0ff]/10 my-1" />
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id;
          return (
            <button
              key={item.id}
              onClick={() => setActiveNav(item.id)}
              className={`flex items-center gap-3 px-4 py-2.5 rounded-none transition-all duration-200 cursor-pointer font-mono text-xs uppercase tracking-widest ${
                isActive
                  ? 'bg-[#00f0ff]/10 text-white border-l-2 border-[#00f0ff] shadow-[inset_0_0_15px_rgba(255,255,255,0.05)]'
                  : 'text-white/40 hover:text-white hover:bg-[#00f0ff]/5'
              }`}
            >
              <Icon size={14} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Portfolio Summary */}
      {wallet.connected && portfolio.length > 0 && (
        <div className="px-5 py-4 border-t border-[#00f0ff]/20">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[0.6rem] text-white/40 uppercase tracking-widest">
              Portfolio
            </span>
            <span className="font-mono text-[0.55rem] text-white border border-[#00f0ff]/30 bg-[#00f0ff]/10 px-1.5 py-0.5 rounded-none uppercase tracking-wider">Live</span>
          </div>
          <p className="font-mono font-bold text-white text-xl mt-1 tracking-wider">
            ${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </p>
          <div className="flex h-1 overflow-hidden mt-4 border border-[#00f0ff]/20">
            {portfolio.map((p, idx) => (
              <div key={`bar-${p.symbol}-${idx}`} className={`${p.color}`} style={{ width: `${p.percentage}%` }} />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-1.5 mt-3">
            {portfolio.map((p, idx) => (
              <span key={`legend-${p.symbol}-${idx}`} className="font-mono text-[0.55rem] text-white/50 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-none ${p.color}`} />
                {p.symbol} {p.percentage}%
              </span>
            ))}
          </div>
        </div>
      )}
      {/* Market Pulse Widget - Always visible */}
      <MarketSentimentWidget />



      {/* Active Strategies */}
      {strategies.length > 0 && (
        <div className="px-5 py-4 border-t border-[#00f0ff]/20 flex-1 overflow-y-auto">
          <span className="font-mono text-[0.6rem] text-white/40 uppercase tracking-widest">
            Active Strategies
          </span>
          <div className="flex flex-col gap-2 mt-3">
            {strategies.map((strategy) => (
              <button
                key={strategy.id}
                onClick={() => onSelectStrategy(strategy)}
                className="bg-[#050505] border border-[#00f0ff]/20 rounded-none p-3 text-left hover:border-[#00f0ff]/60 hover:bg-[#00f0ff]/5 hover:shadow-[0_0_10px_rgba(255,255,255,0.1)] transition-all cursor-pointer"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono font-medium text-xs text-white uppercase tracking-wider">
                    {strategy.name}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-1.5 h-1.5 rounded-none bg-[#00f0ff]" style={{ boxShadow: '0 0 6px rgba(255,255,255,0.5)' }} />
                    <span className="font-mono text-[0.55rem] text-white uppercase tracking-wider">
                      Active
                    </span>
                  </span>
                </div>
                <p className="font-mono text-[0.6rem] text-white/40 mt-1">
                  {strategy.amount} {strategy.from} → {strategy.to} /{' '}
                  {strategy.frequency}
                </p>
                <p className="font-mono text-[0.55rem] text-white/60 mt-1">
                  Next: {strategy.nextExecution}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="px-5 py-3 border-t border-[#00f0ff]/10">
        <span className="font-mono text-[0.55rem] text-white/20 uppercase tracking-widest">
          [ SYS.v1.0.0 ]
        </span>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden lg:block w-[280px] min-h-screen bg-[#050505] border-r border-[#00f0ff]/30 fixed left-0 top-0 z-40">
        {sidebarContent}
      </aside>

      {/* Mobile Sidebar Drawer */}
      <div
        className={`lg:hidden fixed inset-0 z-[60] transition-opacity duration-300 ${
          mobileOpen ? 'opacity-100 visible' : 'opacity-0 invisible'
        }`}
      >
        <div
          className="absolute inset-0 bg-black/80 backdrop-blur-sm"
          onClick={onMobileClose}
        />
        <div
          className={`absolute left-0 top-0 bottom-0 w-[280px] bg-[#050505] border-r border-[#00f0ff]/30 transform transition-transform duration-300 ${
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <button
            onClick={onMobileClose}
            className="absolute top-4 right-4 text-white/40 hover:text-white cursor-pointer"
          >
            <X size={20} />
          </button>
          {sidebarContent}
        </div>
      </div>
    </>
  );
}
