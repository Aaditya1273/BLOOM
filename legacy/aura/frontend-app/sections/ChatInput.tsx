import { useState, useRef, useCallback } from 'react';
import { ArrowUp, Mic } from 'lucide-react';

interface ChatInputProps {
  onSendMessage: (text: string) => void;
  disabled?: boolean;
}

export default function ChatInput({ onSendMessage, disabled }: ChatInputProps) {
  const [input, setInput] = useState('');
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<any>(null);

  const toggleListening = useCallback(() => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return alert('Speech recognition not supported in this browser.');
    const recognition = new SpeechRecognition();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setInput((prev) => (prev ? prev + ' ' + transcript : transcript));
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  }, [listening]);

  const handleSend = () => {
    if (!input.trim() || disabled) return;
    onSendMessage(input.trim());
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const quickAdds = ['+ Daily ETH→AMZN', '+ Custom'];

  return (
    <div
      className="fixed bottom-0 left-0 lg:left-[280px] right-0 z-30 bg-[#050505] border-t border-[#00f0ff]/40"
      style={{
        boxShadow: '0 -4px 20px rgba(255,255,255,0.05)'
      }}
    >
      {/* Quick Adds */}
      <div className="max-w-[720px] mx-auto px-4 pt-2 flex gap-2 overflow-x-auto">
        {quickAdds.map((item) => (
          <button
            key={item}
            onClick={() => onSendMessage(item.replace('+ ', ''))}
            className="shrink-0 bg-[#00f0ff]/5 text-white border border-[#00f0ff]/30 px-3 py-1 rounded-none font-mono text-[0.6rem] uppercase tracking-widest hover:bg-[#00f0ff]/15 hover:border-[#00f0ff] hover:shadow-[0_0_10px_rgba(255,255,255,0.2)] transition-all cursor-pointer"
          >
            {item}
          </button>
        ))}
      </div>

      {/* Input Row */}
      <div className="max-w-[720px] mx-auto px-4 py-3 flex items-center gap-3">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="ENTER NEURAL PROMPT..."
          disabled={disabled}
          className="flex-1 bg-[#050505] border border-[#00f0ff]/30 rounded-none px-4 py-3 font-mono text-[0.8rem] text-white placeholder:text-white/15 focus:outline-none focus:border-[#00f0ff] focus:shadow-[0_0_15px_rgba(255,255,255,0.15)] transition-all"
        />

        <button
          onClick={toggleListening}
          disabled={disabled}
          className={`p-2.5 rounded-none transition-all duration-300 shrink-0 cursor-pointer flex items-center justify-center border ${
            listening
              ? 'bg-red-500/20 text-red-400 border-red-500 animate-pulse'
              : 'bg-white/5 text-white/40 border-white/10 hover:border-[#00f0ff] hover:text-white'
          }`}
          title={listening ? 'Stop listening' : 'Voice input'}
        >
          <Mic size={16} />
        </button>

        <button
          onClick={handleSend}
          disabled={!input.trim() || disabled}
          className={`p-2.5 rounded-none transition-all duration-300 shrink-0 cursor-pointer flex items-center justify-center border ${
            input.trim() && !disabled
              ? 'bg-[#00f0ff]/10 text-white border-[#00f0ff] hover:bg-[#00f0ff]/20 hover:shadow-[0_0_20px_rgba(255,255,255,0.3)]'
              : 'bg-white/5 text-white/15 border-white/10'
          }`}
        >
          <ArrowUp size={16} />
        </button>
      </div>
    </div>
  );
}
