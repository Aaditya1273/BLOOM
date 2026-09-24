import { useRef, useEffect } from 'react';

interface GridConfig {
  GRID_COLOR: [number, number, number];
  ACCENT_1: [number, number, number];
  ACCENT_2: [number, number, number];
  PULSE_SPEED: number;
  LINE_WIDTH: number;
  MAX_DEPTH: number;
}

const CONFIGS: Record<string, GridConfig> = {
  hero: {
    GRID_COLOR: [40, 50, 70],
    ACCENT_1: [31, 203, 79],
    ACCENT_2: [59, 130, 246],
    PULSE_SPEED: 0.03,
    LINE_WIDTH: 0.5,
    MAX_DEPTH: 800,
  },
  pulse: {
    GRID_COLOR: [30, 40, 60],
    ACCENT_1: [31, 203, 79],
    ACCENT_2: [232, 106, 86],
    PULSE_SPEED: 0.02,
    LINE_WIDTH: 0.4,
    MAX_DEPTH: 900,
  },
  cta: {
    GRID_COLOR: [30, 40, 60],
    ACCENT_1: [31, 203, 79],
    ACCENT_2: [139, 92, 246],
    PULSE_SPEED: 0.015,
    LINE_WIDTH: 0.4,
    MAX_DEPTH: 1000,
  },
  app: {
    GRID_COLOR: [248, 249, 251],
    ACCENT_1: [31, 203, 79],
    ACCENT_2: [139, 92, 246],
    PULSE_SPEED: 0.02,
    LINE_WIDTH: 0.3,
    MAX_DEPTH: 1200,
  },
};

interface AnimatedGridProps {
  config: 'hero' | 'pulse' | 'cta' | 'app';
  className?: string;
}

