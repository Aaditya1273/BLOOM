const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const owner = '0x6ad5e89a5F99f997CAb7a163b4153e8cDE9e3B92'; 
    const ausdAddr = '0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A';
    const erc20Abi = ["function transferFrom(address, address, uint256) returns (bool)"];
    const ausd = new ethers.Contract(ausdAddr, erc20Abi, provider);
    
    // simulate transferFrom
    try {
        const res = await ausd.transferFrom.staticCall(owner, '0x0000000000000000000000000000000000000001', ethers.parseUnits("1", 18), { from: '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8' });
        console.log("Returns:", res);
    } catch (e) {
        console.error("REVERT:", e.message);
    }
}
main();
