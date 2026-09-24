"use client";

interface CubeButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
  color?: string; // hex color for the cube edges, default gold
  type?: "button" | "submit";
}

export default function CubeButton({
  children,
  onClick,
  disabled = false,
  className = "",
  color = "#d4af37",
  type = "button",
}: CubeButtonProps) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`cube-btn group relative block px-4 py-2 bg-transparent border-0 font-mono text-xs font-bold cursor-pointer z-[1] tracking-wider uppercase transition-transform active:scale-[0.95] disabled:opacity-30 disabled:cursor-not-allowed ${className}`}
      style={{ color }}
    >
      {/* Top face */}
      <span
        className="absolute h-[8px] bottom-full left-[4px] right-[-4px] skew-x-[-45deg] transition-all duration-300 group-hover:!bg-[#28282d]"
        style={{ background: color }}
      >
        <span className="absolute inset-[2px] bg-[#28282d] transition-all duration-300 group-hover:!bg-current" style={{ ["--tw-bg-opacity" as any]: 1 }} />
      </span>
      {/* Right face */}
      <span
        className="absolute top-[-4px] bottom-[4px] w-[8px] left-full skew-y-[-45deg] transition-all duration-300 group-hover:!bg-[#28282d]"
        style={{ background: color }}
      >
        <span className="absolute inset-[2px] bg-[#28282d] transition-all duration-300 group-hover:!bg-current" />
      </span>
      {/* Main face */}
      <span
        className="absolute inset-0 transition-all duration-300 group-hover:!bg-[#28282d]"
        style={{ background: color }}
      >
        <span className="absolute inset-[2px] bg-[#28282d] transition-all duration-300 group-hover:!bg-current" />
      </span>
      {/* Text */}
      <span className="relative z-10 transition-all duration-300 group-hover:text-[#28282d]">
        {children}
      </span>
    </button>
  );
}
