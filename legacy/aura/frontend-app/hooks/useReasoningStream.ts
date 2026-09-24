"use client";

import { useState, useCallback, useRef } from 'react';
import type { ReasoningStep } from '@/types';

/**
 * Hook that consumes the /chat-stream SSE endpoint for real-time
 * reasoning steps from the multi-agent committee.
 * Falls back to simulated steps if SSE is not used.
 */
export function useReasoningStream() {
  const [steps, setSteps] = useState<ReasoningStep[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const startTimeRef = useRef<number>(0);

  const startStream = useCallback(() => {
    setSteps([]);
    setIsStreaming(true);
    startTimeRef.current = Date.now();
  }, []);

  /** Called by the chat page when an SSE step arrives from the backend. */
  const pushStep = useCallback((step: ReasoningStep) => {
    const elapsed = Date.now() - startTimeRef.current;
    setSteps((prev) => {
      const existing = prev.findIndex((s) => s.id === step.id);
      const enriched = { ...step, durationMs: step.durationMs || elapsed };
      if (existing >= 0) {
        const next = [...prev];
        next[existing] = enriched;
        return next;
      }
      return [...prev, enriched];
    });
  }, []);

  const resolveStream = useCallback(() => {
    setSteps((prev) =>
      prev.map((s) => ({ ...s, status: 'done' as const }))
    );
    setTimeout(() => setIsStreaming(false), 600);
  }, []);

  const resetStream = useCallback(() => {
    setSteps([]);
    setIsStreaming(false);
  }, []);

  return { steps, isStreaming, startStream, pushStep, resolveStream, resetStream };
}
