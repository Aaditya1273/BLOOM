const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const escrowAddr = '0xe133eab3114bcd18c169e97c81af1d2654e5a3ff';

    const abi = ["function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData("place_limit_order", [
        ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
        false,
        ethers.parseEther("10"),
        50,
        ethers.parseEther("60000")
    ]);
    
    const tx = {
        to: escrowAddr,
        data: data,
        from: '0x3333333333333333333333333333333333333333'
    };

    try {
        const res = await provider.call(tx);
        console.log("RES:", res);
    } catch(e) {
        console.error("REVERT:", e.message);
        if (e.info) console.error("INFO:", e.info);
    }
}
main();
