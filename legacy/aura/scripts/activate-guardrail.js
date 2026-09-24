const { ethers } = require("hardhat");
require("dotenv").config();

async function main() {
  const accountAddress = process.env.AURA_ACCOUNT_ADDRESS;
  const guardrailAddress = "0xF000811e1799dD222068f14762FFc212dEf15f3A";

  console.log(`🔗 Activating Guardrail ${guardrailAddress} on Account ${accountAddress}...`);

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signers found. Check your PRIVATE_KEY in .env");
  }
  const deployer = signers[0];
  console.log("Using signer:", deployer.address);

  // Note: On utilise l'ABI d'AuraAccount pour appeler setGuardrail
  const AuraAccount = await ethers.getContractFactory("AuraAccount");
  const account = AuraAccount.attach(accountAddress);

  console.log("Sending setGuardrail transaction...");
  const tx = await account.setGuardrail(guardrailAddress);
  await tx.wait();

  console.log("✅ Success! Guardrail is now ACTIVE on AuraAccount.");
  console.log("The AI Agent is now protected by AdvancedGuardrail (Solidity + Stylus-ready).");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
