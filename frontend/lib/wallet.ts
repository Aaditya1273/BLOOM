import { defineChain } from "viem";
import { getDefaultConfig, lightTheme, type Theme } from "@rainbow-me/rainbowkit";

/** Robinhood Chain Testnet (Arbitrum Orbit). */
export const robinhoodTestnet = defineChain({
  id: 46630,
  name: "Robinhood Chain Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.testnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinhood Explorer", url: "https://explorer.testnet.chain.robinhood.com" } },
  testnet: true,
});

/**
 * The single chain this build talks to. NEXT_PUBLIC_CHAIN_ID is inlined at build time, so the local Hardhat branch
 * (dev only, NEXT_PUBLIC_CHAIN_ID=31337) is dropped from production testnet bundles: no localhost dependency ships.
 */
export const APP_CHAIN =
  process.env.NEXT_PUBLIC_CHAIN_ID === "31337"
    ? defineChain({
        id: 31337,
        name: "Local Hardhat",
        nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
        rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
        testnet: true,
      })
    : robinhoodTestnet;

export const WALLETCONNECT_PROJECT_ID = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

export const wagmiConfig = getDefaultConfig({
  appName: "Bloom",
  appDescription: "The wallet where dollars become assets and actions.",
  projectId: WALLETCONNECT_PROJECT_ID || "bloom-missing-walletconnect-project-id",
  chains: [APP_CHAIN],
  ssr: true,
});

/** RainbowKit themed to Bloom: ink accent, cream surfaces, soft radius. */
export const bloomRainbowTheme: Theme = (() => {
  const t = lightTheme({ accentColor: "#111111", accentColorForeground: "#FFFCF8", borderRadius: "large", overlayBlur: "small" });
  return {
    ...t,
    colors: {
      ...t.colors,
      modalBackground: "#FFFCF8",
      modalBorder: "rgba(17,17,17,0.08)",
      profileForeground: "#F7F3EC",
      connectButtonBackground: "#FFFCF8",
      connectButtonInnerBackground: "#FCE8ED",
      actionButtonSecondaryBackground: "#F7F3EC",
      generalBorder: "rgba(17,17,17,0.08)",
      modalBackdrop: "rgba(17,17,17,0.25)",
    },
    fonts: { body: "var(--font-inter), ui-sans-serif, system-ui, sans-serif" },
    shadows: { ...t.shadows, dialog: "0 16px 50px rgba(17,17,17,0.12)" },
  };
})();
