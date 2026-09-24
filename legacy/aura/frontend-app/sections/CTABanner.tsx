"use client";

import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import AnimatedGrid from '@/components/AnimatedGrid';
import GradientButton from '@/components/GradientButton';
import Magnetic from '@/components/Magnetic';
import Link from 'next/link';

gsap.registerPlugin(ScrollTrigger);

export default function CTABanner() {
  const sectionRef = useRef<HTMLElement>(null);
  const bgRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const h2 = sectionRef.current.querySelector('.cta-h2');
    const subtitle = sectionRef.current.querySelector('.cta-subtitle');
    const btn = sectionRef.current.querySelector('.cta-btn');

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 80%',
        toggleActions: 'play none none none',
      },
    });

    if (h2) {
      tl.fromTo(h2, { y: 60, opacity: 0, scale: 0.9 }, { y: 0, opacity: 1, scale: 1, duration: 1, ease: 'expo.out' });
    }

    if (subtitle) {
      tl.fromTo(subtitle, { opacity: 0, y: 20 }, { opacity: 1, y: 0, duration: 0.8 }, '-=0.6');
    }

    if (btn) {
      tl.fromTo(btn, { scale: 0.8, opacity: 0 }, { scale: 1, opacity: 1, duration: 0.8, ease: 'back.out(1.7)' }, '-=0.4');
    }

    // Parallax background
    gsap.fromTo(bgRef.current, 
      { scale: 1.2, opacity: 0.5 },
      { 
        scale: 1, 
        opacity: 1, 
        duration: 2, 
        ease: 'power2.out',
        scrollTrigger: {
          trigger: sectionRef.current,
          start: 'top 90%',
          scrub: true
        }
      }
    );

    return () => { tl.kill(); };
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden py-60 bg-[#05070a]"
    >
      <div 
        ref={bgRef}
        className="absolute inset-0 z-0"
        style={{
          background: 'radial-gradient(circle at center, #1A2B4A 0%, #05070a 70%)',
        }}
      />
      
      <AnimatedGrid config="cta" className="opacity-40" />

      <div className="relative z-10 max-w-[1440px] mx-auto page-padding text-center flex flex-col items-center">
        <h2
          className="cta-h2 font-display font-bold text-white tracking-[-0.04em] opacity-0 mb-8 uppercase flex flex-col"
          style={{ fontSize: 'clamp(3rem, 8vw, 6.5rem)', lineHeight: 0.85 }}
        >
          <span>Elevate Your</span>
          <span className="text-green">Wealth Layer</span>
        </h2>

        <p className="cta-subtitle font-body text-white/50 text-2xl mt-4 opacity-0 max-w-[600px] font-light">
          Your personal AI agent is ready to optimize your portfolio with policy-guaranteed safety.
        </p>

        <div className="cta-btn mt-16 opacity-0">
          <Magnetic>
            <Link href="/chat">
              <GradientButton
                variant="primary"
                size="large"
                className="px-14 py-6 text-xl shadow-[0_0_100px_rgba(31,203,79,0.2)] hover:shadow-[0_0_100px_rgba(31,203,79,0.4)]"
              >
                Launch Aura Terminal
              </GradientButton>
            </Link>
          </Magnetic>
        </div>
      </div>

      {/* Decorative Orbs */}
      <div className="absolute left-[10%] top-[20%] w-64 h-64 bg-green/10 blur-[120px] rounded-full animate-pulse" />
      <div className="absolute right-[15%] bottom-[10%] w-96 h-96 bg-blue/10 blur-[150px] rounded-full animate-pulse" style={{ animationDelay: '1s' }} />
    </section>
  );
}
