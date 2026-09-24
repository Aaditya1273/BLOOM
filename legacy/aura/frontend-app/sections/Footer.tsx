import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Link from 'next/link';

gsap.registerPlugin(ScrollTrigger);

const footerLinks = {
  Product: [
    { label: 'How It Works', href: '#how-it-works' },
    { label: 'Market Pulse', href: '#market-pulse' },
    { label: 'Agent AI', href: '#agent-ai' },
    { label: 'Documentation', href: '/whitepaper' },
  ],
  Community: [
    { label: 'GitHub', href: 'https://github.com/maxence81/Aura-Protocol' },
  ],
};

export default function Footer() {
  const footerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!footerRef.current) return;

    const content = footerRef.current.querySelectorAll('.footer-content');

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: footerRef.current,
        start: 'top 90%',
        toggleActions: 'play none none none',
      },
    });

    tl.fromTo(content, { opacity: 0 }, { opacity: 1, duration: 0.6, stagger: 0.1 });

    return () => { tl.kill(); };
  }, []);

  return (
    <footer ref={footerRef} className="bg-navy pt-12 pb-8">
      <div className="max-w-[1280px] mx-auto page-padding">
        {/* Top Row */}
        <div className="footer-content flex items-center justify-between opacity-0">
          <div className="flex items-center gap-2">
            <span className="font-display font-bold text-xl text-white">Aura Protocol</span>
          </div>

          <div className="flex items-center gap-3">
            {/* GitHub */}
            <a
              href="https://github.com/maxence81/Aura-Protocol"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center hover:bg-green transition-colors duration-200"
              aria-label="GitHub"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
            </a>
          </div>
        </div>

        {/* Divider */}
        <div className="footer-content w-full h-px bg-white/10 my-8 opacity-0" />

        {/* Link Columns */}
        <div className="footer-content grid grid-cols-2 gap-8 opacity-0">
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h4 className="font-display font-medium text-sm text-white mb-4">
                {category}
              </h4>
              <ul className="flex flex-col gap-3">
                {links.map((link) => (
                  <li key={link.label}>
                    <a href={link.href} className="font-body text-sm text-white/50 hover:text-white transition-colors duration-200">
                      {link.label}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Copyright */}
        <div className="footer-content w-full h-px bg-white/10 my-8 opacity-0" />
        <div className="footer-content flex flex-col sm:flex-row items-center justify-between gap-4 opacity-0 mb-20">
          <span className="font-mono-label text-xs text-white/35">
            © 2026 Aura Agent. Robinhood Chain.
          </span>
          <div className="flex items-center gap-6">
            <a href="#" className="font-mono-label text-xs text-white/35 hover:text-white transition-colors">
              Terms
            </a>
            <a href="#" className="font-mono-label text-xs text-white/35 hover:text-white transition-colors">
              Privacy
            </a>
          </div>
        </div>

        {/* Huge Footer Text */}
        <div className="footer-content text-center opacity-0 overflow-hidden pointer-events-none select-none">
          <h2 className="font-display font-bold text-white/[0.03] leading-none" style={{ fontSize: 'clamp(5rem, 20vw, 25rem)' }}>
            AURA
          </h2>
        </div>
      </div>
    </footer>
  );
}
