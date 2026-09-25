import type { Metadata } from "next";
import { Landing } from "@/components/bloom/landing";

export const metadata: Metadata = {
  title: { absolute: "Bloom — the wallet where dollars become assets and actions" },
  description: "Save in USDG. Send Robinhood Stock Tokens. Let your agent act under your rules.",
};

export default function LandingPage() {
  return <Landing />;
}
