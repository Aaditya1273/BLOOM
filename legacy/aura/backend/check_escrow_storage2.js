const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const escrowAddr = '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8';
    
    for (let i=0; i<4; i++) {
        const slot = await provider.getStorage(escrowAddr, i);
        console.log("Slot", i, ":", slot);
    }
}
main();
