"use client";

import { useState, useEffect, useRef } from 'react';
import {
  TrendingUp, TrendingDown, Minus, BarChart3, Globe, Clock,
  ArrowUpRight, ArrowDownRight, Newspaper, RefreshCw, ExternalLink,
  Activity, DollarSign, Layers, Zap, Shield,
} from 'lucide-react';
import { API_URL } from "../lib/config";

interface CoinDetail {
  symbol: string;
  name: string;
  image: string;
  currentPrice: number;
  marketCap: number;
  marketCapRank: number | null;
  totalVolume: number;
  high24h: number;
  low24h: number;
  priceChange24h: number;
  priceChangePercentage24h: number;
  priceChangePercentage7d: number;
  priceChangePercentage30d: number;
  circulatingSupply: number;
  totalSupply: number;
  maxSupply: number | null;
  ath: number;
  athDate: string;
  athChangePercentage: number;
  atl: number;
  atlDate: string;
  description: string;
  sparkline7d: number[];
  categories: string[];
  isTokenizedStock?: boolean;
  lastUpdated: string;
}

interface CorrelationPair {
  assetA: string;
  assetB: string;
  correlation: number;
  interpretation: string;
}

interface NewsItem {
  title: string;
  description: string;
  source: string;
  publishedAt: string;
  url: string;
  urlToImage: string | null;
}

// Mini SVG sparkline component
function Sparkline({ data, width = 120, height = 32, color }: { data: number[]; width?: number; height?: number; color: string }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const step = width / (data.length - 1);

  const points = data.map((v, i) => `${i * step},${height - ((v - min) / range) * height}`).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" points={points} />
    </svg>
  );
}

