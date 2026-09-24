"use client";

import { useState, useEffect, useRef, useCallback } from 'react';
import { API_URL } from "../lib/config";

export interface ProactiveAlert {
  id: string;
  message: string;
  actions: string[];
  asset?: string;
  severity: 'info' | 'warning' | 'opportunity';
}

interface SentimentState {
  sentiment: string;
  score: number;
  one_liner?: string;
}

export function useProactiveAlerts(isConnected: boolean) {
  const [pendingAlert, setPendingAlert] = useState<ProactiveAlert | null>(null);
  const lastSentimentRef = useRef<string | null>(null);
  const lastPricesRef = useRef<Record<string, number>>({});
  const alertCooldownRef = useRef<number>(0);

  const dismissAlert = useCallback(() => {
    setPendingAlert(null);
    // 2 min cooldown between alerts
    alertCooldownRef.current = Date.now() + 120_000;
  }, []);

  useEffect(() => {
    if (!isConnected) return;

    const checkAlerts = async () => {
      // Respect cooldown
      if (Date.now() < alertCooldownRef.current) return;
      if (pendingAlert) return; // Don't stack alerts

      try {
        // Fetch sentiment
        const sentRes = await fetch(`${API_URL}/api/sentiment`);
        if (sentRes.ok) {
          const sentiment: SentimentState = await sentRes.json();
          const prev = lastSentimentRef.current;
          lastSentimentRef.current = sentiment.sentiment;

          // Detect sentiment shift
          if (prev && prev !== sentiment.sentiment) {
            if (sentiment.sentiment === 'BEARISH' && prev !== 'BEARISH') {
              setPendingAlert({
                id: `alert-${Date.now()}`,
                message: `⚠️ Market sentiment shifted to BEARISH (Score: ${sentiment.score}). ${sentiment.one_liner || ''} Consider tightening your stop-losses or pausing active DCA strategies.`,
                actions: ['Adjust Stop-Loss to 5%', 'Pause All Strategies', 'Dismiss'],
                severity: 'warning',
              });
              return;
            }
            if (sentiment.sentiment === 'BULLISH' && prev !== 'BULLISH') {
              setPendingAlert({
                id: `alert-${Date.now()}`,
                message: `🟢 Market sentiment turned BULLISH (Score: ${sentiment.score}). ${sentiment.one_liner || ''} Conditions are favorable for accumulation strategies.`,
                actions: ['Launch DCA on ETH', 'Accumulate TSLA', 'Dismiss'],
                severity: 'opportunity',
              });
              return;
            }
          }
        }

        // Fetch prices for volatility check
        const priceRes = await fetch(`${API_URL}/api/prices`);
        if (priceRes.ok) {
          const prices: Record<string, number> = await priceRes.json();
          const watchList = ['ETH', 'BTC', 'TSLA', 'AMZN'];

          for (const asset of watchList) {
            const changeKey = `${asset}_24h_change`;
            const change = prices[changeKey];
            const prevPrice = lastPricesRef.current[asset];
            const currentPrice = prices[asset];

            if (change !== undefined && Math.abs(change) > 5) {
              const direction = change > 0 ? 'surged' : 'dropped';
              setPendingAlert({
                id: `alert-${Date.now()}-${asset}`,
                message: `⚡ ${asset} has ${direction} ${Math.abs(change).toFixed(1)}% in the last 24h ($${currentPrice?.toLocaleString()}). Your Risk Agent recommends reviewing exposure.`,
                actions: [`Rebalance ${asset}`, 'Set Stop-Loss', 'Dismiss'],
                asset,
                severity: change > 0 ? 'opportunity' : 'warning',
              });
              break; // One alert at a time
            }
          }

          // Update last known prices
          watchList.forEach((a) => {
            if (prices[a]) lastPricesRef.current[a] = prices[a];
          });
        }
      } catch {
        // Silently fail - proactive alerts are non-critical
      }
    };

    // Initial check after 15s (let the page load first)
    const initialTimer = setTimeout(checkAlerts, 15000);
    // Then check every 60s
    const interval = setInterval(checkAlerts, 60000);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
    };
  }, [isConnected, pendingAlert]);

  return { pendingAlert, dismissAlert };
}
