import { useEffect, useRef, useState } from 'react';
import { Menu, Trash2, Plus, History, X } from 'lucide-react';

interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: number;
}

interface ChatHeaderProps {
  onMenuClick: () => void;
  onClearChat: () => void;
  onNewStrategy: () => void;
  conversations?: ConversationSummary[];
  activeConversationId?: string | null;
  onSelectConversation?: (id: string) => void;
  onDeleteConversation?: (id: string) => void;
}

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export default function ChatHeader({
  onMenuClick,
  onClearChat,
  onNewStrategy,
  conversations = [],
  activeConversationId = null,
  onSelectConversation,
  onDeleteConversation,
}: ChatHeaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!historyOpen) return;
    const onDocClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [historyOpen]);

  const sortedConversations = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <header className="fixed top-0 left-0 lg:left-[280px] right-0 h-16 z-30 flex items-center justify-between px-4 lg:px-6 bg-[#050505] border-b border-[#00f0ff]/40"
      style={{
        boxShadow: '0 4px 20px rgba(255,255,255,0.05)'
      }}
    >
      {/* Left */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuClick}
          className="lg:hidden p-2 text-white/60 hover:text-white transition-colors cursor-pointer"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] text-white/40 tracking-widest uppercase">&gt;_</span>
          <h1 className="font-mono font-bold text-sm text-white uppercase tracking-[0.2em]">
            Neural_Terminal
          </h1>
          <span className="font-kanji text-xs text-white/30 ml-1">チャット</span>
        </div>
      </div>

      {/* Center - Agent Status */}
      <div className="hidden sm:flex items-center gap-2 border border-[#00f0ff]/20 bg-[#00f0ff]/5 px-3 py-1.5">
        <span className="font-mono text-[10px] text-white/70 tracking-widest uppercase">Aura AI</span>
        <span
          className="w-1.5 h-1.5 rounded-none bg-[#00f0ff]"
          style={{ animation: 'pulse-dot 2s infinite', boxShadow: '0 0 8px rgba(255,255,255,0.5)' }}
        />
      </div>

      {/* Right */}
      <div className="flex items-center gap-2">
        {/* History dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setHistoryOpen((v) => !v)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-white/60 hover:text-white border border-[#00f0ff]/20 hover:border-[#00f0ff]/60 hover:bg-[#00f0ff]/5 transition-all cursor-pointer font-mono text-[10px] uppercase tracking-widest"
            title="Conversation history"
          >
            <History size={12} />
            <span className="hidden sm:inline">History</span>
            {sortedConversations.length > 0 && (
              <span className="ml-1 text-[#00f0ff] font-bold">{sortedConversations.length}</span>
            )}
          </button>

          {historyOpen && (
            <div
              className="absolute right-0 mt-2 w-80 max-h-[420px] overflow-y-auto bg-[#050505] border border-[#00f0ff]/40 shadow-[0_0_20px_rgba(0,240,255,0.1)] z-40"
            >
              <div className="sticky top-0 bg-[#050505] border-b border-[#00f0ff]/20 px-3 py-2 flex items-center justify-between">
                <span className="font-mono text-[10px] text-white/70 uppercase tracking-widest">
                  Chat History
                </span>
                <button
                  onClick={() => setHistoryOpen(false)}
                  className="text-white/40 hover:text-white transition-colors cursor-pointer"
                >
                  <X size={12} />
                </button>
              </div>
              {sortedConversations.length === 0 ? (
                <div className="px-3 py-6 text-center font-mono text-[10px] text-white/40 uppercase tracking-widest">
                  No saved conversations yet
                </div>
              ) : (
                <ul className="divide-y divide-[#00f0ff]/10">
                  {sortedConversations.map((c) => {
                    const isActive = c.id === activeConversationId;
                    return (
                      <li
                        key={c.id}
                        className={`group px-3 py-2 hover:bg-[#00f0ff]/5 cursor-pointer transition-colors ${
                          isActive ? 'bg-[#00f0ff]/10 border-l-2 border-[#00f0ff]' : ''
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <button
                            onClick={() => {
                              onSelectConversation?.(c.id);
                              setHistoryOpen(false);
                            }}
                            className="flex-1 text-left cursor-pointer"
                          >
                            <p className="font-mono text-[11px] text-white/90 leading-snug truncate">
                              {c.title || 'Untitled'}
                            </p>
                            <p className="font-mono text-[9px] text-white/40 mt-0.5 uppercase tracking-widest">
                              {formatRelative(c.updatedAt)}
                            </p>
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteConversation?.(c.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-red-400 transition-all cursor-pointer p-1"
                            title="Delete conversation"
                          >
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </div>

        <button
          onClick={onClearChat}
          className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-white/30 hover:text-white/70 transition-colors cursor-pointer font-mono text-[10px] uppercase tracking-widest"
        >
          <Trash2 size={12} />
          <span>Clear</span>
        </button>
        <button
          onClick={onNewStrategy}
          className="flex items-center gap-1.5 bg-[#00f0ff]/10 text-white px-3 py-1.5 rounded-none font-mono font-bold text-[10px] hover:bg-[#00f0ff]/20 border border-[#00f0ff] transition-all cursor-pointer uppercase tracking-widest hover:shadow-[0_0_15px_rgba(255,255,255,0.2)]"
        >
          <Plus size={12} />
          New Strategy
        </button>
      </div>
    </header>
  );
}
