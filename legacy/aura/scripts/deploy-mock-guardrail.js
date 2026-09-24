const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const Vault = await ethers.getContractAt([
        "function setStylusGuardrail(address _guardrail) external"
    ], "0x6E225c5e1279080B7638155C93A4c0A1009d028C");

    const MockGuardrail = await ethers.getContractFactory("MockVaultGuardrail");
    console.log("Deploying MockVaultGuardrail...");
    const mock = await MockGuardrail.deploy();
    await mock.waitForDeployment();
    const addr = await mock.getAddress();
    console.log("✅ MockVaultGuardrail deployed at:", addr);

    console.log("Setting guardrail on Vault...");
    const tx = await Vault.setStylusGuardrail(addr);
    await tx.wait();
    console.log("✅ Guardrail successfully set on Vault.");
}

main().catch(console.error);