export default function MarketArea() {
  const [coins, setCoins] = useState<Record<string, CoinDetail>>({});
  const [correlations, setCorrelations] = useState<CorrelationPair[]>([]);
  const [news, setNews] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'correlations' | 'news'>('overview');

  const fetchAll = async () => {
    setLoading(true);
    try {
      const [coinsRes, corrRes, newsRes] = await Promise.all([
        fetch(`${API_URL}/api/coins`).then(r => r.json()).catch(() => ({})),
        fetch(`${API_URL}/api/correlations`).then(r => r.json()).catch(() => ({ pairs: [] })),
        fetch(`${API_URL}/api/news`).then(r => r.json()).catch(() => []),
      ]);
      setCoins(coinsRes);
      setCorrelations(corrRes.pairs || []);
      setNews(newsRes);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 120_000); return () => clearInterval(iv); }, []);

  const fmt = (n: number, compact = false) => {
    if (compact) {
      if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
      if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
    }
    if (n >= 1000) return `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
    return `$${n.toFixed(2)}`;
  };

  const pctClass = (v: number) => v >= 0 ? 'text-green' : 'text-coral';
  const pctIcon = (v: number) => v >= 0
    ? <ArrowUpRight size={12} className="text-green" />
    : <ArrowDownRight size={12} className="text-coral" />;

  const coinOrder = ['ETH', 'BTC', 'TSLA', 'AMZN', 'NFLX', 'AMD', 'PLTR'];
  const orderedCoins = coinOrder.filter(s => coins[s]).map(s => coins[s]);
  const detail = selectedCoin ? coins[selectedCoin] : null;

  const corrColor = (c: number) => {
    if (c > 0.7) return 'bg-green';
    if (c > 0.3) return 'bg-green/50';
    if (c > -0.3) return 'bg-white/20';
    if (c > -0.7) return 'bg-coral/50';
    return 'bg-coral';
  };

  return (
    <div className="flex-1 overflow-y-auto p-4 lg:p-8 pt-20 lg:pt-24">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-navy rounded-2xl shadow-lg">
              <BarChart3 className="text-green w-6 h-6" />
            </div>
            <div>
              <h2 className="font-display font-bold text-2xl text-white">Market Overview</h2>
              <p className="font-body text-sm text-white/70">Live prices from CoinGecko & real-time news</p>
            </div>
          </div>
          <button onClick={fetchAll} disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-navy/5 hover:bg-navy/10 rounded-xl transition-colors cursor-pointer">
            <RefreshCw size={14} className={loading ? 'animate-spin text-green' : 'text-navy/50'} />
            <span className="font-mono text-xs text-navy/60">Refresh</span>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-surface rounded-xl p-1">
          {(['overview', 'correlations', 'news'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 px-4 rounded-lg font-display font-semibold text-sm transition-all cursor-pointer ${
                activeTab === tab ? 'bg-white text-navy shadow-sm' : 'text-text-muted hover:text-navy'
              }`}>
              {tab === 'overview' ? 'Assets' : tab === 'correlations' ? 'Correlations' : 'News Feed'}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW TAB ──────────────────────── */}
        {activeTab === 'overview' && (
          <div className="space-y-4">
            {/* Asset Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {orderedCoins.map(coin => (
                <button key={coin.symbol}
                  onClick={() => setSelectedCoin(selectedCoin === coin.symbol ? null : coin.symbol)}
                  className={`bg-white rounded-[20px] border p-5 text-left transition-all hover:shadow-lg cursor-pointer ${
                    selectedCoin === coin.symbol ? 'border-green shadow-md ring-1 ring-green/20' : 'border-border hover:border-green/30'
                  }`}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      {coin.image ? (
                        <img src={coin.image} alt={coin.symbol} className="w-8 h-8 rounded-full" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-navy/10 flex items-center justify-center">
                          <span className="font-mono text-xs font-bold text-navy">{coin.symbol.slice(0, 2)}</span>
                        </div>
                      )}
                      <div>
                        <span className="font-display font-bold text-navy block text-sm">{coin.symbol}</span>
                        <span className="font-body text-[0.65rem] text-text-muted">{coin.name}</span>
                      </div>
                    </div>
                    {coin.isTokenizedStock && (
                      <span className="font-mono text-[0.55rem] text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-100">RWA</span>
                    )}
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <p className="font-display font-bold text-xl text-navy">{fmt(coin.currentPrice)}</p>
                      <div className="flex items-center gap-1 mt-1">
                        {pctIcon(coin.priceChangePercentage24h)}
                        <span className={`font-mono text-xs font-semibold ${pctClass(coin.priceChangePercentage24h)}`}>
                          {coin.priceChangePercentage24h >= 0 ? '+' : ''}{coin.priceChangePercentage24h.toFixed(2)}%
                        </span>
                        <span className="font-mono text-[0.6rem] text-text-muted">24h</span>
                      </div>
                    </div>
                    <Sparkline
                      data={coin.sparkline7d.length > 20 ? coin.sparkline7d.slice(-48) : coin.sparkline7d}
                      color={coin.priceChangePercentage24h >= 0 ? '#22c55e' : '#f87171'}
                      width={80} height={28}
                    />
                  </div>

                  {coin.marketCap > 0 && (
                    <div className="flex gap-3 mt-3 pt-3 border-t border-border">
                      <div>
                        <span className="font-mono text-[0.55rem] text-text-muted block">MCap</span>
                        <span className="font-mono text-[0.65rem] text-navy font-semibold">{fmt(coin.marketCap, true)}</span>
                      </div>
                      <div>
                        <span className="font-mono text-[0.55rem] text-text-muted block">Vol 24h</span>
                        <span className="font-mono text-[0.65rem] text-navy font-semibold">{fmt(coin.totalVolume, true)}</span>
                      </div>
                      {coin.marketCapRank && (
                        <div>
                          <span className="font-mono text-[0.55rem] text-text-muted block">Rank</span>
                          <span className="font-mono text-[0.65rem] text-navy font-semibold">#{coin.marketCapRank}</span>
                        </div>
                      )}
                    </div>
                  )}
                </button>
              ))}
            </div>

            {/* Detail Panel */}
            {detail && (
              <div className="bg-white rounded-[24px] border border-border p-6 shadow-sm animate-in slide-in-from-top-3 duration-300">
                <div className="flex items-center gap-3 mb-6">
                  {detail.image ? (
                    <img src={detail.image} alt={detail.symbol} className="w-12 h-12 rounded-full" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-navy/10 flex items-center justify-center">
                      <span className="font-display font-bold text-navy">{detail.symbol}</span>
                    </div>
                  )}
                  <div>
                    <h3 className="font-display font-bold text-xl text-navy">{detail.name}</h3>
                    <div className="flex items-center gap-2 mt-0.5">
                      {detail.categories.map(c => (
                        <span key={c} className="font-mono text-[0.55rem] bg-navy/5 text-navy/50 px-2 py-0.5 rounded-full">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {detail.description && (
                  <p className="font-body text-sm text-text-secondary mb-6 leading-relaxed">{detail.description}</p>
                )}

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
                  {[
                    { label: 'Price', value: fmt(detail.currentPrice), icon: DollarSign },
                    { label: '24h High', value: fmt(detail.high24h), icon: TrendingUp },
                    { label: '24h Low', value: fmt(detail.low24h), icon: TrendingDown },
                    { label: '24h Volume', value: fmt(detail.totalVolume, true), icon: Activity },
                  ].map(item => (
                    <div key={item.label} className="bg-surface rounded-xl p-4">
                      <div className="flex items-center gap-1.5 mb-1">
                        <item.icon size={12} className="text-text-muted" />
                        <span className="font-mono text-[0.6rem] text-text-muted">{item.label}</span>
                      </div>
                      <span className="font-display font-bold text-navy">{item.value}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-4 mb-6">
                  {[
                    { label: '7d Change', value: detail.priceChangePercentage7d },
                    { label: '30d Change', value: detail.priceChangePercentage30d },
                    { label: 'From ATH', value: detail.athChangePercentage },
                  ].map(item => (
                    <div key={item.label} className="bg-surface rounded-xl p-4 text-center">
                      <span className="font-mono text-[0.6rem] text-text-muted block mb-1">{item.label}</span>
                      <span className={`font-display font-bold text-lg ${pctClass(item.value)}`}>
                        {item.value >= 0 ? '+' : ''}{item.value.toFixed(1)}%
                      </span>
                    </div>
                  ))}
                </div>

                {detail.ath > 0 && (
                  <div className="flex gap-4">
                    <div className="flex-1 bg-green/5 border border-green/10 rounded-xl p-4">
                      <span className="font-mono text-[0.6rem] text-green/60 block">All-Time High</span>
                      <span className="font-display font-bold text-green">{fmt(detail.ath)}</span>
                      <span className="font-mono text-[0.5rem] text-text-muted block mt-1">
                        {new Date(detail.athDate).toLocaleDateString()}
                      </span>
                    </div>
                    <div className="flex-1 bg-coral/5 border border-coral/10 rounded-xl p-4">
                      <span className="font-mono text-[0.6rem] text-coral/60 block">All-Time Low</span>
                      <span className="font-display font-bold text-coral">{fmt(detail.atl)}</span>
                      <span className="font-mono text-[0.5rem] text-text-muted block mt-1">
                        {new Date(detail.atlDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                )}

                {(detail.circulatingSupply > 0 || detail.maxSupply) && (
                  <div className="mt-4 bg-surface rounded-xl p-4">
                    <span className="font-mono text-[0.6rem] text-text-muted block mb-2">Supply</span>
                    <div className="flex justify-between text-sm">
                      <span className="text-text-secondary">Circulating: <strong className="text-navy">{detail.circulatingSupply.toLocaleString()}</strong></span>
                      {detail.maxSupply && (
                        <span className="text-text-secondary">Max: <strong className="text-navy">{detail.maxSupply.toLocaleString()}</strong></span>
                      )}
                    </div>
                    {detail.maxSupply && (
                      <div className="h-2 bg-navy/5 rounded-full mt-2 overflow-hidden">
                        <div className="h-full bg-green rounded-full" style={{ width: `${(detail.circulatingSupply / detail.maxSupply) * 100}%` }} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── CORRELATIONS TAB ─────────────────── */}
        {activeTab === 'correlations' && (
          <div className="space-y-4">
            <div className="bg-white rounded-[24px] border border-border p-6 shadow-sm">
              <h3 className="font-display font-bold text-lg text-navy mb-1">Asset Correlation Matrix</h3>
              <p className="font-body text-sm text-text-secondary mb-6">30-day Pearson correlation between assets (CoinGecko + synthetic stock data)</p>

              {/* Correlation Heatmap Table */}
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr>
                      <th className="p-2"></th>
                      {['ETH', 'BTC', 'TSLA', 'AMZN', 'NFLX'].map(s => (
                        <th key={s} className="p-2 font-mono text-xs text-navy/60 text-center">{s}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {['ETH', 'BTC', 'TSLA', 'AMZN', 'NFLX'].map(row => (
                      <tr key={row}>
                        <td className="p-2 font-mono text-xs text-navy/60 font-semibold">{row}</td>
                        {['ETH', 'BTC', 'TSLA', 'AMZN', 'NFLX'].map(col => {
                          if (row === col) {
                            return <td key={col} className="p-1.5"><div className="w-full h-10 rounded-lg bg-navy/10 flex items-center justify-center font-mono text-xs text-navy/40">1.00</div></td>;
                          }
                          const pair = correlations.find(c =>
                            (c.assetA === row && c.assetB === col) || (c.assetA === col && c.assetB === row)
                          );
                          const corr = pair?.correlation || 0;
                          const opacity = Math.min(Math.abs(corr), 1);
                          const bg = corr >= 0
                            ? `rgba(34,197,94,${opacity * 0.4})`
                            : `rgba(248,113,113,${opacity * 0.4})`;
                          return (
                            <td key={col} className="p-1.5">
                              <div className="w-full h-10 rounded-lg flex items-center justify-center font-mono text-xs font-semibold"
                                style={{ backgroundColor: bg, color: corr >= 0 ? '#16a34a' : '#dc2626' }}>
                                {corr >= 0 ? '+' : ''}{corr.toFixed(2)}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Pair Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {correlations.map((pair, i) => (
                <div key={i} className="bg-white rounded-xl border border-border p-4 flex items-center gap-4">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="font-display font-semibold text-sm text-navy">{pair.assetA}</span>
                      <span className="text-text-muted text-xs">↔</span>
                      <span className="font-display font-semibold text-sm text-navy">{pair.assetB}</span>
                    </div>
                    <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${corrColor(pair.correlation)}`}
                        style={{ width: `${Math.abs(pair.correlation) * 100}%` }} />
                    </div>
                    <span className="font-mono text-[0.6rem] text-text-muted mt-1 block">{pair.interpretation}</span>
                  </div>
                  <span className={`font-mono text-lg font-bold ${pair.correlation >= 0 ? 'text-green' : 'text-coral'}`}>
                    {pair.correlation >= 0 ? '+' : ''}{pair.correlation.toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── NEWS TAB ─────────────────────────── */}
        {activeTab === 'news' && (
          <div className="space-y-3">
            {news.length === 0 && !loading && (
              <div className="bg-white rounded-[24px] border border-border p-12 text-center">
                <Newspaper className="text-text-muted w-12 h-12 mx-auto mb-3" />
                <p className="font-display font-bold text-navy">No news available</p>
                <p className="font-body text-sm text-text-secondary mt-1">Add a NewsAPI key to get live headlines.</p>
              </div>
            )}
            {news.map((item, i) => (
              <a key={i} href={item.url} target="_blank" rel="noopener noreferrer"
                className="block bg-white rounded-[20px] border border-border p-5 hover:shadow-md hover:border-green/30 transition-all group">
                <div className="flex gap-4">
                  {item.urlToImage && (
                    <img src={item.urlToImage} alt="" className="w-20 h-20 rounded-xl object-cover flex-shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <h4 className="font-display font-bold text-navy text-sm leading-snug group-hover:text-green transition-colors line-clamp-2">
                      {item.title}
                    </h4>
                    {item.description && (
                      <p className="font-body text-xs text-text-secondary mt-1.5 line-clamp-2 leading-relaxed">{item.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-2">
                      <span className="font-mono text-[0.6rem] text-green font-semibold">{item.source}</span>
                      <span className="font-mono text-[0.55rem] text-text-muted">
                        {new Date(item.publishedAt).toLocaleString()}
                      </span>
                      <ExternalLink size={10} className="text-text-muted group-hover:text-green transition-colors" />
                    </div>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
