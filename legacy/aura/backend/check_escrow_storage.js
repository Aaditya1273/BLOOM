const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const escrowAddr = '0xe133eab3114bcd18c169e97c81af1d2654e5a3ff';
    
    for (let i=0; i<4; i++) {
        const slot = await provider.getStorage(escrowAddr, i);
        console.log("Slot", i, ":", slot);
    }
}
main();
