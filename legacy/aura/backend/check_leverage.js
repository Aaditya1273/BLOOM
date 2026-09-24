const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);
    const orderbookAddr = '0x3346abe000118b25aca953f48deb1978a069e7de';
    
    // ABI for store_order
    const abi = ["function store_order(address owner, uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const contract = new ethers.Contract(orderbookAddr, abi, wallet);
    
    // We impersonate the escrow to bypass msg_sender() != router.get() ?
    // No, we can just staticCall and see if it returns U256::MAX.
    // We can't staticCall from another address if it checks msg_sender, but let's see.
    // It will return U256::MAX if caller is not router.
    
    // Instead of calling, let's just confirm if the frontend indeed passes 1e18 leverage!
}
main();
