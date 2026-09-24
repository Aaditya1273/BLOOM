"use client";

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AnimatedGrid from '@/components/AnimatedGrid';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';

gsap.registerPlugin(ScrollTrigger);

interface MarketCardData {
  name: string;
  symbol: string;
  price: string;
  change: string;
  changePositive: boolean;
  signal: string;
  signalColor: 'green' | 'coral';
  sparklinePath: string;
  iconPath?: string;
}

const marketData: MarketCardData[] = [
  {
    name: 'Bitcoin',
    symbol: 'BTC/USD',
    price: '$67,245.00',
    change: '+2.34%',
    changePositive: true,
    signal: 'ACCUMULATE',
    signalColor: 'green',
    sparklinePath: 'M0,35 L10,30 L20,32 L30,25 L40,28 L50,20 L60,22 L70,15 L80,18 L90,10 L100,12 L110,5 L120,8',
    iconPath: '/assets/bitcoin-logo-svgrepo-com.svg',
  },
  {
    name: 'Ethereum',
    symbol: 'ETH/USD',
    price: '$3,890.12',
    change: '+1.87%',
    changePositive: true,
    signal: 'ACCUMULATE',
    signalColor: 'green',
    sparklinePath: 'M0,32 L10,28 L20,30 L35,22 L45,25 L55,18 L65,20 L75,14 L85,16 L95,10 L105,12 L115,8 L120,10',
    iconPath: '/assets/ethereum-crypto-cryptocurrency-2-svgrepo-com.svg',
  },
  {
    name: 'Solana',
    symbol: 'SOL/USD',
    price: '$142.67',
    change: '-0.45%',
    changePositive: false,
    signal: 'HOLD',
    signalColor: 'coral',
    sparklinePath: 'M0,20 L15,18 L30,22 L45,25 L55,20 L65,28 L75,26 L85,30 L95,28 L105,32 L115,30 L120,31',
    iconPath: '/assets/solana-svgrepo-com.svg',
  },
];

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
      duration: 1.2,
      ease: 'power2.out',
      scrollTrigger: {
        trigger: pathRef.current,
        start: 'top 85%',
        toggleActions: 'play none none none',
      },
    });
  }, []);

  return (
    <svg
      width="120"
      height="40"
      viewBox="0 0 120 40"
      fill="none"
      aria-label={`Trend: ${positive ? 'upward' : 'downward'}`}
    >
      <path
        ref={pathRef}
        d={path}
        stroke={positive ? '#1FCB4F' : '#E86A56'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function MarketCard({ data }: { data: MarketCardData }) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);

  const mouseXSpring = useSpring(x);
  const mouseYSpring = useSpring(y);

  const rotateX = useTransform(mouseYSpring, [-0.5, 0.5], ["10deg", "-10deg"]);
  const rotateY = useTransform(mouseXSpring, [-0.5, 0.5], ["-10deg", "10deg"]);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const xPct = mouseX / width - 0.5;
    const yPct = mouseY / height - 0.5;
    x.set(xPct);
    y.set(yPct);
  };

  const handleMouseLeave = () => {
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      style={{ rotateX, rotateY, transformStyle: "preserve-3d" }}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="pulse-card bg-navy-light/40 backdrop-blur-2xl rounded-[2.5rem] p-10 border border-white/[0.08] opacity-0 transition-all duration-500 hover:border-green/40 hover:shadow-[0_0_80px_rgba(31,203,79,0.15)] group relative overflow-hidden"
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      
      {/* Top Row */}
      <div className="flex items-center gap-5 relative z-10" style={{ transform: "translateZ(30px)" }}>
        <div
          className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-2xl bg-white/5 border border-white/10"
        >
          <img src={data.iconPath} alt={data.name} className="w-8 h-8 object-contain" />
        </div>
        <div>
          <h4 className="font-display font-bold text-white text-xl leading-none tracking-tight">
            {data.name}
          </h4>
          <span className="font-mono-label text-[0.7rem] text-white/40 uppercase tracking-[0.2em] mt-2 block">
            {data.symbol}
          </span>
        </div>
      </div>

      {/* Price */}
      <div className="mt-10 font-display font-bold text-4xl text-white relative z-10" style={{ transform: "translateZ(60px)" }}>
        {data.price}
      </div>

      {/* Change */}
      <div className="flex items-center gap-2 mt-3 relative z-10" style={{ transform: "translateZ(40px)" }}>
        <span
          className={`font-body font-bold text-base px-3 py-1 rounded-full ${data.changePositive ? 'text-green bg-green/10' : 'text-coral bg-coral/10'}`}
        >
          {data.changePositive ? '↑' : '↓'} {data.change}
        </span>
      </div>

      {/* Sparkline */}
      <div className="mt-10 relative z-10 opacity-80" style={{ transform: "translateZ(80px)" }}>
        <Sparkline path={data.sparklinePath} positive={data.changePositive} />
      </div>

      {/* AI Signal */}
      <div className="mt-10 flex items-center gap-4 relative z-10" style={{ transform: "translateZ(50px)" }}>
        <div className="relative flex h-4 w-4">
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${data.signalColor === 'green' ? 'bg-green' : 'bg-coral'}`}></span>
          <span className={`relative inline-flex rounded-full h-4 w-4 ${data.signalColor === 'green' ? 'bg-green' : 'bg-coral'}`}></span>
        </div>
        <span className="signal-text font-mono-label text-[0.8rem] text-green font-bold tracking-[0.1em] uppercase">
          AI Signal: {data.signal}
        </span>
      </div>
    </motion.div>
  );
}

export default function MarketPulse() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const cards = sectionRef.current.querySelectorAll('.pulse-card');

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 80%',
        toggleActions: 'play none none none',
      },
    });

    tl.fromTo(
      cards,
      { y: 100, opacity: 0, scale: 0.9, rotateX: 20 },
      { y: 0, opacity: 1, scale: 1, rotateX: 0, duration: 1.2, stagger: 0.2, ease: 'expo.out' }
    );

    return () => { tl.kill(); };
  }, []);

  return (
    <section
      id="market-pulse"
      ref={sectionRef}
      className="relative bg-[#05070a] section-padding overflow-hidden py-40"
    >
      <AnimatedGrid config="pulse" />

      <div className="relative z-10 max-w-[1440px] mx-auto page-padding">
        {/* Section Header */}
        <div className="text-center mb-32">
          <span className="eyebrow text-green font-mono-label text-sm tracking-[0.4em] uppercase">MARKET INTELLIGENCE</span>
          <h2
            className="font-display font-bold text-white mt-8 tracking-[-0.04em] uppercase"
            style={{ fontSize: 'clamp(3rem, 7vw, 5.5rem)', lineHeight: 0.85 }}
          >
            Predictive Analysis
          </h2>
          <p className="font-body text-white/50 mt-10 max-w-[700px] mx-auto text-xl leading-relaxed font-light">
            Aura&apos;s neural engine processes 1M+ data points daily to synchronize your DCA, Vault, and Perp strategies with market momentum.
          </p>
        </div>

        {/* Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-10 perspective-1000">
          {marketData.map((data) => (
            <MarketCard key={data.symbol} data={data} />
          ))}
        </div>
      </div>
    </section>
  );
}
