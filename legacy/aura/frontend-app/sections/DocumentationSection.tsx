"use client";

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export default function DocumentationSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const blocks = sectionRef.current.querySelectorAll('.doc-block');
    
    gsap.fromTo(
      blocks,
      { y: 30, opacity: 0 },
      { 
        y: 0, 
        opacity: 1, 
        duration: 0.8, 
        stagger: 0.1, 
        ease: 'power3.out',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 75%'
        }
      }
    );
  }, []);

  return (
    <section
      id="docs"
      ref={sectionRef}
      className="relative bg-navy text-white py-32 border-t border-white/5"
    >
      <div className="max-w-[1440px] mx-auto page-padding">
        <div className="flex flex-col md:flex-row gap-12 items-start justify-between mb-20">
          <div>
            <span className="eyebrow text-blue font-mono-label text-sm tracking-[0.4em] uppercase">DEVELOPER READY</span>
            <h2 className="font-display font-bold text-4xl md:text-5xl uppercase mt-4">
              Integrate in <span className="text-blue">Minutes</span>
            </h2>
          </div>
          <p className="font-body text-surface/60 max-w-md text-lg font-light leading-relaxed">
            The Aura SDK is built to give developers total control over agent deployment, policy management, and trading automation on the Robinhood Chain.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Docs Block 1 */}
          <div className="doc-block bg-[#111c33] border border-white/10 p-8 rounded-[2rem] hover:border-blue/30 transition-colors">
            <h3 className="font-display text-2xl font-bold mb-4">Core SDK</h3>
            <p className="font-body text-surface/50 mb-6 font-light">Install our typescript library to connect your dapp to Aura's AI intents network.</p>
            <div className="bg-[#0a1122] rounded-xl p-4 font-mono text-sm text-white/70 overflow-x-auto">
              <span className="text-green">npm</span> install @aura-agent/sdk
              <br/><br/>
              <span className="text-blue">import</span> {'{ AuraClient }'} <span className="text-blue">from</span> <span className="text-coral">'@aura-agent/sdk'</span>;<br/>
              <br/>
              <span className="text-purple">const</span> aura = <span className="text-purple">new</span> AuraClient({'{'}<br/>
              &nbsp;&nbsp;network: <span className="text-coral">'robinhood-chain-testnet'</span>,<br/>
              &nbsp;&nbsp;apiKey: process.env.AURA_KEY<br/>
              {'}'});
            </div>
          </div>

          {/* Docs Block 2 */}
          <div className="doc-block bg-[#111c33] border border-white/10 p-8 rounded-[2rem] hover:border-blue/30 transition-colors">
            <h3 className="font-display text-2xl font-bold mb-4">Define Policies</h3>
            <p className="font-body text-surface/50 mb-6 font-light">Set strict guardrails on your agents to bound their trading behaviors programmatically.</p>
            <div className="bg-[#0a1122] rounded-xl p-4 font-mono text-sm text-white/70 overflow-x-auto">
              <span className="text-purple">await</span> aura.policies.create({'{'}<br/>
              &nbsp;&nbsp;name: <span className="text-coral">'Max Slippage'</span>,<br/>
              &nbsp;&nbsp;condition: <span className="text-coral">'slippage &lt; 0.5%'</span>,<br/>
              &nbsp;&nbsp;action: <span className="text-coral">'REVERT'</span><br/>
              {'}'});<br/>
              <br/>
              <span className="text-surface/30">// Agents trying to bypass this will fail</span><br/>
              <span className="text-surface/30">// via the Multi-Agent consensus.</span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
