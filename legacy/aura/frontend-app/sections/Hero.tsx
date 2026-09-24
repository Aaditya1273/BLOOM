import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import AnimatedGrid from '@/components/AnimatedGrid';
import GradientButton from '@/components/GradientButton';
import Magnetic from '@/components/Magnetic';
import Link from 'next/link';

export default function Hero() {
  const sectionRef = useRef<HTMLElement>(null);
  const mascotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const tl = gsap.timeline({ delay: 0.2 });

    const eyebrow = sectionRef.current.querySelector('.hero-eyebrow');
    const headlineWords = sectionRef.current.querySelectorAll('.mask-word');
    const subheadline = sectionRef.current.querySelector('.hero-subheadline');
    const ctas = sectionRef.current.querySelector('.hero-ctas');
    const trust = sectionRef.current.querySelector('.hero-trust');
    const mascot = sectionRef.current.querySelector('.hero-mascot');

    tl.to(headlineWords, {
      y: 0,
      duration: 1.2,
      stagger: 0.05,
      ease: "power4.out"
    }, 0.1);

    if (eyebrow) {
      tl.fromTo(eyebrow, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0);
    }

    if (subheadline) {
      tl.fromTo(subheadline, { y: 30, opacity: 0 }, { y: 0, opacity: 1, duration: 1, ease: 'power3.out' }, 0.4);
    }

    if (ctas) {
      tl.fromTo(ctas, { y: 20, opacity: 0 }, { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }, 0.6);
    }

    if (trust) {
      tl.fromTo(trust, { opacity: 0 }, { opacity: 1, duration: 1 }, 0.8);
    }

    if (mascot) {
      tl.fromTo(mascot, { scale: 0.8, opacity: 0, rotate: 5 }, { scale: 1, opacity: 1, rotate: 0, duration: 1.5, ease: 'expo.out' }, 0.3);
    }

    // Parallax effect on scroll
    const ticker = sectionRef.current?.querySelector('.hero-ticker');
    
    const handleScroll = () => {
      const scrolled = window.scrollY;
      if (mascotRef.current) {
        gsap.to(mascotRef.current, {
          y: scrolled * 0.15,
          rotate: scrolled * 0.02,
          duration: 0.5,
          ease: "none"
        });
      }
      if (ticker) {
        gsap.to(ticker, {
          x: -scrolled * 0.5,
          duration: 0.5,
          ease: "none"
        });
      }
    };

    window.addEventListener('scroll', handleScroll);
    return () => {
      tl.kill();
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const headline = "DEFI AGENT";
  const words = headline.split(" ");

  // Tagline exactly like "Do Things Your Way"
  const tagline = ["Automate", "Your", "Growth", "Now"];

  return (
    <section
      id="hero"
      ref={sectionRef}
      className="relative min-h-[100dvh] flex items-center justify-center overflow-hidden bg-navy text-white"
      style={{ minHeight: '800px' }}
    >
      <AnimatedGrid config="hero" />

      {/* Massive Background Ticker */}
      <div className="absolute top-[10%] left-0 w-[200vw] text-[15vw] font-display font-bold leading-none whitespace-nowrap opacity-5 overflow-hidden hero-ticker pointer-events-none select-none text-green">
        AURA CO-PILOT AURA CO-PILOT AURA CO-PILOT AURA CO-PILOT
      </div>

      <div className="relative z-10 max-w-[1440px] mx-auto page-padding text-center flex flex-col items-center">
        {/* Eyebrow */}
        <div className="hero-eyebrow eyebrow text-green font-mono-label text-sm tracking-[0.3em] mb-12 opacity-0 uppercase">
          AURA × ROBINHOOD CHAIN
        </div>

        {/* Headline with Mask Reveal */}
        <h1 className="hero-headline font-display font-bold leading-[0.8] tracking-[-0.04em] flex flex-wrap items-center justify-center gap-4 md:gap-8"
          style={{ fontSize: 'clamp(4rem, 11vw, 10rem)', textTransform: 'uppercase' }}>
          {words.map((word, i) => (
            <span key={i} className="mask-text inline-block">
              <span className="mask-word inline-block">{word}</span>
            </span>
          ))}
        </h1>

        <div className="mt-8 flex gap-3 text-sm md:text-base font-mono-label uppercase tracking-widest opacity-0 hero-subheadline text-green">
          {tagline.map((t, idx) => (
            <span key={idx}>
              {t} {idx < tagline.length - 1 && <span className="opacity-50 mx-2">/</span>}
            </span>
          ))}
        </div>

        {/* Subheadline */}
        <p className="hero-subheadline font-body text-surface/80 text-lg md:text-2xl max-w-[640px] mt-12 opacity-0 leading-relaxed font-light">
          Experience next-generation wealth management. Secure, automated, and policy-guaranteed investment strategies executed by your personal Aura Agent.
        </p>

        {/* CTAs with Magnetic Effect */}
        <div className="hero-ctas flex flex-col sm:flex-row items-center gap-6 mt-14 opacity-0">
          <Magnetic>
            <Link href="/chat">
              <GradientButton variant="primary" size="large" className="px-10 py-5 text-lg shadow-2xl">
                Launch Terminal
              </GradientButton>
            </Link>
          </Magnetic>
          <Magnetic>
            <Link href="/whitepaper">
              <GradientButton variant="secondary" size="large" className="px-10 py-5 text-lg">
                View Whitepaper
              </GradientButton>
            </Link>
          </Magnetic>
        </div>

        {/* Trust Bar */}
        <div className="hero-trust flex flex-wrap justify-center items-center gap-6 md:gap-12 mt-20 text-surface/60 opacity-0">
          <div className="flex items-center gap-3 glass-card px-4 py-2 rounded-full">
            <div className="w-8 h-8 rounded-full bg-green/20 flex items-center justify-center text-green text-sm">🛡️</div>
            <span className="font-mono-label text-[0.7rem] tracking-wider uppercase text-white">Policy-Based Security</span>
          </div>
          <div className="flex items-center gap-3 glass-card px-4 py-2 rounded-full">
            <div className="w-8 h-8 rounded-full bg-blue/20 flex items-center justify-center text-blue text-sm">⚡</div>
            <span className="font-mono-label text-[0.7rem] tracking-wider uppercase text-white">Robinhood Chain</span>
          </div>
          <div className="flex items-center gap-3 glass-card px-4 py-2 rounded-full">
            <div className="w-8 h-8 rounded-full bg-purple/20 flex items-center justify-center text-purple text-sm">🤖</div>
            <span className="font-mono-label text-[0.7rem] tracking-wider uppercase text-white">Multi-Agent Committee</span>
          </div>
        </div>
      </div>

      {/* Decorative Elements */}
      <div className="absolute left-[-5%] top-[40%] w-[400px] h-[400px] bg-blue/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute right-[-10%] bottom-0 w-[500px] h-[500px] bg-green/5 blur-[120px] rounded-full pointer-events-none" />
    </section>
  );
}
