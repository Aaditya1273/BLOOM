const { ethers } = require("ethers");
require("dotenv").config({ path: "./backend/.env" });
const { computeHealth } = require("./healthFactor");

const RPC_URL = "https://rpc.testnet.chain.robinhood.com";
const PRIVATE_KEY = process.env.PRIVATE_KEY; 
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 15000;
const wallet = new ethers.Wallet(PRIVATE_KEY, provider);

const PERPS_ADDRESS = "0xc12A0864095b2F4Dc0D1aF0169B760c53D59Cb42";
const PERPS_ABI = [
    "function positions(uint256) view returns (address owner, string asset, bool isLong, uint256 collateralAmount, uint256 leverage, uint256 entryPrice, uint256 positionSize, bool isOpen, uint256 openedAt, uint256 realizedPnl, bool isProfitRealized, uint256 exitPrice, uint256 takeProfitPrice, uint256 stopLossPrice)",
    "function liquidatePosition(uint256 positionId) external",
    "function nextPositionId() view returns (uint256)"
];
const perps = new ethers.Contract(PERPS_ADDRESS, PERPS_ABI, wallet);

const ORACLE_ADDRESS = "0x097AeB196366317cf97986A04f32Df312c96ABa1";
const ORACLE_ABI = ["function setPrice(string asset, uint256 price) external"];
const oracle = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, wallet);

const PYTH_IDS = {
    BTC: "e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "ff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    TSLA: "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    AMZN: "62731dfcc8b8542e52753f208248c3e73fab2ec15422d6f65c2decda71ccea0d",
    NFLX: "8376cfd7ca8bcdf372ced05307b24dced1f15b1afafdeff715664598f15a3dd2",
    AMD: "6969003ef4c5fbb3b57a6be3883102362d05572c2dc7f72b767ad48f4206204b",
    PLTR: "11a70634863ddffb71f2b11f2cff29f73f3db8f6d0b78c49f2b5f4ad36e885f0"
};

async function fetchPythPrices() {
    const ids = Object.values(PYTH_IDS);
    const url = `https://hermes.pyth.network/v2/updates/price/latest?` + ids.map(id => `ids[]=${id}`).join("&");
    const res = await fetch(url);
    const data = await res.json();
    const prices = {};
    for (const entry of data.parsed || []) {
        const px = Number(entry.price.price) * Math.pow(10, entry.price.expo);
        for (const [sym, pythId] of Object.entries(PYTH_IDS)) {
            if (entry.id.toLowerCase() === pythId.toLowerCase()) {
                prices[sym] = ethers.parseUnits(px.toFixed(2), 18);
            }
        }
    }
    return prices;
}

async function main() {
    console.log("Fetching pyth prices...");
    const prices = await fetchPythPrices();
    
    // update all oracles
    for (const [sym, px] of Object.entries(prices)) {
        console.log(`Setting oracle for ${sym}`);
        await (await oracle.setPrice(sym, px)).wait();
    }
    
    const nextId = await perps.nextPositionId();
    const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
    
    for (let i = 1; i < Number(nextId); i++) {
        const pos = await perps.positions(i);
        if (!pos.isOpen) continue;
        
        const px = prices[pos.asset.replace("-PERP", "")];
        if (!px) continue;
        
        const { healthBps } = computeHealth({
            isLong: pos.isLong,
            collateralAmount: pos.collateralAmount,
            entryPrice: pos.entryPrice,
            positionSize: pos.positionSize,
            openedAt: pos.openedAt
        }, px, nowSeconds);
        
        if (healthBps === 0) {
            console.log(`Position ${i} (${pos.asset}) is bankrupt. Liquidating...`);
            try {
                const tx = await perps.liquidatePosition(i);
                await tx.wait();
                console.log(`✅ Liquidated ${i}`);
            } catch (e) {
                console.log(`❌ Failed ${i}: ${e.shortMessage || e.message}`);
            }
        }
    }
}
main().catch(console.error);
