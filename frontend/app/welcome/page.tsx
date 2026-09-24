import type { Metadata } from "next";
import { Landing } from "./landing";

export const metadata: Metadata = {
  title: "Bloom — the wallet where dollars become assets and actions",
  description: "Save in USDG. Send Robinhood Stock Tokens. Let your agent act under your rules.",
};

export default function WelcomePage() {
  return <Landing />;
}
