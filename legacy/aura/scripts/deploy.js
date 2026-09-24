const hre = require("hardhat");

async function main() {
  const signers = await hre.ethers.getSigners();
  if (signers.length === 0) {
    throw new Error("No deployer account found. Please set PRIVATE_KEY in your .env file.");
  }
  const deployer = signers[0];
  console.log("Deploying contracts with the account:", deployer.address);

  // 1. Mock EntryPoint (for testing/demo)
  // In production Robinhood Chain/Arbitrum, you'd use the existing EntryPoint
  const MockEntryPoint = await hre.ethers.getContractFactory("MockDapp"); // Using MockDapp as a dummy
  const entryPoint = await MockEntryPoint.deploy();
  console.log("Mock EntryPoint deployed to:", entryPoint.target);

  // 2. Deploy AdvancedGuardrail (Optimized logic)
  const AdvancedGuardrail = await hre.ethers.getContractFactory("AdvancedGuardrail");
  const guardrail = await AdvancedGuardrail.deploy(deployer.address);
  console.log("AdvancedGuardrail deployed to:", guardrail.target);

  // 3. Deploy AuraAccount implementation
  const AuraAccount = await hre.ethers.getContractFactory("AuraAccount");
  const implementation = await AuraAccount.deploy(entryPoint.target);
  console.log("AuraAccount implementation deployed to:", implementation.target);

  // 4. Deploy Proxy for user
  const ERC1967Proxy = await hre.ethers.getContractFactory("ERC1967Proxy");
  const initData = implementation.interface.encodeFunctionData("initialize", [deployer.address]);
  const proxy = await ERC1967Proxy.deploy(implementation.target, initData);
  const userAccount = AuraAccount.attach(proxy.target);
  console.log("User AuraAccount (Proxy) deployed to:", userAccount.target);

  // 5. Setup: Set AI Agent (using deployer for demo)
  await userAccount.setAiAgent(deployer.address);
  await userAccount.setGuardrail(guardrail.target);
  console.log("Setup complete: AI Agent set to deployer and Guardrail linked.");

  // 6. Whitelist GMX Mock
  const GMXMock = await hre.ethers.getContractFactory("GMXMock");
  const gmx = await GMXMock.deploy();
  await guardrail.toggleProtocol(gmx.target, true);
  console.log("Whitelisted GMX Mock at:", gmx.target);

  console.log("\n--- Deployment Summary ---");
  console.log(`RPC_URL=https://sepolia-rollup.arbitrum.io/rpc`);
  console.log(`AURA_ACCOUNT_ADDRESS=${userAccount.target}`);
  console.log(`AURA_GUARDRAIL_ADDRESS=${guardrail.target}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
