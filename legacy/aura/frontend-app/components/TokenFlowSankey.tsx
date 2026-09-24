"use client";

import { motion } from 'framer-motion';
import { useEffect, useState, useId } from 'react';

interface TokenFlowSankeyProps {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut?: string;
  isSuccess: boolean;
  gasUsed?: string;
}

// Token color mapping
const TOKEN_COLORS: Record<string, { bg: string; glow: string; gradient: [string, string] }> = {
  ETH:  { bg: '#627EEA', glow: 'rgba(98,126,234,0.5)',  gradient: ['#627EEA', '#8B9EF8'] },
  WETH: { bg: '#627EEA', glow: 'rgba(98,126,234,0.5)',  gradient: ['#627EEA', '#8B9EF8'] },
  TSLA: { bg: '#E31937', glow: 'rgba(227,25,55,0.5)',   gradient: ['#E31937', '#FF4D63'] },
  AMZN: { bg: '#FF9900', glow: 'rgba(255,153,0,0.5)',   gradient: ['#FF9900', '#FFB84D'] },
  BTC:  { bg: '#F7931A', glow: 'rgba(247,147,26,0.5)',  gradient: ['#F7931A', '#FFAA44'] },
};
const DEFAULT_COLOR = { bg: '#1FCB4F', glow: 'rgba(31,203,79,0.5)', gradient: ['#1FCB4F', '#4AE571'] as [string, string] };

function getTokenColor(token: string) {
  return TOKEN_COLORS[token.toUpperCase()] || DEFAULT_COLOR;
}

// Ethereum diamond SVG icon
function EthIcon({ x, y, size = 12 }: { x: number; y: number; size?: number }) {
  const half = size / 2;
  return (
    <g transform={`translate(${x - half}, ${y - half})`}>
      <polygon points={`${half},0 ${size},${half} ${half},${size * 0.65} 0,${half}`} fill="#627EEA" opacity="0.9" />
      <polygon points={`${half},${size * 0.65} ${size},${half} ${half},${size} 0,${half}`} fill="#3C5BD0" opacity="0.8" />
    </g>
  );
}

