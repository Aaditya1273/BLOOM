const { ethers } = require('ethers');
require('dotenv').config();

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const orderbookAddr = '0x3346abe000118b25aca953f48deb1978a069e7de';
    
    const abi = ["function set_router(address router) external"];
    const contract = new ethers.Contract(orderbookAddr, abi, wallet);
    
    console.log("Setting router...");
    const tx = await contract.set_router('0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8');
    console.log("Tx hash:", tx.hash);
    await tx.wait();
    console.log("Router updated!");
}
main();
