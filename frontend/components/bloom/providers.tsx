"use client";

import "@rainbow-me/rainbowkit/styles.css";
import { useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { WagmiProvider } from "wagmi";
import { APP_CHAIN, bloomRainbowTheme, wagmiConfig } from "@/lib/wallet";
import { AuthProvider } from "@/hooks/use-auth";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={bloomRainbowTheme} initialChain={APP_CHAIN} appInfo={{ appName: "Bloom" }} modalSize="compact">
          <AuthProvider>{children}</AuthProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
