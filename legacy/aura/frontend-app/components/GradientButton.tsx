import { useState, type MouseEvent } from 'react';

interface GradientButtonProps {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
  size?: 'default' | 'large';
  className?: string;
  onClick?: () => void;
}

export default function GradientButton({
  children,
  variant = 'primary',
  size = 'default',
  className = '',
  onClick,
}: GradientButtonProps) {
  const [mousePosition, setMousePosition] = useState({ x: 50, y: 50 });

  const handleMouseMove = (e: MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;
    setMousePosition({ x, y });
  };

  const baseClasses =
    'relative overflow-hidden font-display font-semibold transition-all duration-250 cursor-pointer focus:outline-none focus:ring-2 focus:ring-green focus:ring-offset-2';

  const sizeClasses =
    size === 'large'
      ? 'px-10 py-[1.125rem] text-base rounded-xl'
      : 'px-8 py-4 text-base rounded-xl';

  const variantClasses =
    variant === 'primary'
      ? 'bg-green text-navy hover:bg-green-hover hover:scale-[1.03] active:scale-[0.98]'
      : 'bg-white/5 text-white border-[1px] border-white/20 backdrop-blur-md hover:bg-white/10 hover:border-white/30 active:scale-[0.98]';

  return (
    <button
      className={`${baseClasses} ${sizeClasses} ${variantClasses} group ${className}`}
      style={{ zIndex: 1 }}
      onMouseMove={handleMouseMove}
      onClick={onClick}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        {children}
        <span className="inline-flex transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1">
          ↗
        </span>
      </span>
      {variant === 'primary' && (
        <span
          className="pointer-events-none absolute inset-0 rounded-[inherit]"
          style={{
            zIndex: -1,
            background: `radial-gradient(circle at ${mousePosition.x}% ${mousePosition.y}%, rgba(255,255,255,0.25) 0%, transparent 60%)`,
            opacity: 0.8,
            transition: 'background 0.15s ease',
          }}
        />
      )}
    </button>
  );
}
