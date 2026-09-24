import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { BloomShell } from "@/components/bloom/shell";

// Self-hosted Inter (latin, variable weight) so builds work offline.
const inter = localFont({ src: "./fonts/InterVariable-latin.woff2", weight: "100 900", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Bloom", template: "%s · Bloom" },
  description: "Save in USDG. Send Robinhood Stock Tokens. Let your agent act under your rules.",
};

export const viewport: Viewport = {
  themeColor: "#F7F3EC",
  colorScheme: "light",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="flex min-h-dvh flex-col">
        <BloomShell>{children}</BloomShell>
      </body>
    </html>
  );
}
