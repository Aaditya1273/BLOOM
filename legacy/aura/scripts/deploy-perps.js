const { ethers } = require("hardhat");

async function main() {
  console.log("Démarrage du déploiement on-chain (Robinhood Chain Testnet)...");

    const accounts = await ethers.getSigners();
    let deployer;

    if (accounts.length > 0) {
      deployer = accounts[0];
    } else {
      throw new Error("No accounts found in hardhat config. Please provide a private key.");
    }
  console.log("Compte de déploiement :", deployer.address);
  console.log("Balance initiale :", (await ethers.provider.getBalance(deployer.address)).toString());

  // 1. Déployer aUSD (Collatéral de test)
  const AUSD = await ethers.getContractFactory("aUSD");
  const aUSD = await AUSD.deploy();
  await aUSD.waitForDeployment();
  const aUSDAddress = await aUSD.getAddress();
  console.log("✅ aUSD déployé à l'adresse:", aUSDAddress);

  // Mint initial pour nous-même
  const mintTx = await aUSD.faucet();
  await mintTx.wait();
  console.log("✅ Faucet: 1000 aUSD mintés sur", deployer.address);

  // 2. Déployer le MockOracle (Temporaire pour la démo, avant l'intégration du SDK Pyth Hermes)
  const MockOracle = await ethers.getContractFactory("MockOracle");
  const oracle = await MockOracle.deploy();
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();
  console.log("✅ MockOracle déployé à l'adresse:", oracleAddress);

  // 3. Déployer AuraVault (ERC-4626)
  const AuraVault = await ethers.getContractFactory("AuraVault");
  const vault = await AuraVault.deploy(aUSDAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();
  console.log("✅ AuraVault déployé à l'adresse:", vaultAddress);

  // 4. Déployer AuraPerps
  const AuraPerps = await ethers.getContractFactory("AuraPerps");
  const perps = await AuraPerps.deploy(aUSDAddress, oracleAddress, vaultAddress);
  await perps.waitForDeployment();
  const perpsAddress = await perps.getAddress();
  console.log("✅ AuraPerps déployé à l'adresse:", perpsAddress);

  // 5. Configuration des Rôles
  console.log("Configuration des permissions et des rôles...");
  
  // aUSD: Accorder le droit de Mint & Burn au contrat AuraPerps
  // Dans notre implémentation aUSD (Hackathon), mint et burn ne sont pas protégés par AccessControl pour aller vite,
  // mais dans une vraie implémentation, on ferait grantRole(MINTER_ROLE, perpsAddress)
  
  // AuraVault: Lier le contrat AuraPerps
  const txVault = await vault.setAuraPerps(perpsAddress);
  await txVault.wait();
  console.log("✅ AuraVault lié à AuraPerps");

  // Fournir de la liquidité initiale au Vault (pour payer les gains des traders)
  console.log("Dépôt de liquidité initiale dans l'AuraVault...");
  const approveTx = await aUSD.approve(vaultAddress, ethers.parseUnits("500", 18));
  await approveTx.wait();
  const depositTx = await vault.deposit(ethers.parseUnits("500", 18), deployer.address);
  await depositTx.wait();
  console.log("✅ 500 aUSD déposés dans le Vault par le LP");

  console.log("\\n--- Résumé ---");
  console.log("aUSD Address:", aUSDAddress);
  console.log("MockOracle Address:", oracleAddress);
  console.log("AuraVault Address:", vaultAddress);
  console.log("AuraPerps Address:", perpsAddress);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Erreur lors du déploiement:", error);
    process.exit(1);
  });
