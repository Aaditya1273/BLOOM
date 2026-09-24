const { ethers } = require('ethers');

async function main() {
    const provider = new ethers.JsonRpcProvider('https://sepolia-rollup.arbitrum.io/rpc');
    const escrowAddr = '0xfBE9FE4A805809489B7Fd39D64508A89dd1709E8';
    const owner = '0x6ad5e89a5F99f997CAb7a163b4153e8cDE9e3B92'; 

    const abi = ["function place_limit_order(uint256 asset_hash, bool is_long, uint256 collateral, uint256 leverage, uint256 limit_price) external returns (uint256)"];
    const iface = new ethers.Interface(abi);
    const data = iface.encodeFunctionData("place_limit_order", [
        ethers.keccak256(ethers.toUtf8Bytes("BTC-PERP")),
        false,
        ethers.parseUnits("80", 18),
        50,
        ethers.parseUnits("60000", 18)
    ]);
    
    // Most public nodes don't support debug_traceCall, but we can try!
    try {
        const trace = await provider.send('debug_traceCall', [{
            to: escrowAddr,
            from: owner,
            data: data
        }, "latest"]);
        console.log(JSON.stringify(trace, null, 2));
    } catch(e) {
        console.error("debug_traceCall failed:", e.message);
    }
}
main();
