"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import Navigation from "@/sections/Navigation";
import Footer from "@/sections/Footer";
import Magnetic from "@/components/Magnetic";
import { API_URL } from "../lib/config";

gsap.registerPlugin(ScrollTrigger);

function Sparkline({ path, positive }: { path: string; positive: boolean }) {
  const pathRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    if (!pathRef.current) return;
    const length = pathRef.current.getTotalLength();
    gsap.set(pathRef.current, {
      strokeDasharray: length,
      strokeDashoffset: length,
    });
    gsap.to(pathRef.current, {
      strokeDashoffset: 0,
      duration: 1.5,
      ease: "power2.out",
      scrollTrigger: {
        trigger: pathRef.current,
        start: "top 90%",
      },
    });
  }, [path]);

  return (
    <svg width="100%" height="40" viewBox="0 0 120 40" fill="none" className="overflow-visible">
      <path
        ref={pathRef}
        d={path}
        stroke={positive ? "#39ff14" : "#00f0ff"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function generateSparklinePath(prices: number[] | undefined) {
  if (!prices || prices.length < 2) return "M0,35 L120,35";
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1;
  const stepX = 120 / (prices.length - 1);
  return prices.map((p, i) => {
    const x = i * stepX;
    const y = 40 - ((p - min) / range) * 35; // keep it a bit above bottom
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
}

export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const archRef = useRef<HTMLDivElement>(null);
  const marketRef = useRef<HTMLDivElement>(null);
  const neuralRef = useRef<HTMLDivElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  const [coins, setCoins] = useState<any>({});
  const [aiDecisions, setAiDecisions] = useState(0);

  useEffect(() => {
    // Fetch AI audit trail count from on-chain
    fetch("https://rpc.testnet.chain.robinhood.com", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: "0x42D141CBe4aDc46B082D702C2e1bD802236348C4", data: "0x125f8974" }, "latest"] }) // totalRecords()
    }).then(r => r.json()).then(d => { if (d.result) setAiDecisions(parseInt(d.result, 16)); }).catch(() => {});
  }, []);

  useEffect(() => {
    let active = true;
    const fetchCoins = async () => {
      try {
        const res = await fetch(`${API_URL}/api/coins`);
        const data = await res.json();
        if (active) setCoins(data);
      } catch (e) {
        console.error("Failed to fetch live coins data for landing page.");
      }
    };
    fetchCoins();
    const iv = setInterval(fetchCoins, 10000);
    return () => { active = false; clearInterval(iv); };
  }, []);

  useEffect(() => {
    // Smooth scroll behavior for anchor links
    const handleAnchorClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      const anchor = target.closest("a");
      if (anchor && anchor.hash && anchor.origin === window.location.origin) {
        e.preventDefault();
        const element = document.querySelector(anchor.hash);
        if (element) {
          element.scrollIntoView({ behavior: "smooth" });
        }
      }
    };

    document.addEventListener("click", handleAnchorClick);
    return () => document.removeEventListener("click", handleAnchorClick);
  }, []);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Hero entrance animations
      gsap.fromTo(
        ".hero-anim",
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.12,
          ease: "power3.out",
          delay: 0.2,
        }
      );

      // Architecture cards
      gsap.fromTo(
        ".arch-card",
        { opacity: 0, y: 60 },
        {
          opacity: 1,
          y: 0,
          duration: 0.7,
          stagger: 0.15,
          ease: "power3.out",
          scrollTrigger: {
            trigger: archRef.current,
            start: "top 75%",
          },
        }
      );

      // Market cards
      gsap.fromTo(
        ".market-card",
        { opacity: 0, y: 50, scale: 0.95 },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          duration: 0.7,
          stagger: 0.12,
          ease: "power3.out",
          scrollTrigger: {
            trigger: marketRef.current,
            start: "top 75%",
          },
        }
      );

      // Neural section
      gsap.fromTo(
        ".neural-left",
        { opacity: 0, x: -50 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: neuralRef.current,
            start: "top 75%",
          },
        }
      );
      gsap.fromTo(
        ".neural-right",
        { opacity: 0, x: 50 },
        {
          opacity: 1,
          x: 0,
          duration: 0.8,
          ease: "power3.out",
          scrollTrigger: {
            trigger: neuralRef.current,
            start: "top 75%",
          },
        }
      );

      // CTA section
      gsap.fromTo(
        ".cta-anim",
        { opacity: 0, y: 40 },
        {
          opacity: 1,
          y: 0,
          duration: 0.8,
          stagger: 0.1,
          ease: "power3.out",
          scrollTrigger: {
            trigger: ctaRef.current,
            start: "top 80%",
          },
        }
      );
    });

    return () => ctx.revert();
  }, []);

  const handleNavigate = (target: string) => {
    if (target.startsWith("#")) {
      const element = document.querySelector(target);
      if (element) {
        element.scrollIntoView({ behavior: "smooth" });
      }
    } else {
      window.location.href = target;
    }
  };

  return (
    <div className="bg-cyber-black text-white min-h-screen relative overflow-hidden font-body">
      <video
        autoPlay
        loop
        muted
        playsInline
        className="fixed inset-0 w-full h-full object-cover opacity-20 pointer-events-none z-0"
      >
        <source src="/assets/cyber_wallpaper.mp4" type="video/mp4" />
      </video>
      <div className="cyber-grid-bg relative z-0" />
      <div className="japanese-pattern relative z-0" />
      <div className="scanlines relative z-10" />
      <div className="noise-overlay relative z-10" />

      {/* Vertical Decorative Kanji */}
      <div className="fixed top-24 left-6 z-20 hidden xl:flex flex-col gap-8 opacity-20 pointer-events-none">
        <div className="text-vertical font-kanji text-4xl cyber-glow-cyan">オーラ・プロトコル</div>
        <div className="text-vertical font-kanji text-2xl cyber-glow-cyan">自律型知能</div>
      </div>
      
      <div className="fixed top-24 right-6 z-20 hidden xl:flex flex-col gap-8 opacity-20 pointer-events-none">
        <div className="text-vertical font-kanji text-4xl cyber-glow-cyan">富の創出</div>
        <div className="text-vertical font-kanji text-2xl cyber-glow-cyan">未来の金融</div>
      </div>

      <Navigation onNavigate={handleNavigate} />

      <main className="relative z-10">
        {/* ==================== HERO SECTION ==================== */}
        <section
          id="hero"
          ref={heroRef}
          className="relative min-h-screen flex items-center page-padding pt-24 pb-16"
        >
          {/* Decorative orbs */}
          <div className="absolute top-1/4 left-0 w-[500px] h-[500px] bg-neon-cyan/10 blur-[120px] rounded-full pointer-events-none" />
          <div className="absolute bottom-1/4 right-0 w-[500px] h-[500px] bg-neon-cyan/10 blur-[120px] rounded-full pointer-events-none" />

          <div className="max-w-[1600px] mx-auto w-full flex flex-col gap-12 justify-center items-center text-center">
            {/* Left Content */}
            <div className="flex flex-col gap-6 items-center">
              <div className="hero-anim opacity-0 flex items-center gap-4">
                <span className="font-mono-label text-neon-cyan tracking-[0.3em] uppercase text-sm">
                  ROBINHOOD CHAIN // ARBITRUM HACKATHON
                </span>
                <span className="font-kanji text-neon-cyan/50 text-xs tracking-tighter">アービトラム</span>
              </div>

              <div className="relative">
                <h1
                  className="hero-anim opacity-0 font-display text-[clamp(4rem,12vw,10rem)] leading-[0.9] uppercase glitch-text cyber-glow-cyan"
                  data-text="AURA PROTOCOL"
                >
                  AURA
                  <br />
                  PROTOCOL
                </h1>
                <div className="absolute -top-10 -right-10 font-kanji text-[8rem] text-white/5 pointer-events-none select-none">オーラ</div>
              </div>

              <div className="hero-anim opacity-0 flex items-center gap-4">
                <span className="font-mono-label text-neon-cyan tracking-widest uppercase text-lg">
                  AUTONOMOUS AI WEALTH LAYER
                </span>
                <span className="font-kanji text-neon-cyan/80 text-sm">自律型</span>
              </div>

              <p className="hero-anim opacity-0 text-white/70 text-lg max-w-xl leading-relaxed mx-auto">
                Next-generation wealth management powered by multi-agent
                consensus. Policy-guaranteed. Gasless. Built on Stylus.
              </p>

              <div className="hero-anim opacity-0 flex flex-wrap justify-center gap-4 mt-2">
                <Link href="/chat">
                  <button className="neon-button px-8 py-4 font-mono-label text-sm font-bold group overflow-hidden relative">
                    <span className="relative z-10 flex items-center gap-2">
                      INITIALIZE AGENT <span className="font-kanji text-xs opacity-50">起動</span>
                    </span>
                  </button>
                </Link>
                <Link href="/whitepaper">
                  <button className="relative bg-transparent border border-neon-cyan text-neon-cyan px-8 py-4 font-mono-label text-sm font-bold uppercase tracking-[0.2em] overflow-hidden transition-all hover:bg-neon-cyan/10 hover:shadow-[0_0_20px_rgba(0,240,255,0.4),0_0_40px_rgba(0,240,255,0.2)]">
                    ACCESS WHITEPAPER
                  </button>
                </Link>
              </div>

              {/* Trust Badges */}
              <div className="hero-anim opacity-0 flex flex-wrap justify-center gap-4 mt-6">
                <div className="glass-card-cyber px-5 py-3 flex items-center gap-3 border-l-2 border-neon-cyan">
                  <div className="flex flex-col">
                    <span className="font-mono-label text-[10px] text-neon-cyan tracking-wider uppercase">
                      Stylus Guarded
                    </span>
                    <span className="font-kanji text-[10px] text-white/40">防護システム</span>
                  </div>
                </div>
                <div className="glass-card-cyber px-5 py-3 flex items-center gap-3 border-l-2 border-neon-cyan/70">
                  <div className="flex flex-col">
                    <span className="font-mono-label text-[10px] text-neon-cyan/90 tracking-wider uppercase">
                      Robinhood Native
                    </span>
                    <span className="font-kanji text-[10px] text-white/40">ネイティブ</span>
                  </div>
                </div>
                <div className="glass-card-cyber px-5 py-3 flex items-center gap-3 border-l-2 border-neon-cyan/40">
                  <div className="flex flex-col">
                    <span className="font-mono-label text-[10px] text-neon-cyan/70 tracking-wider uppercase">
                      Multi-Agent Core
                    </span>
                    <span className="font-kanji text-[10px] text-white/40">多重エージェント</span>
                  </div>
                </div>
                <div className="glass-card-cyber px-5 py-3 flex items-center gap-3 border-l-2 border-neon-cyan">
                  <div className="flex flex-col">
                    <span className="font-mono-label text-[10px] text-neon-cyan tracking-wider uppercase">
                      AI Decisions On-Chain
                    </span>
                    <span className="font-kanji text-[10px] text-white/40">{aiDecisions} verified</span>
                  </div>
                </div>
                <div className="glass-card-cyber px-5 py-3 flex items-center gap-3 border-l-2 border-neon-cyan/70">
                  <div className="flex flex-col">
                    <span className="font-mono-label text-[10px] text-neon-cyan/90 tracking-wider uppercase">
                      Powered by Stylus
                    </span>
                    <span className="font-kanji text-[10px] text-white/40">34% gas saved</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="katana-divider" />

        {/* ==================== ARCHITECTURE SECTION ==================== */}
        <section
          id="how-it-works"
          ref={archRef}
          className="relative py-32 page-padding"
        >
          <div className="max-w-[1400px] mx-auto">
            <div className="text-center mb-20 relative">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 font-kanji text-8xl text-white/5 -z-10 tracking-[1em]">システム</div>
              <h2 className="font-display text-[clamp(2.5rem,6vw,5rem)] uppercase cyber-glow-cyan mb-4">
                SYSTEM ARCHITECTURE
              </h2>
              <p className="font-mono-label text-neon-cyan tracking-widest uppercase text-sm">
                Four-layer consensus stack // 四重合意スタック
              </p>
            </div>

            <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6 relative">
              {/* Connector lines (decorative) */}
              <div className="hidden lg:block absolute top-1/2 left-[12.5%] right-[12.5%] h-[1px] bg-gradient-to-r from-neon-cyan/20 via-neon-cyan/40 to-neon-cyan/20 -translate-y-1/2 z-0" />

              {[
                {
                  num: "01",
                  title: "CONNECT NEURAL LINK",
                  desc: "Secure wallet connection with zero-knowledge identity verification.",
                },
                {
                  num: "02",
                  title: "DEPLOY AURA AGENT",
                  desc: "Spin up autonomous agents with one-click deployment to the Stylus VM.",
                },
                {
                  num: "03",
                  title: "DEFINE STRATEGY",
                  desc: "Express intent in natural language. No code. No complexity. Pure signal.",
                },
                {
                  num: "04",
                  title: "POLICY FIREWALL",
                  desc: "Stylus-powered guardrails enforce policy boundaries at the bytecode level.",
                },
              ].map((card) => (
                <div
                  key={card.num}
                  className="arch-card opacity-0 glass-card-cyber p-8 relative z-10 group transition-all duration-300 hover:cyber-border"
                >
                  <div className="font-mono-label text-5xl text-neon-cyan/30 mb-6 group-hover:text-neon-cyan/60 transition-colors">
                    {card.num}
                  </div>
                  <h3 className="font-display text-xl uppercase mb-3 tracking-wide">
                    {card.title}
                  </h3>
                  <p className="text-white/60 text-sm leading-relaxed">
                    {card.desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ==================== MARKET PULSE SECTION ==================== */}
        <section
          id="market-pulse"
          ref={marketRef}
          className="relative py-32 page-padding"
        >
          <div className="max-w-[1400px] mx-auto">
            <div className="text-center mb-20 relative">
              <div className="absolute top-0 left-1/2 -translate-x-1/2 font-kanji text-8xl text-white/5 -z-10 tracking-[1em]">市場</div>
              <h2 className="font-display text-[clamp(2.5rem,6vw,5rem)] uppercase cyber-glow-cyan mb-4">
                LIVE MARKET FEED
              </h2>
              <p className="font-mono-label text-neon-cyan tracking-widest uppercase text-sm">
                Real-time sentiment analysis by the Macro Agent // リアルタイム分析
              </p>
            </div>

            <div className="grid md:grid-cols-3 gap-6">
              {(Object.keys(coins).length > 0 ? Object.values(coins).map((coin: any) => ({
                  sym: coin.symbol,
                  name: coin.name || coin.symbol,
                  price: `$${coin.currentPrice?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || "0.00"}`,
                  change: `${coin.priceChangePercentage24h > 0 ? '+' : ''}${coin.priceChangePercentage24h?.toFixed(2) || "0.00"}%`,
                  positive: (coin.priceChangePercentage24h || 0) >= 0,
                  sparklinePath: generateSparklinePath(coin.sparkline7d),
                  iconPath: coin.symbol === "BTC" ? "/assets/bitcoin-logo-svgrepo-com.svg" : coin.symbol === "ETH" ? "/assets/ethereum-crypto-cryptocurrency-2-svgrepo-com.svg" : (coin.image || ""),
                  signal: (coin.priceChangePercentage24h || 0) > 2 ? "BULLISH" : (coin.priceChangePercentage24h || 0) < -2 ? "BEARISH" : "NEUTRAL",
                  kanji: (coin.priceChangePercentage24h || 0) > 2 ? "強気" : (coin.priceChangePercentage24h || 0) < -2 ? "弱気" : "中立",
              })) : [
                {
                  sym: "BTC",
                  name: "Bitcoin",
                  price: "$97,420.00",
                  change: "+4.23%",
                  positive: true,
                  sparklinePath: "M0,35 L10,30 L20,32 L30,25 L40,28 L50,20 L60,22 L70,15 L80,18 L90,10 L100,12 L110,5 L120,8",
                  iconPath: "/assets/bitcoin-logo-svgrepo-com.svg",
                  signal: "BULLISH",
                  kanji: "強気",
                },
                {
                  sym: "ETH",
                  name: "Ethereum",
                  price: "$3,820.15",
                  change: "+1.87%",
                  positive: true,
                  sparklinePath: "M0,32 L10,28 L20,30 L35,22 L45,25 L55,18 L65,20 L75,14 L85,16 L95,10 L105,12 L115,8 L120,10",
                  iconPath: "/assets/ethereum-crypto-cryptocurrency-2-svgrepo-com.svg",
                  signal: "NEUTRAL",
                  kanji: "中立",
                },
                {
                  sym: "SOL",
                  name: "Solana",
                  price: "$142.30",
                  change: "-0.65%",
                  positive: false,
                  sparklinePath: "M0,20 L15,18 L30,22 L45,25 L55,20 L65,28 L75,26 L85,30 L95,28 L105,32 L115,30 L120,31",
                  iconPath: "/assets/solana-svgrepo-com.svg",
                  signal: "ACCUMULATE",
                  kanji: "蓄積",
                },
              ]).map((asset) => (
                <div
                  key={asset.sym}
                  className="market-card glass-card-cyber p-6 font-mono-label transition-all duration-300 hover:shadow-[0_0_30px_rgba(0,240,255,0.15)] group"
                >
                  <div className="flex justify-between items-start mb-6">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center p-2 group-hover:cyber-border transition-all">
                        {asset.iconPath ? (
                          <img src={asset.iconPath} alt={asset.name} className="w-full h-full object-contain" />
                        ) : (
                          <div className="text-white/50 font-display font-bold text-lg">{asset.sym[0]}</div>
                        )}
                      </div>
                      <div className="flex flex-col">
                        <span className="text-2xl font-bold tracking-tight">
                          {asset.sym}
                        </span>
                        <span className="text-[10px] text-white/40 uppercase tracking-widest">{asset.name}</span>
                      </div>
                    </div>
                    <div className="flex flex-col items-end">
                      <span
                        className={`text-sm font-bold ${asset.positive ? "text-neon-cyan" : "text-neon-cyan"}`}
                      >
                        {asset.positive ? "↑" : "↓"} {asset.change}
                      </span>
                    </div>
                  </div>

                  <div className="text-3xl font-bold mb-6 text-white/90">{asset.price}</div>

                  <div className="mb-6 h-12 flex items-end relative">
                    <Sparkline path={asset.sparklinePath} positive={asset.positive} />
                    <span className="absolute right-0 top-0 font-kanji text-3xl text-white/5 group-hover:text-white/20 transition-colors pointer-events-none">
                      {asset.kanji}
                    </span>
                  </div>

                  <div className="flex justify-between items-center pt-4 border-t border-white/10">
                    <div className="flex items-center gap-2">
                      <div className={`w-2 h-2 rounded-full animate-pulse ${asset.positive ? "bg-neon-cyan" : "bg-neon-cyan"}`} />
                      <span className="text-[10px] text-white/40 uppercase tracking-wider">
                        AI Signal
                      </span>
                    </div>
                    <span className={`text-sm uppercase tracking-wider font-bold ${asset.positive ? "text-neon-cyan" : "text-neon-cyan"}`}>
                      {asset.signal}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <div className="katana-divider" />

        {/* ==================== NEURAL CORE SECTION ==================== */}
        <section
          id="agent-ai"
          ref={neuralRef}
          className="relative py-32 page-padding"
        >
          <div className="max-w-[1400px] mx-auto grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Content */}
            <div className="neural-left opacity-0 relative">
              <div className="absolute -top-20 left-0 font-kanji text-9xl text-white/5 -z-10">脳</div>
              <h2 className="font-display text-[clamp(2.5rem,6vw,5rem)] uppercase cyber-glow-cyan mb-4">
                NEURAL CORE
              </h2>
              <p className="font-mono-label text-neon-cyan tracking-widest uppercase text-sm mb-8">
                Intent-driven execution engine // 意図駆動型エンジン
              </p>

              <p className="text-white/70 text-lg leading-relaxed mb-8">
                Aura&apos;s neural core translates human intent into on-chain
                action. No boilerplate. No manual transactions. Just speak,
                confirm, and let the swarm execute.
              </p>

              <ul className="space-y-4">
                {[
                  "Natural Intent: Describe goals in plain English",
                  "Smart Routing: Agents pick optimal paths across DEXs",
                  "Self-Custodial: You hold the keys. Always.",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-white/80"
                  >
                    <span className="text-neon-cyan mt-1">◆</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Right: Terminal Mockup */}
            <div className="neural-right opacity-0">
              <div className="glass-card-cyber p-6 md:p-8">
                <div className="flex items-center gap-2 mb-6 border-b border-white/10 pb-4">
                  <div className="w-3 h-3 rounded-full bg-neon-cyan" />
                  <div className="w-3 h-3 rounded-full bg-white" />
                  <div className="w-3 h-3 rounded-full bg-neon-cyan" />
                  <span className="ml-4 font-mono-label text-xs text-white/40 uppercase">
                    Aura Terminal v1.0.4
                  </span>
                </div>

                <div className="font-mono-label text-sm space-y-4">
                  <div>
                    <span className="text-neon-cyan">user@aura:~$</span>
                    <span className="text-white/90 ml-2">
                      swap 0.1 ETH to AMZN every week
                    </span>
                  </div>

                  <div className="text-white/50">
                    ─────────────────────────────
                  </div>

                  <div>
                    <span className="text-neon-cyan">aura@core:~$</span>
                    <span className="text-white ml-2 animate-pulse">
                      EXECUTING STRATEGY...
                    </span>
                  </div>

                  <div>
                    <span className="text-neon-cyan">aura@core:~$</span>
                    <span className="text-neon-cyan ml-2">
                      ✓ DCA deployed | Slippage 0.3% | Guardrail OK
                    </span>
                  </div>

                  <div className="pt-2">
                    <span className="text-neon-cyan">user@aura:~$</span>
                    <span className="inline-block w-2 h-4 bg-neon-cyan ml-2 animate-pulse align-middle" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <div className="katana-divider" />

        {/* ==================== INTELLIGENCE VAULT SECTION ==================== */}
        <section
          id="intelligence-vault"
          className="relative py-32 page-padding bg-navy/50"
        >
          <div className="max-w-[1400px] mx-auto grid lg:grid-cols-2 gap-16 items-center">
            {/* Left Content */}
            <div className="relative">
              <div className="absolute -top-20 left-0 font-kanji text-9xl text-white/5 -z-10">金庫</div>
              <h2 className="font-display text-[clamp(2.5rem,6vw,5rem)] uppercase cyber-glow-cyan mb-4">
                INTELLIGENCE VAULT
              </h2>
              <p className="font-mono-label text-neon-cyan tracking-widest uppercase text-sm mb-8">
                Yield optimization by AI Swarm // 知能金庫
              </p>

              <p className="text-white/70 text-lg leading-relaxed mb-8">
                Deposit aUSD into the Aura Intelligence Vault (AIV) and let our AI analyst 
                swarm deploy your capital. Managed by the Oracle and secured by the Stylus Guardrail.
              </p>

              <ul className="space-y-4 mb-8">
                {[
                  "Dynamic Risk Management: Strategy updates based on real-time market data",
                  "Stylus Guardrail: Mathematical limits on max drawdown",
                  "Transparent Execution: Monitor every AI decision on the Neural Feed",
                ].map((item) => (
                  <li
                    key={item}
                    className="flex items-start gap-3 text-white/80"
                  >
                    <span className="text-neon-cyan mt-1">◆</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
              <Link href="/vault" className="inline-block px-8 py-4 bg-neon-cyan/10 border border-neon-cyan/30 text-neon-cyan font-mono-label uppercase tracking-wider hover:bg-neon-cyan/20 transition-all shadow-[0_0_15px_rgba(0,240,255,0.15)] hover:shadow-[0_0_25px_rgba(0,240,255,0.3)] hover:scale-105">
                access vault 
              </Link>
            </div>

            {/* Right: Graphic / Stats */}
            <div className="glass-card-cyber p-8 relative overflow-hidden group hover:cyber-border transition-all duration-300">
              <div className="absolute top-0 right-0 w-[200px] h-[200px] bg-neon-cyan/5 blur-[80px] group-hover:bg-neon-cyan/10 transition-colors" />
              
              <div className="flex items-center justify-between mb-8 border-b border-white/10 pb-6 relative z-10">
                <div>
                  <h3 className="font-mono-label text-white/50 text-sm mb-1 uppercase">Total Value Locked</h3>
                  <div className="font-display text-4xl text-white tracking-tight cyber-glow-cyan text-shadow-glow">Live</div>
                </div>
                <div className="text-right">
                  <h3 className="font-mono-label text-white/50 text-sm mb-1 uppercase">Est. Base APY</h3>
                  <div className="font-display text-3xl text-neon-cyan tracking-tight">+5.2%</div>
                </div>
              </div>

              <div className="space-y-4 relative z-10">
                <div className="flex justify-between items-center bg-white/5 p-4 rounded-lg border border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-neon-cyan shadow-[0_0_10px_#00f0ff]" />
                    <span className="font-mono-label text-sm">Macro Analyst</span>
                  </div>
                  <span className="text-neon-cyan font-mono-label text-sm uppercase">Active</span>
                </div>
                <div className="flex justify-between items-center bg-white/5 p-4 rounded-lg border border-white/10">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-neon-cyan shadow-[0_0_10px_#00f0ff]" />
                    <span className="font-mono-label text-sm">Risk Manager</span>
                  </div>
                  <span className="text-neon-cyan font-mono-label text-sm uppercase">Monitoring</span>
                </div>
                 <div className="flex justify-between items-center bg-white/5 p-4 rounded-lg border border-white/20">
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full bg-white shadow-[0_0_10px_#fded00] animate-pulse" />
                    <span className="font-mono-label text-sm">Stylus Guardrail</span>
                  </div>
                  <span className="text-white font-mono-label text-sm uppercase">Enforcing Limits</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ==================== CTA SECTION ==================== */}
        <section
          id="cta"
          ref={ctaRef}
          className="relative py-40 page-padding overflow-hidden"
        >
          {/* Animated orbs */}
          <div className="absolute top-1/2 left-1/4 w-[400px] h-[400px] bg-neon-cyan/10 blur-[120px] rounded-full pointer-events-none animate-pulse" />
          <div className="absolute bottom-0 right-1/4 w-[300px] h-[300px] bg-neon-cyan/10 blur-[100px] rounded-full pointer-events-none animate-pulse" />

          <div className="max-w-[1000px] mx-auto text-center relative z-10">
            <h2
              className="cta-anim opacity-0 font-display text-[clamp(3rem,10vw,8rem)] leading-[0.9] uppercase glitch-text cyber-glow-cyan mb-6"
              data-text="JOIN THE GRID"
            >
              JOIN THE GRID
            </h2>

            <p className="cta-anim opacity-0 font-mono-label text-neon-cyan tracking-widest uppercase text-lg mb-10">
              Your AI agent is waiting.
            </p>

            <div className="cta-anim opacity-0">
              <Magnetic>
                <Link href="/chat">
                  <button className="relative bg-transparent border-2 border-neon-cyan text-neon-cyan px-12 py-5 font-mono-label text-lg font-bold uppercase tracking-[0.25em] overflow-hidden transition-all hover:bg-neon-cyan/10 hover:shadow-[0_0_30px_rgba(0,240,255,0.5),0_0_60px_rgba(0,240,255,0.3)]">
                    LAUNCH AURA TERMINAL
                  </button>
                </Link>
              </Magnetic>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
