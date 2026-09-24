"use client";

import { useState, useEffect } from 'react';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Newspaper,
  BarChart3,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Zap,
} from 'lucide-react';
import { API_URL } from "../lib/config";

interface SentimentData {
  sentiment: string;
  score: number;
  one_liner: string;
}

interface MarketPrice {
  [key: string]: number;
}

interface NewsItem {
  title: string;
  description: string;
  source: string;
  publishedAt: string;
  url: string;
}

interface CorrelationPair {
  assetA: string;
  assetB: string;
  correlation: number;
  interpretation: string;
}

export default function MarketSentiment() {
  const [sentiment, setSentiment] = useState<SentimentData | null>(null);
  const [prices, setPrices] = useState<MarketPrice>({});
  const [news, setNews] = useState<NewsItem[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSection, setExpandedSection] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());

  const fetchData = async () => {
    setLoading(true);
    try {
      const [sentimentRes, contextRes] = await Promise.all([
        fetch(`${API_URL}/api/sentiment`).then(r => r.json()).catch(() => null),
        fetch(`${API_URL}/api/market-context`).then(r => r.json()).catch(() => null),
      ]);

      if (sentimentRes) setSentiment(sentimentRes);
      if (contextRes) {
        setPrices(contextRes.prices || {});
        setNews(contextRes.news || []);
        setCorrelations(contextRes.correlations || []);
      }
      setLastUpdate(new Date());
    } catch (err) {
      console.error('Market data fetch failed:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 120_000); // Refresh every 2 min
    return () => clearInterval(interval);
  }, []);

  const getSentimentColor = (s: string) => {
    if (s === 'BULLISH') return 'text-green';
    if (s === 'BEARISH') return 'text-coral';
    return 'text-yellow-400';
  };

  const getSentimentBg = (s: string) => {
    if (s === 'BULLISH') return 'bg-green/10 border-green/20';
    if (s === 'BEARISH') return 'bg-coral/10 border-coral/20';
    return 'bg-yellow-400/10 border-yellow-400/20';
  };

  const getSentimentIcon = (s: string) => {
    if (s === 'BULLISH') return <TrendingUp size={16} />;
    if (s === 'BEARISH') return <TrendingDown size={16} />;
    return <Minus size={16} />;
  };

  const getScoreGradient = (score: number) => {
    const normalizedScore = (score + 100) / 200; // 0 to 1
    const hue = normalizedScore * 120; // 0=red, 120=green
    return `hsl(${hue}, 70%, 50%)`;
  };

  const toggleSection = (section: string) => {
    setExpandedSection(prev => prev === section ? null : section);
  };

  const formatPrice = (p: number) => {
    if (p >= 1000) return `$${p.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
    if (p >= 1) return `$${p.toFixed(2)}`;
    return `$${p.toFixed(4)}`;
  };

  const getCorrelationColor = (corr: number) => {
    if (corr > 0.7) return 'text-green';
    if (corr > 0.3) return 'text-green/60';
    if (corr > -0.3) return 'text-white/40';
    if (corr > -0.7) return 'text-coral/60';
    return 'text-coral';
  };

  const getCorrelationBar = (corr: number) => {
    const absCorr = Math.abs(corr);
    const width = `${absCorr * 100}%`;
    const color = corr >= 0 ? 'bg-green' : 'bg-coral';
    return (
      <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
        <div className={`h-full ${color} rounded-full transition-all duration-500`} style={{ width }} />
      </div>
    );
  };

  return (
    <div className="border-t border-white/[0.06]">
      {/* ── Sentiment Header ────────────────────────── */}
      <button
        onClick={() => toggleSection('sentiment')}
        className="w-full px-6 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Zap size={14} className="text-yellow-400" />
          <span className="font-mono-label text-[0.65rem] text-white/40 uppercase">
            Market Pulse
          </span>
        </div>
        <div className="flex items-center gap-2">
          {sentiment && !loading && (
            <span className={`font-mono text-[0.6rem] font-bold ${getSentimentColor(sentiment.sentiment)}`}>
              {sentiment.sentiment}
            </span>
          )}
          {loading && <RefreshCw size={12} className="text-white/20 animate-spin" />}
          {expandedSection === 'sentiment' ? (
            <ChevronUp size={14} className="text-white/30" />
          ) : (
            <ChevronDown size={14} className="text-white/30" />
          )}
        </div>
      </button>

      {expandedSection === 'sentiment' && (
        <div className="px-6 pb-4 space-y-3 animate-in slide-in-from-top-2 duration-200">
          {/* Sentiment Score Card */}
          {sentiment && (
            <div className={`rounded-xl border p-3 ${getSentimentBg(sentiment.sentiment)}`}>
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  {getSentimentIcon(sentiment.sentiment)}
                  <span className={`font-display font-bold text-sm ${getSentimentColor(sentiment.sentiment)}`}>
                    {sentiment.sentiment}
                  </span>
                </div>
                <div
                  className="font-mono text-xs font-bold px-2 py-0.5 rounded-md"
                  style={{
                    color: getScoreGradient(sentiment.score),
                    backgroundColor: `${getScoreGradient(sentiment.score)}15`,
                  }}
                >
                  {sentiment.score > 0 ? '+' : ''}{sentiment.score}
                </div>
              </div>
              <p className="font-body text-[0.7rem] text-white/60 leading-relaxed">
                {sentiment.one_liner}
              </p>
            </div>
          )}

          {/* Gauge Bar */}
          {sentiment && (
            <div className="relative">
              <div className="flex justify-between mb-1">
                <span className="font-mono text-[0.55rem] text-coral/60">Bearish</span>
                <span className="font-mono text-[0.55rem] text-green/60">Bullish</span>
              </div>
              <div className="h-1.5 bg-white/5 rounded-full overflow-hidden relative">
                <div
                  className="absolute top-0 h-full rounded-full transition-all duration-700"
                  style={{
                    left: '50%',
                    width: `${Math.abs(sentiment.score) / 2}%`,
                    transform: sentiment.score < 0 ? 'translateX(-100%)' : 'none',
                    backgroundColor: getScoreGradient(sentiment.score),
                  }}
                />
                {/* Center marker */}
                <div className="absolute top-0 left-1/2 w-px h-full bg-white/20" />
              </div>
            </div>
          )}

          {/* Live Prices Mini-Grid */}
          <div className="grid grid-cols-2 gap-1.5">
            {Object.entries(prices)
              .filter(([k]) => !k.includes('_24h_change') && ['ETH', 'BTC', 'TSLA', 'AMZN'].includes(k))
              .map(([symbol, price]) => {
                const change = prices[`${symbol}_24h_change`];
                return (
                  <div key={symbol} className="bg-white/[0.03] rounded-lg p-2 flex items-center justify-between">
                    <span className="font-mono text-[0.6rem] text-white/60">{symbol}</span>
                    <div className="text-right">
                      <span className="font-mono text-[0.6rem] text-white/80 block">
                        {formatPrice(price as number)}
                      </span>
                      {change !== undefined && (
                        <span className={`font-mono text-[0.5rem] ${(change as number) >= 0 ? 'text-green' : 'text-coral'}`}>
                          {(change as number) >= 0 ? '+' : ''}{(change as number).toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>

          {/* Refresh Button */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-white/[0.03] hover:bg-white/[0.06] transition-colors text-white/30 hover:text-white/50 cursor-pointer"
          >
            <RefreshCw size={10} className={loading ? 'animate-spin' : ''} />
            <span className="font-mono text-[0.55rem]">
              Updated {lastUpdate.toLocaleTimeString()}
            </span>
          </button>
        </div>
      )}

      {/* ── News Section ─────────────────────────────── */}
      <button
        onClick={() => toggleSection('news')}
        className="w-full px-6 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors border-t border-white/[0.04] cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <Newspaper size={14} className="text-blue-400" />
          <span className="font-mono-label text-[0.65rem] text-white/40 uppercase">
            News Feed
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[0.6rem] text-white/20">{news.length}</span>
          {expandedSection === 'news' ? (
            <ChevronUp size={14} className="text-white/30" />
          ) : (
            <ChevronDown size={14} className="text-white/30" />
          )}
        </div>
      </button>

      {expandedSection === 'news' && (
        <div className="px-6 pb-4 space-y-2 animate-in slide-in-from-top-2 duration-200">
          {news.slice(0, 4).map((item, i) => (
            <a
              key={i}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block bg-white/[0.03] rounded-lg p-2.5 hover:bg-white/[0.06] transition-colors group"
            >
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <p className="font-body text-[0.65rem] text-white/70 leading-snug line-clamp-2 group-hover:text-white/90 transition-colors">
                    {item.title}
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="font-mono text-[0.5rem] text-blue-400/60">{item.source}</span>
                    <span className="font-mono text-[0.5rem] text-white/20">
                      {new Date(item.publishedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
                <ExternalLink size={10} className="text-white/10 group-hover:text-white/30 mt-0.5 flex-shrink-0" />
              </div>
            </a>
          ))}
        </div>
      )}

      {/* ── Correlations Section ──────────────────────── */}
      <button
        onClick={() => toggleSection('correlations')}
        className="w-full px-6 py-3 flex items-center justify-between hover:bg-white/[0.02] transition-colors border-t border-white/[0.04] cursor-pointer"
      >
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-purple-400" />
          <span className="font-mono-label text-[0.65rem] text-white/40 uppercase">
            Correlations
          </span>
        </div>
        {expandedSection === 'correlations' ? (
          <ChevronUp size={14} className="text-white/30" />
        ) : (
          <ChevronDown size={14} className="text-white/30" />
        )}
      </button>

      {expandedSection === 'correlations' && (
        <div className="px-6 pb-4 space-y-1.5 animate-in slide-in-from-top-2 duration-200">
          {correlations.slice(0, 6).map((pair, i) => (
            <div key={i} className="bg-white/[0.03] rounded-lg p-2.5">
              <div className="flex items-center justify-between mb-1.5">
                <span className="font-mono text-[0.6rem] text-white/50">
                  {pair.assetA}
                  <span className="text-white/20 mx-1">↔</span>
                  {pair.assetB}
                </span>
                <span className={`font-mono text-[0.6rem] font-bold ${getCorrelationColor(pair.correlation)}`}>
                  {pair.correlation > 0 ? '+' : ''}{pair.correlation.toFixed(2)}
                </span>
              </div>
              {getCorrelationBar(pair.correlation)}
              <span className="font-mono text-[0.5rem] text-white/20 mt-1 block">
                {pair.interpretation}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
