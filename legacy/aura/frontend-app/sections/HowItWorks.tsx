"use client";

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const steps = [
  {
    num: '01',
    title: 'Connect Wallet',
    desc: 'Link your EOA to the platform. Aura supports all major wallets on the Robinhood Chain Testnet.',
    icon: (
      <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
  },
  {
    num: '02',
    title: 'Deploy Aura Agent',
    desc: 'Deploy your personal Smart Account and authorize the Aura AI Agent to execute strategies on your behalf.',
    icon: (
      <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.499 4.499 0 00-1.789-1.789 4.5 4.5 0 00-.602 3.312 2.25 2.25 0 013.312-3.312z" />
      </svg>
    ),
  },
  {
    num: '03',
    title: 'Define Strategy',
    desc: 'Chat with Aura to define your goals. From complex automated DCA and Yield Vault deposits (AIV) to launching Perps, Aura understands your intent.',
    icon: (
      <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
  },
  {
    num: '04',
    title: 'Policy Protection',
    desc: 'Every trade is verified by a Multi-Agent Committee to ensure it aligns with your risk profile and safety policies.',
    icon: (
      <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
];

export default function HowItWorks() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const cards = sectionRef.current.querySelectorAll('.step-card');
    const numbers = sectionRef.current.querySelectorAll('.step-num');

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 70%',
        toggleActions: 'play none none none',
      },
    });

    tl.fromTo(
      cards,
      { y: 100, opacity: 0, rotateY: 30 },
      { y: 0, opacity: 1, rotateY: 0, duration: 1.2, stagger: 0.15, ease: 'expo.out' }
    );

    tl.fromTo(
      numbers,
      { scale: 0, opacity: 0 },
      { scale: 1, opacity: 1, duration: 0.8, stagger: 0.1, ease: 'back.out(1.7)' },
      "-=1"
    );

    return () => { tl.kill(); };
  }, []);

  return (
    <section
      id="how-it-works"
      ref={sectionRef}
      className="bg-navy text-white pt-20 pb-40 overflow-hidden relative"
    >
      
      <div className="max-w-[1440px] mx-auto page-padding relative z-10">
        {/* Section Header */}
        <div className="text-center mb-32">
          <span className="eyebrow text-green font-mono-label text-sm tracking-[0.4em] uppercase">ARCHITECTURE</span>
          <h2
            className="font-display font-bold text-white mt-8 tracking-[-0.04em] uppercase flex flex-col items-center gap-2"
            style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', lineHeight: 0.85 }}
          >
            <span>Agentic</span>
            <span className="text-green">Workflow</span>
          </h2>
          <p className="font-body text-surface/70 mt-10 max-w-[600px] mx-auto text-xl leading-relaxed font-light">
            A seamless bridge between human intent and decentralized execution.
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 relative perspective-1000">
          {steps.map((step, i) => (
            <div key={step.num} className="relative group">
              <div
                className="step-card bg-[#152341] rounded-[2.5rem] p-10 border border-white/5 transition-all duration-500 hover:bg-[#1A2A4D] hover:shadow-[0_20px_60px_rgba(31,203,79,0.15)] hover:border-green/30 opacity-0 h-full flex flex-col items-center text-center overflow-hidden"
              >
                {/* Glow effect on hover */}
                <div className="absolute inset-0 bg-green/5 blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />

                {/* Step Badge */}
                <div className="step-num w-14 h-14 rounded-full bg-white/5 border border-white/10 text-white flex items-center justify-center font-mono-label text-lg mb-10 shadow-xl group-hover:bg-green group-hover:text-navy group-hover:border-green group-hover:scale-110 transition-all duration-500 relative z-10">
                  {step.num}
                </div>

                {/* Icon */}
                <div className="mb-6 transform group-hover:-translate-y-2 group-hover:scale-110 transition-transform duration-500 relative z-10 w-20 h-20 bg-white/5 rounded-2xl flex items-center justify-center p-4">
                  {step.icon}
                </div>

                {/* Title */}
                <h3 className="font-display font-medium text-2xl text-white mt-4 mb-4 relative z-10">
                  {step.title}
                </h3>

                {/* Description */}
                <p className="font-body text-surface/60 text-base leading-relaxed font-light relative z-10">
                  {step.desc}
                </p>
              </div>

              {/* Connecting Line - Desktop only */}
              {i < steps.length - 1 && (
                <div className="hidden lg:block absolute top-[100px] -right-4 w-8 h-[1px] bg-white/10 group-hover:bg-green/40 transition-colors duration-500" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
