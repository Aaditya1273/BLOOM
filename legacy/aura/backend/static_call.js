const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);
    const orderbookAddr = '0x3346abe000118b25aca953f48deb1978a069e7de';
    const escrowAddr = '0xe133eab3114bcd18c169e97c81af1d2654e5a3ff';

    // check if collateral is > 0
    // check if leverage > 50
    // check if limit_price > 0
    
    // Instead of guessing, let's call place_limit_order statically!
    const abi = ["function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const escrow = new ethers.Contract(escrowAddr, abi, wallet);
    
    try {
        const res = await escrow.place_limit_order.staticCall(
            ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
            false,
            ethers.parseEther("10"),
            50,
            ethers.parseEther("60000")
        );
        console.log("SUCCESS:", res);
    } catch(e) {
        console.error("REVERT:", e.message);
        if (e.data) console.error("DATA:", e.data);
    }
}
main();
