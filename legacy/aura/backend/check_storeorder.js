const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const orderbookAddr = '0x3346abe000118b25aca953f48deb1978a069e7de';
    const escrowAddr = '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8';
    const owner = '0x6ad5e89a5F99f997CAb7a163b4153e8cDE9e3B92';

    const abi = ["function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const orderbook = new ethers.Contract(orderbookAddr, abi, provider);
    
    try {
        const res = await orderbook.store_order.staticCall(
            owner,
            ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
            false,
            ethers.parseUnits("80", 18),
            50,
            ethers.parseUnits("60000", 18),
            { from: escrowAddr } // msg.sender == router
        );
        console.log("Returns:", res.toString());
    } catch (e) {
        console.error("REVERT:", e.message);
    }
}
main();
