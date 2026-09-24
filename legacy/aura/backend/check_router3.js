const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const orderbookAddr = '0x3346abe000118b25aca953f48deb1978a069e7de';
    const abi = ["function get_router() view returns (address)"];
    const contract = new ethers.Contract(orderbookAddr, abi, provider);
    console.log("ROUTER:", await contract.get_router());
}
main();