export default function TokenFlowSankey({ tokenIn, tokenOut, amountIn, amountOut, isSuccess, gasUsed }: TokenFlowSankeyProps) {
  const [mounted, setMounted] = useState(false);
  const uid = useId().replace(/:/g, '');
  useEffect(() => setMounted(true), []);

  const colorIn = getTokenColor(tokenIn);
  const colorOut = getTokenColor(tokenOut);
  const routerColor = '#8B5CF6';

  // Wider, more dramatic curves
  const path1 = "M 70,90 C 130,90 140,75 200,75";
  const path2 = "M 200,75 C 260,75 270,90 330,90";

  if (!mounted) return <div className="w-full h-52 rounded-2xl animate-pulse" style={{ background: 'linear-gradient(135deg, #0D1321, #101C36)' }} />;

  return (
    <div className="relative w-full rounded-2xl overflow-hidden" style={{ height: 210 }}>
      {/* Deep dark background with radial light */}
      <div className="absolute inset-0" style={{
        background: 'linear-gradient(135deg, #080E1A 0%, #0D1527 30%, #101C36 50%, #0D1527 70%, #080E1A 100%)',
      }} />

      {/* Animated scan line */}
      <motion.div
        className="absolute left-0 right-0 h-px"
        style={{ background: 'linear-gradient(90deg, transparent, rgba(139,92,246,0.3), transparent)' }}
        animate={{ top: ['0%', '100%', '0%'] }}
        transition={{ duration: 6, repeat: Infinity, ease: 'linear' }}
      />

      {/* Subtle dot grid */}
      <div className="absolute inset-0 opacity-[0.04]" style={{
        backgroundImage: 'radial-gradient(circle, rgba(255,255,255,0.8) 1px, transparent 1px)',
        backgroundSize: '16px 16px',
      }} />

      {/* Center ambient glow */}
      <motion.div
        className="absolute rounded-full"
        style={{
          width: 140, height: 140,
          left: '50%', top: '50%',
          transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${isSuccess ? 'rgba(139,92,246,0.12)' : 'rgba(232,106,86,0.12)'} 0%, transparent 70%)`,
        }}
        animate={{ scale: [1, 1.5, 1], opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Source glow */}
      <motion.div className="absolute rounded-full"
        style={{ width: 80, height: 80, left: '12%', top: '35%', transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${colorIn.glow.replace('0.5', '0.08')} 0%, transparent 70%)`
        }}
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Dest glow */}
      <motion.div className="absolute rounded-full"
        style={{ width: 80, height: 80, left: '88%', top: '35%', transform: 'translate(-50%, -50%)',
          background: `radial-gradient(circle, ${isSuccess ? colorOut.glow.replace('0.5', '0.08') : 'rgba(232,106,86,0.08)'} 0%, transparent 70%)`
        }}
        animate={{ opacity: [0.3, 0.6, 0.3] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: 1.5 }}
      />

      <svg viewBox="0 0 400 180" className="absolute inset-0 w-full h-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {/* Glow filters */}
          <filter id={`glow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="4" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`glow-strong-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="8" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id={`shadow-${uid}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow dx="0" dy="2" stdDeviation="4" floodColor="rgba(0,0,0,0.5)" />
          </filter>

          {/* Path 1 gradient (wide pipe) */}
          <linearGradient id={`pipe1-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colorIn.bg} stopOpacity="0.25" />
            <stop offset="50%" stopColor={routerColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={routerColor} stopOpacity="0.1" />
          </linearGradient>
          {/* Path 2 gradient (wide pipe) */}
          <linearGradient id={`pipe2-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={routerColor} stopOpacity="0.1" />
            <stop offset="50%" stopColor={routerColor} stopOpacity="0.15" />
            <stop offset="100%" stopColor={isSuccess ? colorOut.bg : '#E86A56'} stopOpacity="0.25" />
          </linearGradient>

          {/* Flow line gradient 1 */}
          <linearGradient id={`flow1-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={colorIn.gradient[1]} stopOpacity="1" />
            <stop offset="100%" stopColor={routerColor} stopOpacity="0.8" />
          </linearGradient>
          {/* Flow line gradient 2 */}
          <linearGradient id={`flow2-${uid}`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={routerColor} stopOpacity="0.8" />
            <stop offset="100%" stopColor={isSuccess ? colorOut.gradient[1] : '#E86A56'} stopOpacity="1" />
          </linearGradient>

          {/* Node gradients */}
          <radialGradient id={`node-in-${uid}`}>
            <stop offset="0%" stopColor={colorIn.gradient[1]} stopOpacity="0.2" />
            <stop offset="100%" stopColor={colorIn.bg} stopOpacity="0.05" />
          </radialGradient>
          <radialGradient id={`node-out-${uid}`}>
            <stop offset="0%" stopColor={isSuccess ? colorOut.gradient[1] : '#E86A56'} stopOpacity="0.2" />
            <stop offset="100%" stopColor={isSuccess ? colorOut.bg : '#E86A56'} stopOpacity="0.05" />
          </radialGradient>
          <radialGradient id={`node-router-${uid}`}>
            <stop offset="0%" stopColor="#C4B5FD" stopOpacity="0.15" />
            <stop offset="100%" stopColor={routerColor} stopOpacity="0.05" />
          </radialGradient>

          {/* Animated dash for energy trail */}
          <linearGradient id={`energy-${uid}`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="50%" stopColor="white" stopOpacity="0.8" />
            <stop offset="100%" stopColor="white" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* ═══ FLOW PIPES (wide, glowing pipes) ═══ */}
        <path d={path1} fill="none" stroke={`url(#pipe1-${uid})`} strokeWidth="22" strokeLinecap="round" />
        <path d={path2} fill="none" stroke={`url(#pipe2-${uid})`} strokeWidth="22" strokeLinecap="round" />

        {/* Inner highlight lines */}
        <motion.path
          d={path1} fill="none" stroke={`url(#flow1-${uid})`} strokeWidth="2.5" strokeLinecap="round"
          filter={`url(#glow-${uid})`}
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 1.2, ease: 'easeOut' }}
        />
        {isSuccess && (
          <motion.path
            d={path2} fill="none" stroke={`url(#flow2-${uid})`} strokeWidth="2.5" strokeLinecap="round"
            filter={`url(#glow-${uid})`}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 1.2, delay: 0.6, ease: 'easeOut' }}
          />
        )}

        {/* Energy dash lines */}
        <motion.path
          d={path1} fill="none" stroke={colorIn.bg} strokeWidth="1" strokeLinecap="round"
          strokeDasharray="4 12"
          initial={{ strokeDashoffset: 0 }}
          animate={{ strokeDashoffset: -48 }}
          transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
          opacity={0.4}
        />
        {isSuccess && (
          <motion.path
            d={path2} fill="none" stroke={colorOut.bg} strokeWidth="1" strokeLinecap="round"
            strokeDasharray="4 12"
            initial={{ strokeDashoffset: 0 }}
            animate={{ strokeDashoffset: -48 }}
            transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
            opacity={0.4}
          />
        )}

        {/* ═══ PARTICLES ═══ */}
        {isSuccess && [0, 1, 2, 3].map(i => (
          <g key={`p1-${i}`}>
            {/* Particle trail (larger, fading) */}
            <circle r="6" fill={colorIn.bg} opacity="0.1">
              <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${i * 0.6}s`} path={path1} />
              <animate attributeName="opacity" values="0;0.15;0.15;0" dur="2.5s" repeatCount="indefinite" begin={`${i * 0.6}s`} />
            </circle>
            {/* Particle core */}
            <circle r="2.5" fill={colorIn.gradient[1]} filter={`url(#glow-${uid})`}>
              <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${i * 0.6}s`} path={path1} />
              <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" repeatCount="indefinite" begin={`${i * 0.6}s`} />
            </circle>
            {/* White hot center */}
            <circle r="1" fill="white" opacity="0.9">
              <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${i * 0.6}s`} path={path1} />
              <animate attributeName="opacity" values="0;0.9;0.9;0" dur="2.5s" repeatCount="indefinite" begin={`${i * 0.6}s`} />
            </circle>
          </g>
        ))}

        {isSuccess && [0, 1, 2, 3].map(i => (
          <g key={`p2-${i}`}>
            <circle r="6" fill={colorOut.bg} opacity="0.1">
              <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${0.8 + i * 0.6}s`} path={path2} />
              <animate attributeName="opacity" values="0;0.15;0.15;0" dur="2.5s" repeatCount="indefinite" begin={`${0.8 + i * 0.6}s`} />
            </circle>
            <circle r="2.5" fill={isSuccess ? colorOut.gradient[1] : '#E86A56'} filter={`url(#glow-${uid})`}>
              <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${0.8 + i * 0.6}s`} path={path2} />
              <animate attributeName="opacity" values="0;1;1;0" dur="2.5s" repeatCount="indefinite" begin={`${0.8 + i * 0.6}s`} />
            </circle>
            <circle r="1" fill="white" opacity="0.9">
              <animateMotion dur="2.5s" repeatCount="indefinite" begin={`${0.8 + i * 0.6}s`} path={path2} />
              <animate attributeName="opacity" values="0;0.9;0.9;0" dur="2.5s" repeatCount="indefinite" begin={`${0.8 + i * 0.6}s`} />
            </circle>
          </g>
        ))}

        {/* ═══ ERROR STATE ═══ */}
        {!isSuccess && (
          <>
            {[0, 0.5, 1].map((delay, i) => (
              <motion.circle key={`err-${i}`}
                cx="200" cy="75" r="10"
                fill="none" stroke="#E86A56" strokeWidth="1.5"
                initial={{ r: 5, opacity: 0.8 }}
                animate={{ r: 35, opacity: 0 }}
                transition={{ duration: 2, repeat: Infinity, delay }}
              />
            ))}
            <text x="200" y="115" textAnchor="middle" fill="#E86A56" fontSize="7" fontFamily="Space Mono, monospace" fontWeight="bold" opacity="0.8">
              ✕ TRANSACTION REVERTED
            </text>
          </>
        )}

        {/* ═══ SOURCE NODE ═══ */}
        <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, type: 'spring', bounce: 0.3 }}>
          {/* Outer ring */}
          <circle cx="55" cy="90" r="28" fill={`url(#node-in-${uid})`} />
          <motion.circle cx="55" cy="90" r="28" fill="none" stroke={colorIn.bg} strokeWidth="1" opacity="0.2"
            strokeDasharray="4 4"
            animate={{ strokeDashoffset: [0, -24] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          />
          {/* Main circle */}
          <circle cx="55" cy="90" r="20" fill="#0A0F1C" stroke={colorIn.bg} strokeWidth="2" filter={`url(#shadow-${uid})`} />
          {/* Inner glow */}
          <circle cx="55" cy="90" r="18" fill="none" stroke={colorIn.gradient[1]} strokeWidth="0.5" opacity="0.4" />
          {/* Token text */}
          <text x="55" y="94" textAnchor="middle" fill={colorIn.gradient[1]} fontSize="10" fontWeight="bold" fontFamily="Space Grotesk, sans-serif">
            {tokenIn}
          </text>
        </motion.g>

        {/* ═══ ROUTER NODE ═══ */}
        <motion.g initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.6, delay: 0.3, type: 'spring', bounce: 0.3 }}>
          <circle cx="200" cy="75" r="32" fill={`url(#node-router-${uid})`} />
          {/* Rotating ring */}
          <motion.circle cx="200" cy="75" r="32" fill="none" stroke={isSuccess ? routerColor : '#E86A56'} strokeWidth="1" opacity="0.3"
            strokeDasharray="8 4"
            animate={{ strokeDashoffset: [0, -36] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'linear' }}
          />
          {/* Second rotating ring (opposite) */}
          <motion.circle cx="200" cy="75" r="28" fill="none" stroke={isSuccess ? '#C4B5FD' : '#E86A56'} strokeWidth="0.5" opacity="0.2"
            strokeDasharray="6 6"
            animate={{ strokeDashoffset: [0, 36] }}
            transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          />
          {/* Hexagon */}
          <polygon
            points="200,50 224,62.5 224,87.5 200,100 176,87.5 176,62.5"
            fill="#0A0F1C"
            stroke={isSuccess ? routerColor : '#E86A56'}
            strokeWidth="2"
          />
          {/* Inner hexagon glow */}
          <polygon
            points="200,54 221,64.5 221,85.5 200,96 179,85.5 179,64.5"
            fill="none"
            stroke={isSuccess ? '#C4B5FD' : '#E86A56'}
            strokeWidth="0.5"
            opacity="0.3"
          />
          {/* Text */}
          <text x="200" y="73" textAnchor="middle" fill={isSuccess ? '#DDD6FE' : '#E86A56'} fontSize="8" fontWeight="bold" fontFamily="Space Grotesk, sans-serif">
            SYNTHRA
          </text>
          <text x="200" y="84" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="6" fontFamily="Space Mono, monospace">
            ROUTER
          </text>
          {/* Pulse dot */}
          {isSuccess && (
            <motion.circle cx="200" cy="55" r="2" fill="#1FCB4F"
              animate={{ opacity: [1, 0.3, 1], r: [2, 3, 2] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
          )}
        </motion.g>

        {/* ═══ DESTINATION NODE ═══ */}
        <motion.g
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: isSuccess ? 1 : 0.6, opacity: isSuccess ? 1 : 0.4 }}
          transition={{ duration: 0.6, delay: 0.6, type: 'spring', bounce: 0.3 }}
        >
          <circle cx="345" cy="90" r="28" fill={`url(#node-out-${uid})`} />
          <motion.circle cx="345" cy="90" r="28" fill="none" stroke={isSuccess ? colorOut.bg : '#E86A56'} strokeWidth="1" opacity="0.2"
            strokeDasharray="4 4"
            animate={{ strokeDashoffset: [0, 24] }}
            transition={{ duration: 3, repeat: Infinity, ease: 'linear' }}
          />
          <circle cx="345" cy="90" r="20" fill="#0A0F1C" stroke={isSuccess ? colorOut.bg : '#E86A56'} strokeWidth="2" filter={`url(#shadow-${uid})`} />
          <circle cx="345" cy="90" r="18" fill="none" stroke={isSuccess ? colorOut.gradient[1] : '#E86A56'} strokeWidth="0.5" opacity="0.4" />
          <text x="345" y="94" textAnchor="middle" fill={isSuccess ? colorOut.gradient[1] : '#E86A56'} fontSize="10" fontWeight="bold" fontFamily="Space Grotesk, sans-serif">
            {tokenOut}
          </text>
        </motion.g>

        {/* ═══ LABELS ═══ */}
        {/* Source amount */}
        <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1, duration: 0.5 }}>
          <rect x="20" y="125" width="70" height="18" rx="4" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.08)" strokeWidth="0.5" />
          <text x="55" y="137" textAnchor="middle" fill="rgba(255,255,255,0.7)" fontSize="7" fontFamily="Space Mono, monospace" fontWeight="bold">
            {amountIn} {tokenIn}
          </text>
        </motion.g>

        {/* Gas fee label (center bottom) */}
        {gasUsed && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.2, duration: 0.5 }}>
            <rect x="160" y="125" width="80" height="18" rx="4" fill="rgba(139,92,246,0.08)" stroke="rgba(139,92,246,0.15)" strokeWidth="0.5" />
            <text x="172" y="137" fill="rgba(139,92,246,0.6)" fontSize="6" fontFamily="Space Mono, monospace">⛽</text>
            <text x="182" y="137" fill="rgba(255,255,255,0.5)" fontSize="6.5" fontFamily="Space Mono, monospace">
              {gasUsed} ETH
            </text>
          </motion.g>
        )}

        {/* Status indicator */}
        {isSuccess && (
          <motion.g initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.4, duration: 0.5 }}>
            <rect x="305" y="125" width="80" height="18" rx="4" fill="rgba(31,203,79,0.06)" stroke="rgba(31,203,79,0.15)" strokeWidth="0.5" />
            <motion.circle cx="316" cy="134" r="2.5" fill="#1FCB4F"
              animate={{ opacity: [1, 0.4, 1] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            />
            <text x="323" y="137" fill="rgba(31,203,79,0.8)" fontSize="6.5" fontFamily="Space Mono, monospace" fontWeight="bold">
              CONFIRMED
            </text>
          </motion.g>
        )}

        {/* Bottom connection line */}
        <motion.line
          x1="90" y1="134" x2="160" y2="134"
          stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"
          strokeDasharray="2 4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5 }}
        />
        {isSuccess && (
          <motion.line
            x1="240" y1="134" x2="305" y2="134"
            stroke="rgba(255,255,255,0.04)" strokeWidth="0.5"
            strokeDasharray="2 4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1.5 }}
          />
        )}
      </svg>
    </div>
  );
}
