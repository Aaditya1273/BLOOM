"use client";

import Navigation from "@/sections/Navigation";
import Footer from "@/sections/Footer";

export default function MarketPulsePage() {
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
        <span className="eyebrow text-green font-mono-label text-xs tracking-[0.4em] uppercase mb-6">MARKET INTELLIGENCE</span>
        <h1 className="font-display text-4xl md:text-6xl font-bold text-white mb-6">
          Market Pulse
        </h1>
        <p className="font-body text-white/60 text-lg max-w-2xl mx-auto leading-relaxed">
          Live analytics, predictive data, and AI-driven insights that power the Aura Multi-Agent Committee.
        </p>
      </main>

      <div className="relative z-10">
        <Footer />
      </div>
    </div>
  );
}
