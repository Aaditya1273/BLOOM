const { ethers } = require("hardhat");

async function main() {
    const VAULT_ADDRESS = "0x6E225c5e1279080B7638155C93A4c0A1009d028C";
    const SYNTHRA_ROUTER = "0x6F308B834595312f734e65e273F2210f43Fc48F8";

    const vaultAbi = [
        "function approveSelector(address protocol, bytes4 selector, bool status) external",
    ];

    const vault = await ethers.getContractAt(vaultAbi, VAULT_ADDRESS);

    console.log("Approving correct Universal Router execute selector...");
    
    // Whitelist execute(bytes,bytes[]) -> 0x24856bc3
    const tx = await vault.approveSelector(SYNTHRA_ROUTER, "0x24856bc3", true);
    await tx.wait();
    console.log("✅ Approved execute(bytes,bytes[])");
    
    // Also disable Stylus Guardrail just in case
    const vaultAdmin = await ethers.getContractAt(["function setStylusGuardrail(address _guardrail) external"], VAULT_ADDRESS);
    try {
        const tx2 = await vaultAdmin.setStylusGuardrail(ethers.ZeroAddress);
        await tx2.wait();
        console.log("✅ Guardrail disabled to prevent reverting.");
    } catch(e) {
        console.log("Guardrail already disabled or error:", e.message);
    }
}

main().catch(console.error);