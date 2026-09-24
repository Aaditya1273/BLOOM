import type { Metadata } from "next";
import "./globals.css";
import { ThirdwebProviderWrapper } from "./ThirdwebProvider";

export const metadata: Metadata = {
  title: "Aura | AI Wealth Layer",
  description: "Autonomous AI Wealth Manager on Robinhood Chain",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#0a0c10] font-sans">
        <ThirdwebProviderWrapper>{children}</ThirdwebProviderWrapper>
      </body>
    </html>
  );
}
