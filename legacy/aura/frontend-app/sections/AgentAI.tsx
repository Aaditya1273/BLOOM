"use client";

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AnimatedGrid from '@/components/AnimatedGrid';

gsap.registerPlugin(ScrollTrigger);

export default function AgentAI() {
  const sectionRef = useRef<HTMLElement>(null);
  const mockupRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const items = sectionRef.current.querySelectorAll('.ai-item');
    
    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 70%',
        toggleActions: 'play none none none',
      },
    });

    tl.fromTo(
      items,
      { y: 50, opacity: 0 },
      { y: 0, opacity: 1, duration: 1, stagger: 0.2, ease: 'expo.out' }
    );

    if (mockupRef.current) {
      gsap.fromTo(
        mockupRef.current,
        { scale: 0.8, opacity: 0, rotateY: -15, rotateX: 10 },
        { 
          scale: 1, opacity: 1, rotateY: 0, rotateX: 0, duration: 1.5, ease: 'power3.out',
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top 60%'
          }
        }
      );
    }
  }, []);

  return (
    <section
      id="agent-ai"
      ref={sectionRef}
      className="relative bg-[#05070a] section-padding overflow-hidden py-32"
    >
      <div className="absolute inset-0 z-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue/5 via-navy to-navy opacity-50" />
      
      <div className="relative z-10 max-w-[1440px] mx-auto page-padding">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
          
          {/* Left Text */}
          <div className="flex flex-col space-y-8">
            <span className="ai-item eyebrow text-green font-mono-label text-sm tracking-[0.4em] uppercase">
              AGENT INTELLIGENCE
            </span>
            <h2 className="ai-item font-display font-bold text-white text-5xl lg:text-7xl leading-[0.9] tracking-tight uppercase">
              Understand <br/> <span className="text-green">Execute.</span>
            </h2>
            <p className="ai-item font-body text-surface/60 text-lg md:text-xl font-light leading-relaxed max-w-lg">
              Talk to Aura in natural language. Our intent-parsing engine converts your text into precisely timed blockchain transactions, protected by strict security boundaries. Whether you're setting up a DCA strategy, depositing into the Intelligence Vault (AIV), or launching Perpetual trades, Aura makes it seamless.
            </p>

            <div className="ai-item flex flex-col gap-6 mt-8">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  🎙️
                </div>
                <div>
                  <h4 className="text-white font-display font-medium text-lg">Natural Intent</h4>
                  <p className="text-surface/50 text-sm mt-1">"Buy 1 ETH every week if price &lt; $4k"</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  ⚙️
                </div>
                <div>
                  <h4 className="text-white font-display font-medium text-lg">Smart Routing</h4>
                  <p className="text-surface/50 text-sm mt-1">Automatic path optimization across Dexes on Robinhood Chain.</p>
                </div>
              </div>
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                  🔒
                </div>
                <div>
                  <h4 className="text-white font-display font-medium text-lg">Self-Custodial</h4>
                  <p className="text-surface/50 text-sm mt-1">Aura acts on behalf of your smart account. You keep the keys.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Right Mockup */}
          <div ref={mockupRef} className="relative perspective-1000">
            <div className="absolute inset-0 bg-green/20 blur-[100px] rounded-full" />
            <div className="relative z-10 glass-card bg-[#111c33]/80 p-6 md:p-8 rounded-[2rem] border border-white/10 shadow-2xl">
              
              {/* Fake Chat UI */}
              <div className="flex flex-col gap-6 bg-[#0a1122] p-6 rounded-2xl border border-white/5">
                <div className="flex items-end justify-end">
                  <div className="bg-green/10 text-green px-5 py-3 rounded-2xl rounded-br-sm text-sm font-body border border-green/20">
                    I want to setup a DCA: Buy $100 of BTC every Friday if price goes down.
                  </div>
                </div>
                
                <div className="flex items-end gap-3">
                  <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center p-1.5 border border-white/10">
                    <img src="/assets/ai-mascot-hero.png" alt="Aura" className="w-full h-full object-contain" />
                  </div>
                  <div className="bg-white/5 text-white/80 px-5 py-4 rounded-2xl rounded-bl-sm text-sm font-body border border-white/10 max-w-[85%]">
                    Alright! I've drafted a DCA strategy. <br/><br/>
                    <div className="bg-[#050811] p-3 rounded-lg border border-white/5 font-mono text-xs text-white/50 mt-3">
                      <span className="text-purple">Action:</span> Scheduled Buy<br/>
                      <span className="text-blue">Asset:</span> BTC<br/>
                      <span className="text-green">Condition:</span> Price Drop &lt; 0% WoW<br/>
                      <span className="text-white/30">Amount:</span> $100
                    </div>
                    <button className="mt-4 w-full bg-green text-navy font-bold py-2 rounded-lg text-xs uppercase cursor-pointer hover:bg-green-hover transition-colors">
                      Sign & Deploy to RH Chain
                    </button>
                  </div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
