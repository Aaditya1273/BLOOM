"use client";

import Navigation from "@/sections/Navigation";
import Footer from "@/sections/Footer";

export default function HowItWorksPage() {
  const handleNavigate = (target: string) => {
    if (target.startsWith("#")) {
      window.location.href = "/" + target;
    } else {
      window.location.href = target;
    }
  };

  return (
    <div className="bg-[#0a0c10] min-h-screen flex flex-col relative">
      <div className="noise-overlay" />
      <Navigation onNavigate={handleNavigate} />
      
      <main className="flex-1 flex flex-col items-center justify-center pt-40 pb-20 px-8 w-full text-center relative z-10">
        <span className="eyebrow text-green font-mono-label text-xs tracking-[0.4em] uppercase mb-6">ARCHITECTURE</span>
        <h1 className="font-display text-4xl md:text-6xl font-bold text-white mb-6">
          How It Works
        </h1>
        <p className="font-body text-white/60 text-lg max-w-2xl mx-auto leading-relaxed">
          Detailed deep-dive into the Aura Agentic Workflow, from intent recognition to decentralized execution on the Robinhood Chain.
        </p>
      </main>

      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
}
