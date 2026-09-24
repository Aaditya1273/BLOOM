import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { Zap } from 'lucide-react';
import type { Message, ReasoningStep } from '@/types';
import TransactionCard from './TransactionCard';
import IntelligenceTrace from '../components/IntelligenceTrace';
import ReasoningTerminal from '../components/ReasoningTerminal';

interface ChatAreaProps {
  messages: Message[];
  isThinking: boolean;
  onSignTransaction: (txId: string) => void;
  onRejectTransaction: (txId: string) => void;
  onQuickAction: (text: string) => void;
  reasoningSteps?: ReasoningStep[];
  isReasoningStreaming?: boolean;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export default function ChatArea({
  messages,
  isThinking,
  onSignTransaction,
  onRejectTransaction,
  onQuickAction,
  reasoningSteps = [],
  isReasoningStreaming = false,
}: ChatAreaProps) {
  const chatEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isThinking, reasoningSteps]);

  useEffect(() => {
    const lastMessage = messages[messages.length - 1];
    if (lastMessage && messageRefs.current[lastMessage.id]) {
      gsap.fromTo(
        messageRefs.current[lastMessage.id],
        { y: 10, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.3, ease: 'power2.out' }
      );
    }
  }, [messages.length]);

  const hasMessages = messages.length > 0;

  const quickActions = [
    'Daily ETH → AMZN',
    'Custom Schedule',
  ];

  return (
    <div
      className="flex-1 overflow-y-auto pt-20 pb-28 px-4"
    >
      <div className="max-w-[720px] mx-auto">
        {!hasMessages ? (
          /* Empty State */
          <div className="flex flex-col items-center justify-center min-h-[60vh]">
            <h2 className="font-mono font-bold text-xl text-white mt-6 text-center uppercase tracking-[0.3em]"
              style={{ textShadow: '0 0 20px rgba(255,255,255,0.3)' }}
            >
              Neural Terminal Ready
            </h2>
            <p className="font-mono text-white text-[10px] mt-3 text-center max-w-[400px] uppercase tracking-widest leading-5">
              Describe a strategy and the swarm will build it for you.
              Example: &quot;Swap 0.0001 ETH to AMZN every day at 9 AM&quot;
            </p>
            <div className="flex flex-wrap gap-2 mt-6 justify-center">
              {quickActions.map((action) => (
                <button
                  key={action}
                  onClick={() => onQuickAction(action)}
                  className="bg-[#00f0ff]/5 border border-[#00f0ff]/30 text-white px-4 py-2 rounded-none font-mono font-bold text-[0.6rem] uppercase tracking-widest hover:bg-[#00f0ff]/15 hover:border-[#00f0ff] hover:shadow-[0_0_15px_rgba(255,255,255,0.2)] transition-all cursor-pointer"
                >
                  {action}
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* Messages */
          <div className="flex flex-col gap-4">
            {messages.map((msg) => (
              <div
                key={msg.id}
                ref={(el) => { messageRefs.current[msg.id] = el; }}
                className={`flex ${
                  msg.type === 'user'
                    ? 'justify-end'
                    : msg.type === 'system'
                      ? 'justify-center'
                      : 'justify-start'
                }`}
              >
                {msg.type === 'ai' && (
                  <div className={`flex gap-3 max-w-[80%] ${msg.isProactive ? 'w-full max-w-[85%]' : ''}`}>
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-[10px] text-white uppercase tracking-widest">
                          Aura Agent
                        </span>
                        {msg.isProactive && (
                          <span className="flex items-center gap-1 px-1.5 py-0.5 bg-[#00f0ff]/10 border border-[#00f0ff]/30 rounded-none">
                            <Zap size={9} className="text-white" />
                            <span className="font-mono text-[0.45rem] text-white font-bold uppercase tracking-wider">Proactive</span>
                          </span>
                        )}
                      </div>
                      <div className={`mt-1 rounded-none px-4 py-3.5 ${
                        msg.isProactive
                          ? 'bg-[#050505] border border-[#00f0ff]/50 shadow-[0_0_15px_rgba(255,255,255,0.1)]'
                          : 'bg-[#050505] border border-[#00f0ff]/20'
                      }`}>
                        <p className="font-mono text-[0.8rem] text-white/80 leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>

                        {/* Proactive action buttons */}
                        {msg.isProactive && msg.proactiveActions && msg.proactiveActions.length > 0 && (
                          <div className="flex flex-wrap gap-2 mt-3 pt-3 border-t border-[#00f0ff]/20">
                            {msg.proactiveActions.map((action) => (
                              <button
                                key={action}
                                onClick={() => action === 'Dismiss' ? undefined : onQuickAction(action)}
                                className={`px-3 py-1.5 rounded-none font-mono font-bold tracking-widest text-[0.6rem] transition-all cursor-pointer border ${
                                  action === 'Dismiss'
                                    ? 'text-white/30 border-white/10 hover:text-white/60 hover:bg-white/5'
                                    : 'bg-[#00f0ff]/10 text-white border-[#00f0ff]/30 hover:bg-[#00f0ff]/20 hover:shadow-[0_0_10px_rgba(255,255,255,0.2)]'
                                }`}
                              >
                                {action}
                              </button>
                            ))}
                          </div>
                        )}

                        <IntelligenceTrace 
                          rationale={msg.rationale || msg.transaction?.rationale} 
                          macroAnalysis={msg.macroAnalysis || msg.transaction?.macroAnalysis} 
                        />

                        {msg.transaction && (
                          <TransactionCard
                            transaction={msg.transaction}
                            onSign={() => onSignTransaction(msg.transaction!.id)}
                            onReject={() => onRejectTransaction(msg.transaction!.id)}
                          />
                        )}
                      </div>
                      <span className="font-mono text-[0.55rem] text-white/20 mt-1 block uppercase tracking-wider">
                        {formatTime(msg.timestamp)}
                      </span>
                    </div>
                  </div>
                )}

                {msg.type === 'user' && (
                  <div className="max-w-[80%]">
                    <div className="bg-[#00f0ff]/10 border border-[#00f0ff]/40 rounded-none px-4 py-3.5 shadow-[0_0_10px_rgba(255,255,255,0.05)]">
                      <p className="font-mono text-[0.8rem] text-white leading-relaxed">
                        {msg.content}
                      </p>
                    </div>
                    <span className="font-mono text-[0.55rem] text-white/20 mt-1 block text-right uppercase tracking-wider">
                      {formatTime(msg.timestamp)}
                    </span>
                  </div>
                )}

                {msg.type === 'system' && (
                  <div className="bg-[#050505] rounded-none px-4 py-2.5 border border-dashed border-[#00f0ff]/20">
                    <p className="font-mono text-[0.6rem] text-white/50 text-center uppercase tracking-widest">
                      {msg.content}
                    </p>
                  </div>
                )}
              </div>
            ))}

            {/* Reasoning Terminal (replaces old thinking dots) */}
            {isThinking && (
              <ReasoningTerminal
                steps={reasoningSteps}
                isStreaming={isReasoningStreaming}
              />
            )}

            <div ref={chatEndRef} />
          </div>
        )}
      </div>
    </div>
  );
}
