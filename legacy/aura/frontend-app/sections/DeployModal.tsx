import { useState, useEffect } from 'react';
import { X, Shield, Fuel, FileCheck } from 'lucide-react';

interface DeployModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDeploy: () => void;
  walletAddress: string;
}

type DeployStep = {
  label: string;
  status: 'pending' | 'loading' | 'done';
};

export default function DeployModal({ isOpen, onClose, onDeploy, walletAddress }: DeployModalProps) {
  const [deploying, setDeploying] = useState(false);
  const [steps, setSteps] = useState<DeployStep[]>([
    { label: 'Compiling contract...', status: 'pending' },
    { label: 'Waiting for signature...', status: 'pending' },
    { label: 'Deploying to Robinhood Chain...', status: 'pending' },
    { label: 'Agent ready!', status: 'pending' },
  ]);

  useEffect(() => {
    if (!isOpen) {
      setDeploying(false);
      setSteps([
        { label: 'Compiling contract...', status: 'pending' },
        { label: 'Waiting for signature...', status: 'pending' },
        { label: 'Deploying to Robinhood Chain...', status: 'pending' },
        { label: 'Agent ready!', status: 'pending' },
      ]);
    }
  }, [isOpen]);

  const handleDeploy = () => {
    setDeploying(true);
    onDeploy();

    setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => (i === 0 ? { ...s, status: 'done' } : s)));
    }, 800);
    setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => (i === 1 ? { ...s, status: 'done' } : s)));
    }, 1800);
    setTimeout(() => {
      setSteps((prev) => prev.map((s, i) => (i === 2 ? { ...s, status: 'loading' } : s)));
    }, 2500);
    setTimeout(() => {
      setSteps((prev) =>
        prev.map((s, i) =>
          i === 2 ? { ...s, status: 'done' } : i === 3 ? { ...s, status: 'done' } : s
        )
      );
    }, 4500);
    setTimeout(() => {
      onClose();
    }, 5200);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={deploying ? undefined : onClose}
      />
      <div className="relative bg-[#050505] border border-[#00f0ff]/40 rounded-none p-8 max-w-[480px] w-[90%] mx-4 shadow-[0_0_30px_rgba(0,240,255,0.1)]"
        style={{ animation: 'fadeInScale 0.4s ease-out' }}
      >
        {!deploying && (
          <button
            onClick={onClose}
            className="absolute top-4 right-4 text-white/30 hover:text-[#00f0ff] transition-colors cursor-pointer"
          >
            <X size={20} />
          </button>
        )}

        <div className="flex flex-col items-center">
          <img
            src="/assets/ai-mascot-chat.png"
            alt="DCA Agent"
            className="w-20 h-20 object-contain drop-shadow-[0_0_20px_rgba(0,240,255,0.3)]"
            style={{ animation: 'float 4s ease-in-out infinite' }}
          />

          <h2 className="font-mono font-bold text-xl text-[#00f0ff] mt-4 text-center uppercase tracking-[0.2em]"
            style={{ textShadow: '0 0 15px rgba(0,240,255,0.3)' }}
          >
            Deploy Agent
          </h2>

          <p className="font-mono text-[0.7rem] text-white/40 text-center mt-3 leading-5 uppercase tracking-wider">
            Deploy your personal AI wealth management smart contract before executing strategies.
          </p>

          {!deploying ? (
            <>
              {/* Info Cards */}
              <div className="w-full flex flex-col gap-3 mt-6">
                <div className="bg-[#00f0ff]/5 border border-[#00f0ff]/20 rounded-none p-3 flex items-start gap-3">
                  <Shield size={16} className="text-[#00f0ff] shrink-0 mt-0.5" />
                  <p className="font-mono text-[0.65rem] text-white/50">
                    <strong className="text-white/80">Non-Custodial</strong> — Your funds never leave your wallet. The agent only signs transactions you approve.
                  </p>
                </div>
                <div className="bg-[#00f0ff]/5 border border-[#00f0ff]/20 rounded-none p-3 flex items-start gap-3">
                  <Fuel size={16} className="text-[#00f0ff] shrink-0 mt-0.5" />
                  <p className="font-mono text-[0.65rem] text-white/50">
                    <strong className="text-white/80">Gas Costs</strong> — One-time deployment gas fee (~$5-10). Strategy executions have minimal gas.
                  </p>
                </div>
                <div className="bg-[#00f0ff]/5 border border-[#00f0ff]/20 rounded-none p-3 flex items-start gap-3">
                  <FileCheck size={16} className="text-[#00f0ff] shrink-0 mt-0.5" />
                  <p className="font-mono text-[0.65rem] text-white/50">
                    <strong className="text-white/80">Audited</strong> — Contract audited by CertiK. Open source on GitHub.
                  </p>
                </div>
              </div>

              {/* Wallet Info */}
              {walletAddress && (
                <div className="w-full mt-4 p-3 bg-[#00f0ff]/5 border border-[#00f0ff]/20 rounded-none">
                  <span className="font-mono text-[0.55rem] text-white/30 uppercase tracking-widest">Deploying as</span>
                  <p className="font-mono text-xs text-[#00f0ff] mt-1 truncate">
                    {walletAddress}
                  </p>
                </div>
              )}

              {/* Deploy Button */}
              <button
                onClick={handleDeploy}
                className="w-full mt-6 bg-[#00f0ff]/10 text-[#00f0ff] border border-[#00f0ff] font-mono font-bold text-sm py-3.5 rounded-none hover:bg-[#00f0ff]/20 hover:shadow-[0_0_20px_rgba(0,240,255,0.3)] transition-all duration-200 cursor-pointer uppercase tracking-widest"
              >
                Deploy Agent Contract
              </button>

              <button className="mt-3 font-mono font-medium text-xs text-[#00f0ff]/50 hover:text-[#00f0ff] cursor-pointer uppercase tracking-widest">
                Learn More
              </button>
            </>
          ) : (
            /* Deployment Progress */
            <div className="w-full mt-6 flex flex-col gap-4">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-6 h-6 flex items-center justify-center shrink-0">
                    {step.status === 'done' && (
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" className="text-[#00f0ff]">
                        <path d="M20 6L9 17l-5-5" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                    {step.status === 'loading' && (
                      <div className="w-4 h-4 border-2 border-[#00f0ff] border-t-transparent rounded-full animate-spin" />
                    )}
                    {step.status === 'pending' && (
                      <div className="w-4 h-4 rounded-none border border-white/20" />
                    )}
                  </div>
                  <span
                    className={`font-mono text-xs uppercase tracking-wider ${
                      step.status === 'done'
                        ? 'text-[#00f0ff]'
                        : step.status === 'loading'
                          ? 'text-white/80'
                          : 'text-white/30'
                    }`}
                  >
                    {step.label}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
