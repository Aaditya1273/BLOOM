import { useEffect, useRef } from 'react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

const traits = [
  { name: 'Risk-Aware', desc: 'Adjusts allocation based on volatility metrics' },
  { name: 'Trend-Responsive', desc: 'Increases DCA frequency during dips' },
  { name: 'Gas-Optimized', desc: 'Batches transactions to minimize fees' },
  { name: 'Non-Custodial', desc: 'Your funds, your keys, always' },
];

export default function Persona() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!sectionRef.current) return;

    const leftItems = sectionRef.current.querySelectorAll('.persona-left-item');
    const mascot = sectionRef.current.querySelector('.persona-mascot');
    const traitItems = sectionRef.current.querySelectorAll('.trait-item');

    const tl = gsap.timeline({
      scrollTrigger: {
        trigger: sectionRef.current,
        start: 'top 80%',
        toggleActions: 'play none none none',
      },
    });

    tl.fromTo(
      leftItems,
      { x: -30, opacity: 0 },
      { x: 0, opacity: 1, duration: 0.7, stagger: 0.12, ease: 'power3.out' }
    );

    if (mascot) {
      tl.fromTo(
        mascot,
        { x: 60, opacity: 0 },
        { x: 0, opacity: 1, duration: 1, ease: 'power3.out' },
        0.2
      );
    }

    tl.fromTo(
      traitItems,
      { y: 20, opacity: 0 },
      { y: 0, opacity: 1, duration: 0.5, stagger: 0.1, ease: 'power3.out' },
      '-=0.5'
    );

    return () => { tl.kill(); };
  }, []);

  return (
    <section
      id="agent-ai"
      ref={sectionRef}
      className="bg-white section-padding"
    >
      <div className="max-w-[1280px] mx-auto page-padding">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
          {/* Left Column - Content */}
          <div>
            <span className="persona-left-item eyebrow text-green opacity-0">
              MEET YOUR AGENT
            </span>

            <h2
              className="persona-left-item font-display font-semibold text-navy mt-4 tracking-[-0.02em] opacity-0"
              style={{ fontSize: 'clamp(2rem, 5vw, 3.5rem)', lineHeight: 0.95 }}
            >
              The Brain Behind Your Portfolio
            </h2>

            <p className="persona-left-item font-body text-text-secondary mt-4 max-w-[440px] opacity-0">
              Our DCA Agent isn't just a scheduler — it's an intelligent system that analyzes market trends, manages risk, and optimizes your entries. Think of it as your personal quant, working 24/7.
            </p>

            {/* Trait List */}
            <div className="mt-8 flex flex-col gap-4">
              {traits.map((trait) => (
                <div key={trait.name} className="trait-item flex items-start gap-3 opacity-0">
                  <span className="w-2 h-2 rounded-full bg-green mt-2 shrink-0" />
                  <div>
                    <span className="font-display font-medium text-navy">{trait.name}</span>
                    <span className="font-body text-text-secondary text-sm ml-2">
                      — {trait.desc}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Persona Quote */}
            <div className="persona-left-item mt-10 border-l-[3px] border-green pl-4 opacity-0">
              <p className="font-display font-medium italic text-navy text-lg leading-relaxed">
                "I buy when you're sleeping. I buy when you're fearful. I buy when you're euphoric. Consistency beats timing."
              </p>
              <p className="font-mono-label text-xs text-text-secondary mt-2">
                — The DCA Agent
              </p>
            </div>
          </div>

          {/* Right Column - Mascot */}
          <div className="persona-mascot relative flex items-center justify-center opacity-0">
            {/* Glow Background */}
            <div
              className="absolute w-[500px] h-[500px] rounded-full pointer-events-none"
              style={{
                background: 'radial-gradient(circle, rgba(31,203,79,0.08) 0%, transparent 70%)',
                animation: 'pulse-dot 4s ease-in-out infinite',
              }}
            />

            {/* Mascot */}
            <div
              className="relative z-10"
              style={{ animation: 'float 5s ease-in-out infinite' }}
            >
              <img
                src="/assets/ai-mascot-persona.png"
                alt="AI Agent Persona"
                className="w-[300px] md:w-[400px] h-auto"
              />

              {/* Speech Bubble */}
              <div
                className="absolute -top-4 -right-4 bg-white rounded-xl px-4 py-2 shadow-lg"
                role="status"
                style={{
                  animation: 'speech-bubble 4s infinite 2s',
                }}
              >
                <span className="font-display font-medium text-navy text-sm">
                  On it! 🔄
                </span>
                {/* Tail */}
                <div
                  className="absolute bottom-0 left-4 w-3 h-3 bg-white transform rotate-45 translate-y-1/2"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
