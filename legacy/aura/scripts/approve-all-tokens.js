const { ethers } = require("hardhat");

async function main() {
    const VAULT_ADDRESS = "0x6E225c5e1279080B7638155C93A4c0A1009d028C";
    const TOKENS = {
        WETH: "0x7943e237c7F95DA44E0301572D358911207852Fa",
        TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
        AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
        BTC:  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
    };

    const vaultAbi = [
        "function approveSelector(address protocol, bytes4 selector, bool status) external",
        "function whitelistProtocol(address protocol, bool status) external"
    ];

    const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS);

    console.log("Approving tokens on Vault...");
    for (const [symbol, address] of Object.entries(TOKENS)) {
        await (await vault.whitelistProtocol(address, true)).wait();
        await (await vault.approveSelector(address, "0xa9059cbb", true)).wait(); // transfer
        await (await vault.approveSelector(address, "0x095ea7b3", true)).wait(); // approve
        console.log(`✅ Approved ${symbol}`);
    }
}

main().catch(console.error);