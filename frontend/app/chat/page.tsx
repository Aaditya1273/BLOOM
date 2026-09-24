"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowUp, ArrowUpRight, PiggyBank, ShieldCheck, TrendingUp } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type { ChatResponse } from "@/lib/types";
import { errorMessage, kindFromError } from "@/lib/format";
import { ChatMessage } from "@/components/bloom/chat-message";
import { ActionConfirmation } from "@/components/bloom/action-confirmation";
import { ActionResult, ErrorState } from "@/components/bloom/states";
import { BloomMark } from "@/components/bloom/logo";

const SUGGESTIONS = [
  { label: "Send money", prompt: "Send Sarah $5 of QQQ.", icon: ArrowUpRight },
  { label: "Save for a goal", prompt: "Save $500 for my laptop by December 15.", icon: PiggyBank },
  { label: "Invest", prompt: "Put $20 into my conservative portfolio.", icon: TrendingUp },
  { label: "Check risk", prompt: "How risky is my QQQ?", icon: ShieldCheck },
];

type Msg =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; res: ChatResponse }
  | { id: number; role: "error"; error: unknown }
  | { id: number; role: "pending" };

let nextId = 0;

function Chat() {
  const params = useSearchParams();
  const [input, setInput] = useState(params.get("q") ?? "");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const busy = msgs.at(-1)?.role === "pending";
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // The composer is sticky at the bottom, so scroll the page itself to its end.
    if (msgs.length) window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
  }, [msgs]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setInput("");
    setMsgs((m) => [...m, { id: nextId++, role: "user", text: t }, { id: nextId++, role: "pending" }]);
    let reply: Msg;
    try {
      reply = { id: nextId++, role: "assistant", res: await api.chat(t) };
    } catch (e) {
      reply = { id: nextId++, role: "error", error: e };
    }
    setMsgs((m) => [...m.filter((x) => x.role !== "pending"), reply]);
  }

  const chips = (
    <div className="flex flex-wrap gap-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => {
            setInput(s.prompt);
            inputRef.current?.focus();
          }}
          className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium transition-colors hover:border-line-strong"
        >
          <s.icon className="size-4 text-muted" /> {s.label}
        </button>
      ))}
    </div>
  );

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-4rem-3rem-4rem)] max-w-2xl flex-col md:min-h-[calc(100dvh-4rem-3rem)]">
      <div className="flex-1 space-y-6 pb-6">
        {msgs.length === 0 && (
          <div className="pt-4 sm:pt-10">
            <span className="grid size-12 place-items-center rounded-full bg-pink-soft">
              <BloomMark size={26} animate />
            </span>
            <h1 className="mt-6 text-[2rem] leading-tight font-semibold tracking-[-0.035em] sm:text-4xl">What can Bloom do for you?</h1>
            <p className="mt-3 max-w-md text-[17px] text-muted">
              Send, save or invest in plain words. You&apos;ll always review and confirm before anything moves.
            </p>
            <div className="mt-8">{chips}</div>
          </div>
        )}

        {msgs.map((m) => {
          if (m.role === "user") return <ChatMessage key={m.id} role="user">{m.text}</ChatMessage>;
          if (m.role === "pending")
            return (
              <ChatMessage key={m.id} role="assistant">
                <p className="text-muted">Thinking…</p>
              </ChatMessage>
            );
          if (m.role === "error")
            return (
              <ChatMessage key={m.id} role="assistant">
                {m.error instanceof ApiError && m.error.code === "NETWORK" ? (
                  <ErrorState error={m.error} />
                ) : (
                  <ActionResult kind={kindFromError(m.error)} message={errorMessage(m.error)} className="max-w-md" />
                )}
              </ChatMessage>
            );
          const { res } = m;
          const confirmable = res.card && res.card.kind !== "risk";
          return (
            <ChatMessage key={m.id} role="assistant">
              {!confirmable && <p className="text-pretty">{res.reply}</p>}
              {res.card && <ActionConfirmation card={res.card} actionId={res.actionId} headline={res.reply} />}
            </ChatMessage>
          );
        })}
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-5 bg-linear-to-t from-cream from-70% to-transparent px-5 pt-4 pb-3 sm:-mx-8 sm:px-8 md:bottom-0 md:pb-6 lg:-mx-12 lg:px-12">
        {msgs.length > 0 && <div className="mb-3 hidden sm:block">{chips}</div>}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="flex items-center gap-2 rounded-control border border-line-strong bg-surface p-1.5 pl-4 shadow-md focus-within:border-ink"
        >
          <input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask Bloom anything…"
            aria-label="Message Bloom"
            className="h-10 min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={!input.trim() || busy}
            aria-label="Send message"
            className="grid size-10 shrink-0 place-items-center rounded-chip bg-ink text-surface transition-opacity disabled:opacity-30"
          >
            <ArrowUp className="size-5" />
          </button>
        </form>
        <p className="mt-2 text-center text-xs text-muted">Bloom confirms every action with you. Testnet demo · Not investment advice.</p>
      </div>
    </div>
  );
}

export default function ChatPage() {
  return (
    <Suspense>
      <Chat />
    </Suspense>
  );
}
