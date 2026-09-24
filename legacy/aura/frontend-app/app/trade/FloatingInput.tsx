"use client";

interface FloatingInputProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  type?: string;
  color?: string;
}

export default function FloatingInput({ label, value, onChange, type = "number", color = "#00f0ff" }: FloatingInputProps) {
  return (
    <div className="relative w-full">
      <input
        required
        type={type}
        autoComplete="off"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="floating-input w-full bg-transparent border-[1.5px] rounded-lg px-3 py-2 text-[10px] font-mono transition-all duration-150 focus:outline-none peer"
        style={{
          borderColor: value ? color : "#9e9e9e60",
          color,
        }}
        onFocus={(e) => { e.target.style.borderColor = color; }}
        onBlur={(e) => { if (!value) e.target.style.borderColor = "#9e9e9e60"; }}
      />
      <label
        className="absolute left-3 pointer-events-none transition-all duration-150 text-[9px] font-mono"
        style={{
          color: value ? color : "#e8e8e880",
          transform: value ? "translateY(-50%) scale(0.85)" : "translateY(0.55rem)",
          top: value ? "0" : "0",
          backgroundColor: value ? "#050505" : "transparent",
          padding: value ? "0 0.2em" : "0",
        }}
      >
        {label}
      </label>
    </div>
  );
}
