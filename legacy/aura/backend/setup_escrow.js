require("dotenv").config();
const { ethers } = require("ethers");

const rpcUrl = process.env.ARB_SEPOLIA_RPC || "https://sepolia-rollup.arbitrum.io/rpc";
const privateKey = process.env.PRIVATE_KEY; // Owner of the contracts

// Addresses from .env
const escrowAddress = process.env.ESCROW_ADDRESS;
const orderbookAddress = process.env.STYLUS_LOB_ADDRESS;

// Required for Escrow init
// If AUSD isn't deployed on Arbitrum Sepolia, we use the fallback from vaultAgent.js
const ausdAddress = process.env.ARB_SEPOLIA_AUSD || process.env.AUSD_ADDRESS;
const keeperWallet = new ethers.Wallet(process.env.KEEPER_PRIVATE_KEY);
const keeperAddress = keeperWallet.address;

async function main() {
    console.log("=== Lancement de la configuration de l'Escrow ===");
    
    const provider = new ethers.JsonRpcProvider(rpcUrl); provider.pollingInterval = 15000;
    const wallet = new ethers.Wallet(privateKey, provider);

    // 1. Initialize Escrow
    const escrowAbi = [
        "function init(address ausd, address orderbook, address keeper) external"
    ];
    const escrow = new ethers.Contract(escrowAddress, escrowAbi, wallet);

    console.log(`\n1. Initialisation de l'Escrow (${escrowAddress}) avec :`);
    console.log(`   - aUSD:      ${ausdAddress}`);
    console.log(`   - OrderBook: ${orderbookAddress}`);
    console.log(`   - Keeper:    ${keeperAddress}`);

    try {
        const tx1 = await escrow.init(ausdAddress, orderbookAddress, keeperAddress);
        console.log("   -> Tx init envoyée:", tx1.hash);
        await tx1.wait();
        console.log("   ✅ Initialisation de l'Escrow réussie !");
    } catch (e) {
        console.log("   ❌ Erreur init (peut-être déjà initialisé ?) :", e.shortMessage || e.message);
    }

    // 2. Authorize Escrow on OrderBook
    const orderbookAbi = [
        "function set_router(address router) external"
    ];
    const orderbook = new ethers.Contract(orderbookAddress, orderbookAbi, wallet);

    console.log(`\n2. Autorisation de l'Escrow sur le LOB OrderBook (${orderbookAddress})`);
    try {
        const tx2 = await orderbook.set_router(escrowAddress);
        console.log("   -> Tx set_router envoyée:", tx2.hash);
        await tx2.wait();
        console.log("   ✅ LOB OrderBook mis à jour ! L'Escrow est maintenant autorisé (en tant que router).");
    } catch (e) {
        console.log("   ❌ Erreur set_router :", e.shortMessage || e.message);
    }

    console.log("\n🚀 Tout est configuré ! L'Escrow et le LOB sont maintenant interconnectés.");
}

main().catch(console.error);
