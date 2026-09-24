const fs = require('fs');
const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const privateKey = process.env.PRIVATE_KEY;
    const wallet = new ethers.Wallet(privateKey, provider);

    const address = '0x4F73C990276B32b3085aA95C12c3823E446E49C6';
    const abi = [
        "function init(address _ausd, address _orderbook, address _keeper) external"
    ];
    const escrow = new ethers.Contract(address, abi, wallet);

    console.log("Initializing Escrow...");
    let tx = await escrow.init(
        '0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A', 
        '0x3346abe000118b25aca953f48deb1978a069e7de', 
        wallet.address
    );
    await tx.wait();
    console.log("Initialized!");

    console.log("Updating OrderBook router...");
    const orderbookAbi = ["function set_router(address router) external"];
    const obContract = new ethers.Contract('0x3346abe000118b25aca953f48deb1978a069e7de', orderbookAbi, wallet);
    tx = await obContract.set_router(address);
    await tx.wait();
    console.log("OrderBook Router updated to:", address);

    const envPath = '.env';
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/^ESCROW_ADDRESS=.*$/m, "ESCROW_ADDRESS=" + address);
    fs.writeFileSync(envPath, envContent);
    console.log("Updated backend/.env");
    fs.writeFileSync('NEW_ESCROW_ADDRESS.txt', address);
}
main().catch(console.error);
