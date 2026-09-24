"use client";

import { useState } from "react";
import { BookOpen, X } from "lucide-react";
import { api } from "@/lib/api";
import { useQuery } from "@/hooks/use-api";
import { errorMessage, usd } from "@/lib/format";
import type { LessonResult } from "@/lib/types";
import { cn } from "@/lib/utils";
import { BloomCard } from "./card";
import { Skeleton } from "./states";
import { BloomButton } from "./button";

/** Daily lesson: 7 short lessons, a streak, and sponsored learning rewards. Deliberately secondary. */
export function LessonCard({ onComplete, delay }: { onComplete?: () => void; delay?: number }) {
  const { data, error, loading } = useQuery(api.learn);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<LessonResult | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (loading) return <Skeleton className="h-56 rounded-card" />;
  // Secondary content: if it can't load, step aside quietly (the page's main error covers it).
  if (error || !data) return null;

  const idx = Math.max(0, data.lessons.findIndex((l) => String(l.id) === String(data.todayLessonId)));
  const lesson = data.lessons[idx];
  if (!lesson) return null;
  const done = data.streak.completedToday || !!result?.correct;
  const streak = typeof result?.streak === "object" ? result.streak.days : typeof result?.streak === "number" ? result.streak : data.streak.days;

  async function submit() {
    if (choice === null) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const r = await api.completeLesson(lesson.id, choice);
      setResult(r);
      if (r.correct) onComplete?.();
    } catch (e) {
      setSubmitError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BloomCard tone="flat" delay={delay} aria-label="Daily lesson">
      <div className="flex items-center justify-between gap-3 text-sm text-muted">
        <span className="inline-flex items-center gap-2">
          <BookOpen className="size-4" /> Daily lesson · {idx + 1} of {data.lessons.length}
        </span>
        <span className="tabular">{streak > 0 ? `${streak}-day streak` : "Start a streak"}</span>
      </div>
      <div className="mt-3 flex gap-1" aria-hidden>
        {data.lessons.map((l, i) => (
          <span key={l.id} className={cn("h-1 flex-1 rounded-full", i < idx || (i === idx && done) ? "bg-pink-strong" : "bg-sunken")} />
        ))}
      </div>
      <h3 className="mt-5 font-semibold tracking-[-0.01em]">{lesson.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted">{lesson.body}</p>

      {done ? (
        <p className="mt-5 rounded-control bg-pink-soft px-4 py-3 text-sm">
          <span className="font-medium">Lesson complete.</span>{" "}
          {result?.reward ? `${result.reward.label}: +${usd(result.reward.amount)} USDG.` : "Come back tomorrow for the next one."}
        </p>
      ) : (
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">{lesson.quiz.question}</legend>
          <div className="mt-3 grid gap-2">
            {lesson.quiz.options.map((o, i) => (
              <label
                key={o}
                className={cn(
                  "flex items-center gap-3 rounded-control border px-4 py-3 text-sm transition-colors",
                  choice === i ? "border-ink bg-cream" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="lesson"
                  className="accent-[var(--bloom-ink)]"
                  checked={choice === i}
                  onChange={() => {
                    setChoice(i);
                    setResult(null);
                  }}
                />
                {o}
              </label>
            ))}
          </div>
          {result && !result.correct && (
            <p className="mt-3 flex items-center gap-1.5 text-sm" role="status">
              <X className="size-4 text-muted" /> Not quite. Give it another try.
            </p>
          )}
          {submitError && <p className="mt-3 text-sm" role="alert">{submitError}</p>}
          <div className="mt-4 flex items-center justify-between gap-3">
            <span className="text-xs text-muted">Sponsored learning rewards</span>
            <BloomButton size="sm" variant="quiet" disabled={choice === null} loading={busy} onClick={submit}>
              Check answer
            </BloomButton>
          </div>
        </fieldset>
      )}
    </BloomCard>
  );
}
