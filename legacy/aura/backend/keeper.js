require('dotenv').config();
const ethers = require('ethers');

const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 15000;
const privateKey = process.env.PRIVATE_KEY;
const wallet = new ethers.Wallet(privateKey, provider);

const COPY_TRADING_ADDRESS = '0x73F7033D6105884E743678278EF33ba70a0DB9c2';

const COPY_TRADING_ABI = [
    "function executeCopyOpen(address leader, uint256 leaderPositionId, string asset, bool isLong, uint256 leaderCollateral, uint256 leaderTotalBalance, uint256 leverage, uint256 leaderEntryPrice) external"
];

const contract = new ethers.Contract(COPY_TRADING_ADDRESS, COPY_TRADING_ABI, wallet);

async function run() {
    try {
        const leader = '0xb4DD0565207Ca66432C0BaD06b69Bb97514E033d';
        const leaderPositionId = 83n;
        const asset = 'BTC';
        const isLong = true;
        const leaderCollateral = 640269089999999934530n; // 640 aUSD
        const leaderTotalBalance = 10000000000000000000000n; // 10000 aUSD
        const leverage = 50n;
        const leaderEntryPrice = 65959320871055147798182n;

        console.log("Executing copy open...");
        const tx = await contract.executeCopyOpen(leader, leaderPositionId, asset, isLong, leaderCollateral, leaderTotalBalance, leverage, leaderEntryPrice);
        console.log("Tx hash:", tx.hash);
        const receipt = await tx.wait();
        console.log("Status:", receipt.status);
    } catch (err) {
        console.error(err);
    }
}
run();
