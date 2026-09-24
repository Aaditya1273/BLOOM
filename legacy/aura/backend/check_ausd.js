const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const code = await provider.getCode('0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A');
    console.log("Code length:", code.length);
}
main();
