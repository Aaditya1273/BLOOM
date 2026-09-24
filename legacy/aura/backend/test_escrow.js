const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);

    const aUSD = new ethers.Contract('0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A', [
        "function approve(address spender, uint256 amount) external returns (bool)",
        "function allowance(address owner, address spender) external view returns (uint256)"
    ], wallet);

    const escrowAddress = '0x4F73C990276B32b3085aA95C12c3823E446E49C6';
    
    console.log("Approving Escrow...");
    let tx = await aUSD.approve(escrowAddress, ethers.MaxUint256);
    await tx.wait();
    console.log("Approved!");

    const escrowAbi = [
        "function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"
    ];
    const escrow = new ethers.Contract(escrowAddress, escrowAbi, wallet);

    console.log("Placing limit order...");
    tx = await escrow.place_limit_order(
        ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
        false,
        ethers.parseUnits("80", 18),
        50,
        ethers.parseUnits("60000", 18)
    );
    const receipt = await tx.wait();
    console.log("Limit order placed! Hash:", receipt.hash);
}
main().catch(console.error);
