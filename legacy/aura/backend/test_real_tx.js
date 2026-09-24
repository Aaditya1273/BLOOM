const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);
    const escrowAddr = '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8';
    
    // 1. Approve
    const ausdAddr = '0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A';
    const erc20Abi = ["function approve(address, uint256) returns (bool)"];
    const ausd = new ethers.Contract(ausdAddr, erc20Abi, wallet);
    
    let nonce = await provider.getTransactionCount(wallet.address);
    console.log("Nonce:", nonce);

    let tx = await ausd.approve(escrowAddr, ethers.parseUnits("10", 18), { nonce: nonce++ });
    await tx.wait();
    console.log("Approved");

    // 2. Place limit order
    const abi = ["function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const escrow = new ethers.Contract(escrowAddr, abi, wallet);
    
    try {
        tx = await escrow.place_limit_order(
            ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
            false,
            ethers.parseUnits("10", 18),
            50,
            ethers.parseUnits("60000", 18),
            { nonce: nonce++, gasLimit: 2000000 }
        );
        console.log("TX HASH:", tx.hash);
        await tx.wait();
        console.log("SUCCESS!");
    } catch(e) {
        console.error("REVERT:", e.message);
    }
}
main();
