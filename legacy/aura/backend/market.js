/**
 * market.js - Market Data Acquisition Module
 * 
 * Fetches real-time prices from CoinGecko (with Pro API key) and 
 * financial news from NewsAPI.
 * Uses mainnet prices as reference for testnet tokens.
 */

const dotenv = require("dotenv");
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));
dotenv.config();

const PYTH_HERMES_URL = "https://hermes.pyth.network";
// BTC/USD price feed id
const BTC_PRICE_FEED_ID = "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";
// ETH/USD price feed id
const ETH_PRICE_FEED_ID = "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace"; 
const PRICE_FEED_IDS = {
    BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    AMZN: "62731dfcc8b8542e52753f208248c3e73fab2ec15422d6f65c2decda71ccea0d",
    NFLX: "8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
    AMD: "6969003ef4c5fbb3b57a6be3883102362d05572c2dc7f72b767ad48f4206204b",
    PLTR: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0"
};

/**
 * Fetches latest prices from Pyth Network Hermes API
 */
async function fetchPythPrices() {
    try {
        // Hermes V2 expects multiple 'ids[]' parameters for a sequence
        const ids = Object.values(PRICE_FEED_IDS).map(id => `ids[]=${id}`).join('&');
        const url = `${PYTH_HERMES_URL}/v2/updates/price/latest?${ids}`;
        const response = await fetch(url);
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Pyth Hermes HTTP ${response.status}: ${errorText}`);
        }

        const data = await response.json();
        const results = {};

        if (data.parsed) {
            for (const item of data.parsed) {
                const priceValue = parseFloat(item.price.price) * Math.pow(10, item.price.expo);
                const rawId = item.id.replace('0x', '');
                
                for (const [symbol, feedId] of Object.entries(PRICE_FEED_IDS)) {
                    if (rawId === feedId.replace('0x', '')) {
                        results[symbol] = priceValue;
                        break;
                    }
                }
            }
        }
        return results;
    } catch (err) {
        console.error(" Pyth price fetch failed:", err.message);
        return null;
    }
}

// ── CoinGecko Mapping ──────────────────────────────────────────────
// Maps our on-chain token symbols to CoinGecko IDs.
const COINGECKO_IDS = {
    ETH:  "ethereum",
    WETH: "ethereum",
    BTC:  "bitcoin",
    TSLA: null,  // No CoinGecko ID — uses stock data
    AMZN: null,
    NFLX: null,
    AMD:  null,
    PLTR: null,
};

// Fallback reference prices for stock-tokenized assets
const STOCK_FALLBACK_PRICES = {
    TSLA: 178.50,
    AMZN: 186.20,
    NFLX: 620.00,
    AMD:  162.00,
    PLTR: 23.50,
};

// In-memory caches
let priceCache = {};
let newsCacheData = null;
let coinDetailCache = {};
const PRICE_CACHE_TTL = 60_000;       // 60 seconds
const NEWS_CACHE_TTL  = 300_000;      // 5 minutes
const COIN_DETAIL_TTL = 120_000;      // 2 minutes
let lastPriceFetch = 0;
let lastNewsFetch  = 0;
let lastCoinDetailFetch = 0;

// ── API helpers ────────────────────────────────────────────────────

function getCoinGeckoHeaders() {
    const apiKey = process.env.COINGECKO_API;
    if (apiKey) {
        return {
            "accept": "application/json",
            "x-cg-demo-api-key": apiKey
        };
    }
    return { "accept": "application/json" };
}

function getCoinGeckoBaseUrl() {
    return "https://api.coingecko.com/api/v3";
}

// ── Price Functions ────────────────────────────────────────────────

/**
 * Fetches current USD prices for all supported assets.
 * Uses CoinGecko Pro API with the user's key.
 * @returns {Object} { ETH: 3150.42, BTC: 67000, TSLA: 178.50, ... }
 */
async function getAllPrices() {
    const now = Date.now();
    if (priceCache && Object.keys(priceCache).length > 0 && (now - lastPriceFetch) < PRICE_CACHE_TTL) {
        return priceCache;
    }

    const prices = { ...STOCK_FALLBACK_PRICES };

    // Try Pyth Network first for all supported feeds
    const pythPrices = await fetchPythPrices();
    if (pythPrices) {
        for (const [symbol, price] of Object.entries(pythPrices)) {
            prices[symbol] = price;
            if (symbol === 'ETH') prices.WETH = price;
        }
        console.log(" Pyth Network prices fetched:", Object.entries(pythPrices).map(([k,v]) => `${k}=$${v}`).join(', '));
    }

    try {
        const cryptoIds = Object.entries(COINGECKO_IDS)
            .filter(([k, id]) => id !== null) // Always fetch stats, even if Pyth provided price
            .map(([_, id]) => id);
        
        if (cryptoIds.length > 0) {
            const uniqueIds = [...new Set(cryptoIds)].join(",");
            const url = `${getCoinGeckoBaseUrl()}/simple/price?ids=${uniqueIds}&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`;
            
            const response = await fetch(url, { headers: getCoinGeckoHeaders() });
            if (!response.ok) throw new Error(`CoinGecko HTTP ${response.status}`);
            
            const data = await response.json();
            
            // Map CoinGecko response back to our symbols
            for (const [symbol, geckoId] of Object.entries(COINGECKO_IDS)) {
                if (geckoId && data[geckoId]) {
                    if (!prices[symbol]) {
                        prices[symbol] = data[geckoId].usd; // Pyth takes precedence for raw price
                    }
                    prices[`${symbol}_24h_change`] = data[geckoId].usd_24h_change || 0;
                    prices[`${symbol}_24h_vol`] = data[geckoId].usd_24h_vol || 0;
                    prices[`${symbol}_market_cap`] = data[geckoId].usd_market_cap || 0;
                }
            }
        }

        console.log(" Market prices updated:", 
            Object.entries(prices).filter(([k]) => !k.includes('_')).map(([k,v]) => `${k}=$${v}`).join(', '));
    } catch (err) {
        console.warn(" Price fetch partially failed, using fallback/pyth prices:", err.message);
        prices.ETH  = prices.ETH  || 3100;
        prices.WETH = prices.WETH || 3100;
        prices.BTC  = prices.BTC  || 67000;
    }

    priceCache = prices;
    lastPriceFetch = now;
    return prices;
}

/**
 * Get the price of a single asset.
 */
async function getAssetPrice(symbol) {
    const prices = await getAllPrices();
    return prices[symbol.toUpperCase()] || 0;
}

/**
 * Fetches detailed coin data from CoinGecko for the Market page.
 * Returns comprehensive info: price, market cap, volume, ATH, supply, description, etc.
 */
async function getCoinDetails() {
    const now = Date.now();
    if (coinDetailCache && Object.keys(coinDetailCache).length > 0 && (now - lastCoinDetailFetch) < COIN_DETAIL_TTL) {
        return coinDetailCache;
    }

    const cryptoCoins = [
        { symbol: "ETH", geckoId: "ethereum" },
        { symbol: "BTC", geckoId: "bitcoin" },
    ];

    const details = {};

    // Fetch detailed data for each crypto coin
    for (const coin of cryptoCoins) {
        try {
            const url = `${getCoinGeckoBaseUrl()}/coins/${coin.geckoId}?localization=false&tickers=false&community_data=false&developer_data=false&sparkline=true`;
            const response = await fetch(url, { headers: getCoinGeckoHeaders() });
            if (!response.ok) throw new Error(`CoinGecko detail HTTP ${response.status}`);
            
            const data = await response.json();
            
            details[coin.symbol] = {
                symbol: coin.symbol,
                name: data.name,
                image: data.image?.large || data.image?.small || "",
                currentPrice: data.market_data?.current_price?.usd || 0,
                marketCap: data.market_data?.market_cap?.usd || 0,
                marketCapRank: data.market_cap_rank || 0,
                totalVolume: data.market_data?.total_volume?.usd || 0,
                high24h: data.market_data?.high_24h?.usd || 0,
                low24h: data.market_data?.low_24h?.usd || 0,
                priceChange24h: data.market_data?.price_change_24h || 0,
                priceChangePercentage24h: data.market_data?.price_change_percentage_24h || 0,
                priceChangePercentage7d: data.market_data?.price_change_percentage_7d || 0,
                priceChangePercentage30d: data.market_data?.price_change_percentage_30d || 0,
                circulatingSupply: data.market_data?.circulating_supply || 0,
                totalSupply: data.market_data?.total_supply || 0,
                maxSupply: data.market_data?.max_supply || null,
                ath: data.market_data?.ath?.usd || 0,
                athDate: data.market_data?.ath_date?.usd || "",
                athChangePercentage: data.market_data?.ath_change_percentage?.usd || 0,
                atl: data.market_data?.atl?.usd || 0,
                atlDate: data.market_data?.atl_date?.usd || "",
                description: data.description?.en ? data.description.en.split('.').slice(0, 3).join('.') + '.' : "",
                sparkline7d: data.market_data?.sparkline_7d?.price || [],
                categories: data.categories?.slice(0, 3) || [],
                links: {
                    homepage: data.links?.homepage?.[0] || "",
                    blockchain: data.links?.blockchain_site?.[0] || "",
                },
                lastUpdated: data.last_updated || new Date().toISOString(),
            };
        } catch (err) {
            console.warn(` Coin detail fetch failed for ${coin.symbol}:`, err.message);
        }
    }

    // Add stock token info (synthetic since they're not on CoinGecko)
    const stockTokens = [
        { symbol: "TSLA", name: "Tesla (Tokenized)", description: "Tokenized representation of Tesla Inc. stock on Robinhood Chain. Enables 24/7 trading with DeFi composability." },
        { symbol: "AMZN", name: "Amazon (Tokenized)", description: "Tokenized representation of Amazon.com Inc. stock on Robinhood Chain. Access equities through DeFi protocols." },
        { symbol: "NFLX", name: "Netflix (Tokenized)", description: "Tokenized representation of Netflix Inc. stock on Robinhood Chain. Bridge traditional equities to DeFi." },
        { symbol: "AMD", name: "AMD (Tokenized)", description: "Tokenized representation of Advanced Micro Devices stock on Robinhood Chain." },
        { symbol: "PLTR", name: "Palantir (Tokenized)", description: "Tokenized representation of Palantir Technologies stock on Robinhood Chain." },
    ];

    for (const stock of stockTokens) {
        const price = STOCK_FALLBACK_PRICES[stock.symbol] || 100;
        details[stock.symbol] = {
            symbol: stock.symbol,
            name: stock.name,
            image: "",
            currentPrice: price,
            marketCap: 0,
            marketCapRank: null,
            totalVolume: 0,
            high24h: price * 1.02,
            low24h: price * 0.98,
            priceChange24h: price * 0.012,
            priceChangePercentage24h: 1.2,
            priceChangePercentage7d: 3.5,
            priceChangePercentage30d: -2.1,
            circulatingSupply: 0,
            totalSupply: 0,
            maxSupply: null,
            ath: price * 1.5,
            athDate: "2025-12-01T00:00:00Z",
            athChangePercentage: -33,
            atl: price * 0.3,
            atlDate: "2024-01-15T00:00:00Z",
            description: stock.description,
            sparkline7d: generateSparkline(price, 168),
            categories: ["Tokenized Stock", "RWA"],
            links: { homepage: "", blockchain: "" },
            lastUpdated: new Date().toISOString(),
            isTokenizedStock: true,
        };
    }

    console.log(` Fetched details for ${Object.keys(details).length} coins`);
    coinDetailCache = details;
    lastCoinDetailFetch = now;
    return details;
}

/**
 * Generate a simple sparkline array for stock tokens
 */
function generateSparkline(basePrice, points) {
    const sparkline = [];
    let price = basePrice * 0.97;
    for (let i = 0; i < points; i++) {
        price += (Math.random() - 0.48) * basePrice * 0.005;
        price = Math.max(price, basePrice * 0.9);
        sparkline.push(parseFloat(price.toFixed(2)));
    }
    return sparkline;
}

/**
 * Fetches historical prices for correlation analysis.
 * Uses CoinGecko's market_chart endpoint for crypto assets.
 */
async function getPriceHistory(symbol, days = 30) {
    const upper = symbol.toUpperCase();
    const geckoId = COINGECKO_IDS[upper];
    
    if (!geckoId) {
        return generateSyntheticHistory(upper, days);
    }

    try {
        const url = `${getCoinGeckoBaseUrl()}/coins/${geckoId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
        const response = await fetch(url, { headers: getCoinGeckoHeaders() });
        if (!response.ok) throw new Error(`CoinGecko history HTTP ${response.status}`);
        
        const data = await response.json();
        return data.prices.map(([timestamp, price]) => ({ timestamp, price }));
    } catch (err) {
        console.warn(` Price history fetch failed for ${symbol}:`, err.message);
        return generateSyntheticHistory(upper, days);
    }
}

/**
 * Generate synthetic price history for stock tokens using random walk.
 */
function generateSyntheticHistory(symbol, days) {
    const basePrice = STOCK_FALLBACK_PRICES[symbol] || 100;
    const history = [];
    const now = Date.now();
    let price = basePrice * 0.95;

    for (let i = days; i >= 0; i--) {
        const change = (Math.random() - 0.48) * basePrice * 0.02;
        price = Math.max(price + change, basePrice * 0.7);
        history.push({
            timestamp: now - i * 86400_000,
            price: parseFloat(price.toFixed(2))
        });
    }

    return history;
}

// ── News Functions ─────────────────────────────────────────────────

/**
 * Fetches latest financial/crypto news from NewsAPI.
 * Uses NEWSAPI env variable (matching the user's .env key name).
 */
async function getLatestNews() {
    const now = Date.now();
    if (newsCacheData && (now - lastNewsFetch) < NEWS_CACHE_TTL) {
        return newsCacheData;
    }

    // Support both key names: NEWSAPI and NEWSAPI_KEY
    const apiKey = process.env.NEWSAPI || process.env.NEWSAPI_KEY;
    
    if (!apiKey) {
        console.warn(" NEWSAPI key not set, using mock news data");
        const mockNews = getMockNews();
        newsCacheData = mockNews;
        lastNewsFetch = now;
        return mockNews;
    }

    try {
        // Requête très stricte pour n'avoir que de la macroéconomie, des annonces de la FED, des ETF, ou du pur crypto trading
        const query = encodeURIComponent("(Bitcoin OR Ethereum OR \"stock market\" OR macroeconomics OR Arbitrum OR DeFi) AND (SEC OR ETF OR inflation OR \"interest rates\" OR Fed OR CPI OR bullish OR bearish OR rally OR crash)");
        const url = `https://newsapi.org/v2/everything?q=${query}&language=en&sortBy=publishedAt&pageSize=30&apiKey=${apiKey}`;
        
        const response = await fetch(url);
        if (!response.ok) throw new Error(`NewsAPI HTTP ${response.status}`);
        
        const data = await response.json();

        // Filtre agressif anti-bruit (on supprime tout ce qui concerne le lifestyle, les produits, le sport, etc)
        const NOISE_PATTERNS = /coupon|deal[s ]|promo|discount|off at amazon|free shipping|slickdeal|dealnews|streaming|tv show|series|movie|episode|season \d|rotten tomatoes|celebrity|murder|homicide|headphone|hoodie|jacket|underwear|owl|garden|piracy|sport|gaming|console|player|review|recipe|diet/i;
        
        // On exige des mots clés purs finance/trading
        const RELEVANCE_PATTERNS = /crypto|bitcoin|ethereum|defi|blockchain|arbitrum|token|stock|market|investor|trading|finance|economy|fed |inflation|earnings|IPO|SEC|ETF|yield|treasury|bull|bear|rally|hedge|portfolio|wall street|nasdaq|dow jones|liquidat|long|short/i;

        const articles = (data.articles || [])
            .filter(a => a.title && a.title !== "[Removed]")
            .filter(a => !NOISE_PATTERNS.test(a.title + " " + (a.description || "") + " " + (a.source?.name || "")))
            .filter(a => RELEVANCE_PATTERNS.test(a.title + " " + (a.description || "")))
            .slice(0, 15)
            .map(a => ({
                title: a.title,
                description: a.description || "",
                source: a.source?.name || "Unknown",
                publishedAt: a.publishedAt,
                url: a.url,
                urlToImage: a.urlToImage || null,
            }));

        console.log(` Fetched ${articles.length} REAL news articles from NewsAPI`);
        newsCacheData = articles;
        lastNewsFetch = now;
        return articles;
    } catch (err) {
        console.warn(" NewsAPI fetch failed, using mock news:", err.message);
        const mockNews = getMockNews();
        newsCacheData = mockNews;
        lastNewsFetch = now;
        return mockNews;
    }
}

/**
 * Mock news for demo / when API is unavailable.
 */
function getMockNews() {
    return [
        {
            title: "Federal Reserve Signals Potential Rate Cut in Q3 2026",
            description: "The Federal Reserve has indicated a possible shift in monetary policy, with markets now pricing in a 70% chance of a rate cut.",
            source: "Reuters",
            publishedAt: new Date().toISOString(),
            url: "#",
            urlToImage: null,
        },
        {
            title: "Bitcoin ETF Inflows Hit $1.2B Weekly Record",
            description: "Institutional demand for Bitcoin continues to surge with spot ETF products seeing record inflows.",
            source: "Bloomberg",
            publishedAt: new Date(Date.now() - 3600_000).toISOString(),
            url: "#",
            urlToImage: null,
        },
        {
            title: "Ethereum Layer 2 Activity Surges 300% as Arbitrum Leads",
            description: "Layer 2 scaling solutions are seeing unprecedented growth with Arbitrum processing more transactions than Ethereum mainnet.",
            source: "CoinDesk",
            publishedAt: new Date(Date.now() - 7200_000).toISOString(),
            url: "#",
            urlToImage: null,
        },
        {
            title: "Tech Earnings Beat Expectations, NASDAQ Rallies",
            description: "Major tech companies including Amazon and Tesla reported better-than-expected earnings.",
            source: "CNBC",
            publishedAt: new Date(Date.now() - 14400_000).toISOString(),
            url: "#",
            urlToImage: null,
        },
        {
            title: "Global Trade Tensions Rise as Tariffs Expand",
            description: "New tariff announcements create uncertainty in global markets. Safe-haven assets see increased demand.",
            source: "Financial Times",
            publishedAt: new Date(Date.now() - 21600_000).toISOString(),
            url: "#",
            urlToImage: null,
        }
    ];
}

// ── Correlation Functions ──────────────────────────────────────────

function pearsonCorrelation(seriesA, seriesB) {
    const n = Math.min(seriesA.length, seriesB.length);
    if (n < 3) return 0;

    const a = seriesA.slice(0, n);
    const b = seriesB.slice(0, n);

    const meanA = a.reduce((s, v) => s + v, 0) / n;
    const meanB = b.reduce((s, v) => s + v, 0) / n;

    let num = 0, denA = 0, denB = 0;
    for (let i = 0; i < n; i++) {
        const dA = a[i] - meanA;
        const dB = b[i] - meanB;
        num  += dA * dB;
        denA += dA * dA;
        denB += dB * dB;
    }

    const den = Math.sqrt(denA * denB);
    return den === 0 ? 0 : parseFloat((num / den).toFixed(4));
}

let correlationCache = null;
let lastCorrelationFetch = 0;
const CORRELATION_TTL = 3600_000; // 1 hour

async function getCorrelationMatrix() {
    const now = Date.now();
    if (correlationCache && (now - lastCorrelationFetch) < CORRELATION_TTL) {
        return correlationCache;
    }

    const symbols = ["ETH", "BTC", "TSLA", "AMZN", "NFLX"];
    const histories = {};

    for (const sym of symbols) {
        const hist = await getPriceHistory(sym, 30);
        histories[sym] = hist.map(h => h.price);
    }

    const pairs = [];
    for (let i = 0; i < symbols.length; i++) {
        for (let j = i + 1; j < symbols.length; j++) {
            const corr = pearsonCorrelation(histories[symbols[i]], histories[symbols[j]]);
            let interpretation = "Uncorrelated";
            if (corr > 0.7) interpretation = "Strongly Correlated";
            else if (corr > 0.4) interpretation = "Moderately Correlated";
            else if (corr > 0.1) interpretation = "Weakly Correlated";
            else if (corr > -0.1) interpretation = "Uncorrelated";
            else if (corr > -0.4) interpretation = "Weakly Inverse";
            else if (corr > -0.7) interpretation = "Moderately Inverse";
            else interpretation = "Strongly Inverse";

            pairs.push({
                assetA: symbols[i],
                assetB: symbols[j],
                correlation: corr,
                interpretation
            });
        }
    }

    const result = { pairs };
    correlationCache = result;
    lastCorrelationFetch = now;
    
    return result;
}

// ── Full Market Context ────────────────────────────────────────────

async function getMarketContext() {
    const [prices, news, correlations] = await Promise.all([
        getAllPrices(),
        getLatestNews(),
        getCorrelationMatrix()
    ]);

    return {
        timestamp: new Date().toISOString(),
        prices,
        news: news.slice(0, 5),
        correlations: correlations.pairs,
    };
}


module.exports = {
    getAllPrices,
    getAssetPrice,
    getPriceHistory,
    getLatestNews,
    getCorrelationMatrix,
    getMarketContext,
    getCoinDetails,
    pearsonCorrelation,
};
