import { useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import Link from 'next/link';
import Magnetic from '@/components/Magnetic';

interface NavigationProps {
  onNavigate: (target: string) => void;
}

export default function Navigation({ onNavigate }: NavigationProps) {
  const navRef = useRef<HTMLElement>(null);
  const [scrolled, setScrolled] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const lastScrollY = useRef(0);

  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      setScrolled(currentY > 80);
      if (currentY > 100) {
        setHidden(currentY > lastScrollY.current);
      } else {
        setHidden(false);
      }
      lastScrollY.current = currentY;
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (!navRef.current) return;
    gsap.to(navRef.current, {
      y: hidden ? '-100%' : '0%',
      duration: 0.35,
      ease: 'power2.out',
    });
  }, [hidden]);

  useEffect(() => {
    if (!navRef.current) return;
    gsap.fromTo(
      navRef.current,
      { opacity: 0, y: -20 },
      { opacity: 1, y: 0, duration: 1, ease: 'expo.out' }
    );
    const links = navRef.current.querySelectorAll('.nav-link');
    gsap.fromTo(
      links,
      { opacity: 0, y: -10 },
      { opacity: 1, y: 0, duration: 0.8, stagger: 0.05, delay: 0.3, ease: 'power3.out' }
    );
  }, []);

  const navLinks = [
    { label: 'How It Works', target: '#how-it-works' },
    { label: 'Market Pulse', target: '#market-pulse' },
    { label: 'Agent AI', target: '#agent-ai' },
    { label: 'Intelligence Vault', target: '#intelligence-vault' },
  ];

  return (
    <>
      <nav
        ref={navRef}
        className="fixed top-0 left-0 right-0 z-50 h-[88px] flex items-center opacity-0"
        style={{
          backgroundColor: scrolled ? 'rgba(16,28,54,0.85)' : 'transparent',
          backdropFilter: scrolled ? 'blur(20px)' : 'none',
          borderBottom: scrolled ? '1px solid rgba(255,255,255,0.05)' : 'none',
          transition: 'all 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        <div className="w-full max-w-[1440px] mx-auto page-padding flex items-center justify-between">
          {/* Logo with Magnetic effect */}
          <Magnetic>
            <button
              onClick={() => onNavigate('#hero')}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <span className="font-display font-bold text-2xl text-white tracking-tight">Aura</span>
            </button>
          </Magnetic>

          {/* Center Links - Desktop */}
          <div className="hidden md:flex items-center gap-10">
            {navLinks.map((link) => (
              <button
                key={link.target}
                onClick={() => onNavigate(link.target)}
                className="nav-link font-body font-medium text-[0.9rem] text-surface/60 hover:text-green transition-colors duration-200 cursor-pointer uppercase tracking-[0.1em]"
              >
                {link.label}
              </button>
            ))}
          </div>

          {/* Right - Connect Wallet & Perps */}
          <div className="w-[100px] lg:w-[480px]"></div>
          <div className="absolute right-[50px] flex items-center gap-1 cyber-uiv-container">
            <div className="hidden lg:block">
              <Link href="/vault" className="cyber-uiv-radio-wrapper block">
                <div className="cyber-uiv-btn text-sm">
                  <span aria-hidden="true">_</span>AI Vault
                  <span className="cyber-uiv-btn__glitch" aria-hidden="true">_Deposit🦾</span>
                  <label className="cyber-uiv-number">v1</label>
                </div>
              </Link>
            </div>
            <div className="hidden md:block">
              <Link href="/trade" className="cyber-uiv-radio-wrapper block">
                <div className="cyber-uiv-btn text-sm">
                  Launch Perp<span aria-hidden="true">_</span>
                  <span className="cyber-uiv-btn__glitch" aria-hidden="true">_Launch_</span>
                  <label className="cyber-uiv-number">v2</label>
                </div>
              </Link>
            </div>
            <div className="hidden md:block">
              <Link href="/chat" className="cyber-uiv-radio-wrapper block">
                <div className="cyber-uiv-btn">
                  DCA<span aria-hidden="true"></span>
                  <span className="cyber-uiv-btn__glitch" aria-hidden="true">_Launch_</span>
                  <label className="cyber-uiv-number">v3</label>
                </div>
              </Link>
            </div>

            <div className="hidden lg:block">
              <Link href="/benchmark" className="cyber-uiv-radio-wrapper block">
                <div className="cyber-uiv-btn text-sm">
                  <span aria-hidden="true">_</span>Bench
                  <span className="cyber-uiv-btn__glitch" aria-hidden="true">_WASM_</span>
                  <label className="cyber-uiv-number">⚡</label>
                </div>
              </Link>
            </div>

            {/* Hamburger - Mobile */}
            <button
              className="md:hidden flex flex-col gap-1.5 p-2 cursor-pointer"
              onClick={() => setMobileOpen(!mobileOpen)}
              aria-label="Toggle menu"
            >
              <span
                className={`block w-6 h-0.5 bg-white transition-transform duration-300 ${mobileOpen ? 'rotate-45 translate-y-2' : ''}`}
              />
              <span
                className={`block w-6 h-0.5 bg-white transition-opacity duration-300 ${mobileOpen ? 'opacity-0' : ''}`}
              />
              <span
                className={`block w-6 h-0.5 bg-white transition-transform duration-300 ${mobileOpen ? '-rotate-45 -translate-y-2' : ''}`}
              />
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      <div
        className={`fixed top-0 right-0 bottom-0 w-[280px] bg-navy z-[60] transform transition-transform duration-300 ease-out md:hidden ${mobileOpen ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <div className="pt-20 px-6 flex flex-col gap-6">
          {navLinks.map((link) => (
            <button
              key={link.target}
              onClick={() => {
                onNavigate(link.target);
                setMobileOpen(false);
              }}
              className="font-body font-medium text-lg text-white/80 hover:text-green transition-colors text-left cursor-pointer"
            >
              {link.label}
            </button>
          ))}
          <Link href="/chat">
            <button className="mt-4 bg-green text-white font-display font-semibold text-base px-6 py-3 rounded-xl hover:bg-green-hover transition-colors cursor-pointer w-full">
              Launch App
            </button>
          </Link>
        </div>
      </div>

      {/* Mobile Overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[55] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}
    </>
  );
}
