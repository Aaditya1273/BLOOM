const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const owner = '0x6ad5e89a5F99f997CAb7a163b4153e8cDE9e3B92'; 
    const ausd = new ethers.Contract('0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A', ["function allowance(address, address) view returns (uint256)"], provider);
    
    const allowOld = await ausd.allowance(owner, '0xe133eab3114bcd18c169e97c81af1d2654e5a3ff');
    console.log("ALLOWANCE for 0xe133 (old):", allowOld.toString());
    const allowNew = await ausd.allowance(owner, '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8');
    console.log("ALLOWANCE for 0xfBE9 (new):", allowNew.toString());
    
    // Check if the user has any balance of aUSD!
    const balanceAbi = ["function balanceOf(address) view returns (uint256)"];
    const ausdBal = new ethers.Contract('0x27cd6eD9482FF6Ae388F629E8E6D57d8dc975c5A', balanceAbi, provider);
    console.log("BALANCE of user:", (await ausdBal.balanceOf(owner)).toString());
}
main();
