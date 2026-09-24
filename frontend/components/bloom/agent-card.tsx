import { ArrowRight } from "lucide-react";
import type { Goal } from "@/lib/types";
import { BloomCard } from "./card";
import { BloomMark } from "./logo";
import { BloomButton } from "./button";
import { StatusPill } from "./status-pill";

/** Home teaser for the Bloom Agent: what it's doing right now, in one line. */
export function AgentCard({ goal, delay }: { goal?: Goal; delay?: number }) {
  return (
    <BloomCard tone="brand" delay={delay} className="relative overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-sm font-medium">
          <BloomMark size={20} /> Bloom Agent
        </p>
        {goal && <StatusPill tone="neutral" className="bg-surface">Active</StatusPill>}
      </div>
      <p className="mt-5 text-2xl font-semibold tracking-[-0.025em] text-balance">
        {goal ? `Saving for your ${goal.name.toLowerCase()}` : "Put a goal on autopilot"}
      </p>
      <p className="mt-1.5 text-sm text-ink/70">
        {goal ? "Working inside the limits you set. You can turn it off any time." : "Describe a goal. Bloom sets limits the agent can never exceed."}
      </p>
      <BloomButton href="/agent" variant="primary" size="sm" className="mt-5">
        {goal ? "View goal" : "Create a goal"} <ArrowRight />
      </BloomButton>
    </BloomCard>
  );
}