export default function AnimatedGrid({ config, className = '' }: AnimatedGridProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const isVisibleRef = useRef(true);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const activeConfig = CONFIGS[config];
    const { GRID_COLOR, ACCENT_1, ACCENT_2, PULSE_SPEED, LINE_WIDTH, MAX_DEPTH } = activeConfig;

    let W = 0;
    let H = 0;
    let time = 0;
    const mouse = { x: 0, y: 0 };
    const grid: any[] = [];

    function buildGrid() {
      grid.length = 0;
      const zStep = 100;

      for (let z = 0; z < MAX_DEPTH; z += zStep) {
        const rowScale = 300 / (300 + z);
        const opacity = 1 - z / MAX_DEPTH;

        if (opacity <= 0.05) continue;

        const cols = 7;
        const rows = 7;
        const cellW = (W / cols) * rowScale;
        const cellH = (H / rows) * rowScale;
        const offsetX = (W - cellW * cols) / 2;
        const offsetY = (H - cellH * rows) / 2;

        for (let x = 0; x <= cols; x++) {
          for (let y = 0; y <= rows; y++) {
            grid.push({
              x: offsetX + x * cellW,
              y: offsetY + y * cellH,
              baseX: x / cols,
              baseY: y / rows,
              z,
              scale: rowScale,
              opacity,
              isAccent: x % 3 === 0 && y % 3 === 0,
            });
          }
        }

        for (let x = 0; x <= cols - 1; x++) {
          for (let y = 0; y <= rows; y++) {
            const idx = y * (cols + 1) + x;
            const next = idx + 1;
            grid.push({ a: idx, b: next, type: 'h', z, opacity });
          }
        }

        for (let x = 0; x <= cols; x++) {
          for (let y = 0; y <= rows - 1; y++) {
            const idx = y * (cols + 1) + x;
            const below = idx + (cols + 1);
            grid.push({ a: idx, b: below, type: 'v', z, opacity });
          }
        }
      }
    }

    function resize() {
      W = canvas!.width = window.innerWidth * dpr;
      H = canvas!.height = window.innerHeight * dpr;
      buildGrid();
    }

    function onMouseMove(e: MouseEvent) {
      mouse.x = e.clientX * dpr;
      mouse.y = e.clientY * dpr;
    }

    const debouncedResize = (() => {
      let timer: ReturnType<typeof setTimeout>;
      return () => {
        clearTimeout(timer);
        timer = setTimeout(resize, 150);
      };
    })();

    window.addEventListener('resize', debouncedResize);
    window.addEventListener('mousemove', onMouseMove);
    resize();

    const observer = new IntersectionObserver(
      ([entry]) => {
        isVisibleRef.current = entry.isIntersecting;
      },
      { threshold: 0 }
    );
    observer.observe(canvas);

    function draw() {
      if (!isVisibleRef.current) {
        rafRef.current = requestAnimationFrame(draw);
        return;
      }

      ctx!.lineCap = 'round';
      ctx!.lineJoin = 'round';

      const centerX = W / 2;
      const centerY = H / 2;
      const dx = (mouse.x - centerX) * 0.0005;
      const dy = (mouse.y - centerY) * 0.0005;
      const shiftX = Math.sin(time * 0.001) * 30;
      const shiftY = Math.cos(time * 0.0015) * 20;

      for (let i = grid.length - 1; i >= 0; i--) {
        if (grid[i].type) continue;
        const p = { ...grid[i] };
        p.x += dx * p.z + shiftX * p.scale;
        p.y += dy * p.z + shiftY * p.scale;
        p._idx = i;
        grid[i] = p;
      }

      const lines: any[] = [];
      for (let i = grid.length - 1; i >= 0; i--) {
        const line = grid[i];
        if (!line.type) continue;
        if (!grid[line.a] || !grid[line.b]) continue;
        const pa = grid[line.a];
        const pb = grid[line.b];
        const mx = (pa.x + pb.x) / 2;
        const my = (pa.y + pb.y) / 2;
        const dist = Math.hypot(mx - mouse.x, my - mouse.y);
        const maxDist = 300;
        const highlight = dist < maxDist ? 1 - dist / maxDist : 0;
        lines.push({ pa, pb, highlight, type: line.type, z: line.z, opacity: line.opacity });
      }

      lines.sort((a, b) => b.z - a.z);

      ctx!.clearRect(0, 0, W, H);

      for (const line of lines) {
        const alpha = line.opacity * (0.3 + line.highlight * 0.7);
        if (alpha <= 0) continue;
        const r = GRID_COLOR[0] + (line.highlight * 60 | 0);
        const g = GRID_COLOR[1] + (line.highlight * 60 | 0);
        const b = GRID_COLOR[2] + (line.highlight * 60 | 0);
        ctx!.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
        ctx!.lineWidth = (LINE_WIDTH + line.highlight * 1.5) * dpr;
        ctx!.beginPath();
        ctx!.moveTo(line.pa.x, line.pa.y);
        ctx!.lineTo(line.pb.x, line.pb.y);
        ctx!.stroke();
      }

      const accents: any[] = [];
      for (let i = 0; i < grid.length; i++) {
        const node = grid[i];
        if (node.type) continue;
        if (node.opacity <= 0) continue;

        const pulse = Math.sin(time * PULSE_SPEED + node.baseX * 5 + node.baseY * 5) * 0.5 + 0.5;
        const dist = Math.hypot(node.x - mouse.x, node.y - mouse.y);
        const maxDist = 250;
        const hoverPulse = dist < maxDist ? Math.sin((1 - dist / maxDist) * Math.PI) * 0.8 : 0;

        if (node.isAccent) {
          const accentPulse = Math.sin(time * PULSE_SPEED * 1.5 + node.z * 0.01) * 0.5 + 0.5;
          const radius = (2.5 + accentPulse * 3 + node.z * 0.003) * dpr;
          const alpha = (0.6 + accentPulse * 0.4) * node.opacity;
          const mix = Math.sin(node.baseX * 3 + node.baseY * 2 + time * 0.002);
          const t = (mix + 1) / 2;
          const r = ACCENT_1[0] + (ACCENT_2[0] - ACCENT_1[0]) * t;
          const g = ACCENT_1[1] + (ACCENT_2[1] - ACCENT_1[1]) * t;
          const b = ACCENT_1[2] + (ACCENT_2[2] - ACCENT_1[2]) * t;
          accents.push({ x: node.x, y: node.y, radius, r, g, b, alpha });
        } else {
          const radius = (1.2 + pulse * 1.2 + node.z * 0.002 + hoverPulse * 2) * dpr;
          const alpha = (0.5 + pulse * 0.3 + hoverPulse * 0.5) * node.opacity;
          const r = GRID_COLOR[0] + (hoverPulse * 80 | 0);
          const g = GRID_COLOR[1] + (hoverPulse * 80 | 0);
          const b = GRID_COLOR[2] + (hoverPulse * 80 | 0);
          accents.push({ x: node.x, y: node.y, radius, r, g, b, alpha });
        }
      }

      accents.sort((a, b) => a.radius - b.radius);

      for (const accent of accents) {
        ctx!.fillStyle = `rgba(${accent.r | 0},${accent.g | 0},${accent.b | 0},${accent.alpha})`;
        ctx!.beginPath();
        ctx!.arc(accent.x, accent.y, accent.radius, 0, Math.PI * 2);
        ctx!.fill();
      }

      time += 1;
      rafRef.current = requestAnimationFrame(draw);
    }

    rafRef.current = requestAnimationFrame(draw);

    return () => {
      window.removeEventListener('resize', debouncedResize);
      window.removeEventListener('mousemove', onMouseMove);
      cancelAnimationFrame(rafRef.current);
      observer.disconnect();
    };
  }, [config]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 0 }}
    />
  );
}
