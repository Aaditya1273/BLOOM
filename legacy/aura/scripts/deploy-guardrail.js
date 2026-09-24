const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting Deployment of Advanced Guardrail on Robinhood Chain...");

  const signers = await ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No signers found. Check your PRIVATE_KEY in .env");
  }
  const deployer = signers[0];
  console.log("Deployer address:", deployer.address);

  // Note: For the hackathon, we can deploy the Stylus module address as a placeholder 
  // or use a pre-deployed WASM hash if available. 
  // For now, we deploy the AdvancedGuardrail with a dummy Stylus address.
  const dummyStylusAddress = "0x0000000000000000000000000000000000000000"; 

  const AdvancedGuardrail = await ethers.getContractFactory("AdvancedGuardrail");
  console.log("Deploying AdvancedGuardrail...");
  
  const guardrail = await AdvancedGuardrail.deploy(deployer.address, dummyStylusAddress);
  await guardrail.waitForDeployment();

  const guardrailAddress = await guardrail.getAddress();
  console.log("✅ AdvancedGuardrail deployed to:", guardrailAddress);

  // Configuration initiale
  console.log("Whitelisting common destinations (MockDapp)...");
  // On récupère une adresse de Dapp de test si possible, sinon on en met une par défaut
  const mockDappAddress = "0x6F308B834595312f734e65e273F2210f43Fc48F8"; // Exemple d'adresse de test
  await guardrail.toggleDestination(mockDappAddress, true);
  console.log(`✅ Destination ${mockDappAddress} whitelisted.`);

  console.log("-----------------------------------------");
  console.log("Next steps:");
  console.log(`1. Update your AuraAccount to use the new guardrail: account.setGuardrail("${guardrailAddress}")`);
  console.log("2. Deploy the Stylus WASM module and update the address via guardrail.setStylusModule(newAddress)");
  console.log("-----------------------------------------");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
