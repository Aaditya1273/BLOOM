"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { EASE } from "./card";
import { BloomMark } from "./logo";

/** A chat turn. User: ink bubble on the right. Bloom: plain text beside the mark, like a thoughtful reply. */
export function ChatMessage({ role, children, className }: { role: "user" | "assistant"; children: ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: EASE }}
      className={cn(role === "user" ? "flex justify-end" : "flex items-start gap-3", className)}
    >
      {role === "user" ? (
        <p className="max-w-[85%] rounded-card rounded-br-chip bg-ink px-4 py-2.5 text-[15px] text-surface">{children}</p>
      ) : (
        <>
          <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-pink-soft" aria-hidden>
            <BloomMark size={18} />
          </span>
          <div className="min-w-0 flex-1 space-y-3 pt-1 text-[15px] leading-relaxed">{children}</div>
        </>
      )}
    </motion.div>
  );
}
