require("dotenv").config();
const { ethers } = require("ethers");

const rpcUrl = process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com";
const privateKey = process.env.PRIVATE_KEY; // Owner of the contracts
const perpsAddress = process.env.AURA_PERPS_ADDRESS;
const keeperPrivateKey = process.env.KEEPER_PRIVATE_KEY;

async function main() {
    const provider = new ethers.JsonRpcProvider(process.env.RPC_URL || process.env.ROBINHOOD_ALCHEMY_RPC || "https://rpc.testnet.chain.robinhood.com"); provider.pollingInterval = 15000;
    const wallet = new ethers.Wallet(privateKey, provider);
    const keeperWallet = new ethers.Wallet(keeperPrivateKey);
    
    console.log("=== Configuration de AuraPerps sur Robinhood ===");
    console.log("AuraPerps:", perpsAddress);
    console.log("Nouveau Router (Keeper):", keeperWallet.address);

    const perpsAbi = ["function setRouter(address _router) external"];
    const perps = new ethers.Contract(perpsAddress, perpsAbi, wallet);

    try {
        const tx = await perps.setRouter(keeperWallet.address);
        console.log("Transaction envoyée:", tx.hash);
        await tx.wait();
        console.log("✅ Le Keeper est maintenant autorisé comme Routeur sur AuraPerps !");
    } catch (e) {
        console.error("❌ Erreur lors du setRouter :", e.shortMessage || e.message);
    }
}

main().catch(console.error);
