"use client";

import { motion } from 'framer-motion';

interface TokenFlow25DProps {
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut?: string;
  isSuccess: boolean;
}

export default function TokenFlow25D({ tokenIn, tokenOut, amountIn, amountOut, isSuccess }: TokenFlow25DProps) {
  // Isometric perspective container
  // 3 Nodes: Input -> Router -> Output
  
  return (
    <div className="relative w-full h-48 flex items-center justify-center overflow-hidden bg-navy/5 rounded-xl border border-border perspective-[1000px]">
      <div 
        className="relative w-[240px] h-[240px]"
        style={{
          transformStyle: 'preserve-3d',
          transform: 'rotateX(60deg) rotateZ(-45deg)',
        }}
      >
        {/* Connecting Paths */}
        {/* Path 1: Source to Router */}
        <div className="absolute left-[40px] bottom-[40px] w-[113px] h-1 bg-navy/10 origin-bottom-left"
             style={{ transform: 'rotate(-45deg)' }} />
             
        {/* Path 2: Router to Dest */}
        <div className="absolute left-[120px] bottom-[120px] w-[113px] h-1 bg-navy/10 origin-bottom-left"
             style={{ transform: 'rotate(-45deg)' }} />

        {/* 1. Left Platform (Source Token) */}
        <div className="absolute left-0 bottom-0 w-20 h-20 bg-white/80 border-2 border-navy/10 rounded-xl shadow-[6px_6px_0_rgba(16,28,54,0.05)] flex flex-col items-center justify-center z-10"
             style={{ transform: 'translateZ(0)' }}>
           <div className="text-navy font-display font-bold text-lg rotate-[45deg]">{tokenIn}</div>
        </div>

        {/* 2. Middle Platform (Synthra Router) */}
        <div className="absolute left-[80px] bottom-[80px] w-20 h-20 bg-blue/10 border-2 border-blue/30 rounded-xl shadow-[6px_6px_0_rgba(59,130,f6,0.1)] flex flex-col items-center justify-center z-10"
             style={{ transform: 'translateZ(10px)' }}>
           <div className="text-blue font-display font-bold text-xs rotate-[45deg] text-center leading-tight">
             Synthra<br/>Router
           </div>
        </div>

        {/* 3. Right Platform (Destination Token) */}
        <div className="absolute left-[160px] bottom-[160px] w-20 h-20 bg-green/10 border-2 border-green/30 rounded-xl shadow-[6px_6px_0_rgba(31,203,79,0.1)] flex flex-col items-center justify-center z-10"
             style={{ transform: 'translateZ(0)' }}>
           <div className="text-green font-display font-bold text-lg rotate-[45deg]">{tokenOut}</div>
        </div>

        {/* Animated Token flowing (Step 1: to Router) */}
        <motion.div
          className="absolute left-[40px] bottom-[40px] w-5 h-5 rounded-full bg-navy border-2 border-white shadow-lg flex items-center justify-center z-20"
          initial={{ x: 0, y: 0, z: 20, scale: 0 }}
          animate={isSuccess ? { 
            x: [0, 80, 80, 160], 
            y: [0, -80, -80, -160], 
            z: [20, 30, 30, 20], 
            scale: [0, 1, 1, 0] 
          } : {
            x: [0, 80],
            y: [0, -80],
            z: [20, 30],
            scale: [0, 1]
          }}
          transition={isSuccess ? { 
            duration: 3, 
            repeat: Infinity, 
            ease: "easeInOut",
            times: [0, 0.4, 0.6, 1]
          } : {
            duration: 1,
            repeat: 0,
            ease: "easeOut"
          }}
          style={{ transformStyle: 'preserve-3d' }}
        >
          <div className="w-1.5 h-1.5 bg-white rounded-full rotate-[45deg]" />
        </motion.div>
        
        {/* Error Effect (Red burst if failed) at the Router */}
        {!isSuccess && (
          <motion.div
            className="absolute left-[100px] bottom-[100px] w-10 h-10 rounded-full border-4 border-coral bg-coral/20 z-30"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 2], opacity: [1, 0] }}
            transition={{ duration: 1.5, repeat: Infinity, delay: 1 }}
            style={{ transform: 'translateZ(20px) rotate(45deg)' }}
          />
        )}
      </div>
    </div>
  );
}
