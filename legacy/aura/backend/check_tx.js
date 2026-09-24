const { ethers } = require("ethers");
async function main() {
    const provider = new ethers.JsonRpcProvider("https://sepolia-rollup.arbitrum.io/rpc");
    const address = "0xb4DD0565207Ca66432C0BaD06b69Bb97514E033d";
    const history = await provider.send("eth_getTransactionCount", [address, "latest"]);
    console.log("Tx count:", parseInt(history, 16));
}
main();
