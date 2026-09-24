const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const escrowAddr = '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8';
    const owner = '0x6ad5e89a5F99f997CAb7a163b4153e8cDE9e3B92'; // The one who sent the failed tx

    const abi = ["function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const escrow = new ethers.Contract(escrowAddr, abi, provider);
    
    // Using owner to simulate from the user's wallet who approved aUSD
    try {
        const res = await escrow.place_limit_order.staticCall(
            ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
            false,
            ethers.parseUnits("80", 18),
            50, // leverage
            ethers.parseUnits("60000", 18),
            { from: owner }
        );
        console.log("SUCCESS:", res);
    } catch(e) {
        console.error("REVERT:", e.message);
        if (e.info) console.error("INFO:", e.info);
    }
}
main();
