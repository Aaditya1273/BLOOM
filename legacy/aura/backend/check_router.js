const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const orderbookAddr = '0x3346d0a79058b879667C087961dEE2F3fA89bbE1'.toLowerCase();
    
    const abi = ["function get_router() view returns (address)", "function get_keeper() view returns (address)"];
    const contract = new ethers.Contract(orderbookAddr, abi, provider);
    
    console.log("ROUTER:", await contract.get_router());
    console.log("KEEPER:", await contract.get_keeper());
}
main();
