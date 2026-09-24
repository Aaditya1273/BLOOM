/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   AURA PROTOCOL — Hybrid LOB+AMM Deployment (v2)                ║
 * ║                                                                  ║
 * ║   Deploys the full hybrid stack from scratch:                    ║
 * ║   aUSD, MockOracle, AuraVault, AuraPerps (with                   ║
 * ║   openPositionAtPrice), AuraOrderBook (with sorted views +       ║
 * ║   consume_order), AuraPerpsRouter (placeLimitOrderFor +          ║
 * ║   routedMarketOpen), AuraMMFund.                                  ║
 * ║                                                                  ║
 * ║   Then wires every relationship, registers all 7 assets, sets    ║
 * ║   the MM agent, seeds the vault + MMFund, sets initial oracle    ║
 * ║   prices, and prints the .env diff to apply.                     ║
 * ║                                                                  ║
 * ║   Run: npx hardhat run scripts/deploy-hybrid-lob.js \             ║
 * ║          --network robinhoodTestnet                              ║
 * ║                                                                  ║
 * ║   Optional env:                                                  ║
 * ║     MM_AGENT_ADDRESS  — wallet that drives the AI Market Maker   ║
 * ║                         (defaults to deployer)                   ║
 * ║     VAULT_SEED_AUSD   — seed liquidity (default 5000)            ║
 * ║     MMFUND_SEED_AUSD  — MMFund balance     (default 2000)        ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */
const { ethers } = require("hardhat");

const ASSETS_AND_PRICES = {
    BTC:  ethers.parseUnits("104000", 18),
    ETH:  ethers.parseUnits("2500",   18),
    TSLA: ethers.parseUnits("350",    18),
    AMZN: ethers.parseUnits("200",    18),
    AMD:  ethers.parseUnits("160",    18),
    NFLX: ethers.parseUnits("700",    18),
    PLTR: ethers.parseUnits("120",    18),
};

async function main() {
    const VAULT_SEED  = ethers.parseUnits(process.env.VAULT_SEED_AUSD  || "5000", 18);
    const MMFUND_SEED = ethers.parseUnits(process.env.MMFUND_SEED_AUSD || "2000", 18);

    const [deployer] = await ethers.getSigners();
    const mmAgent = process.env.MM_AGENT_ADDRESS || deployer.address;

    console.log("╔══════════════════════════════════════════════════════╗");
    console.log("║          AURA HYBRID LOB+AMM — DEPLOY v2              ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log("Deployer:           ", deployer.address);
    console.log("MM Agent:           ", mmAgent + (mmAgent === deployer.address ? "  (== deployer)" : ""));
    console.log("Vault seed:         ", ethers.formatUnits(VAULT_SEED, 18), "aUSD");
    console.log("MMFund seed:        ", ethers.formatUnits(MMFUND_SEED, 18), "aUSD");
    const bal = await ethers.provider.getBalance(deployer.address);
    console.log("Deployer ETH:       ", ethers.formatEther(bal), "ETH");
    console.log();

    // ── 1. aUSD ────────────────────────────────────────────────
    const AUSD = await ethers.getContractFactory("aUSD");
    const aUSD = await AUSD.deploy();
    await aUSD.waitForDeployment();
    const aUSDAddr = await aUSD.getAddress();
    console.log("✅ aUSD                ", aUSDAddr);

    // Mint enough for vault seed + MMFund seed + buffer for the deployer.
    const totalMint = VAULT_SEED + MMFUND_SEED + ethers.parseUnits("1000", 18);
    await (await aUSD.mint(deployer.address, totalMint)).wait();
    console.log("   minted             ", ethers.formatUnits(totalMint, 18), "aUSD to deployer");

    // ── 2. MockOracle ───────────────────────────────────────────
    const Oracle = await ethers.getContractFactory("MockOracle");
    const oracle = await Oracle.deploy();
    await oracle.waitForDeployment();
    const oracleAddr = await oracle.getAddress();
    console.log("✅ MockOracle          ", oracleAddr);
    for (const [asset, price] of Object.entries(ASSETS_AND_PRICES)) {
        await (await oracle.setPrice(asset, price)).wait();
    }
    console.log("   oracle prices set  ", Object.keys(ASSETS_AND_PRICES).join(", "));

    // ── 3. AuraVault (ERC-4626) ─────────────────────────────────
    const Vault = await ethers.getContractFactory("AuraVault");
    const vault = await Vault.deploy(aUSDAddr);
    await vault.waitForDeployment();
    const vaultAddr = await vault.getAddress();
    console.log("✅ AuraVault           ", vaultAddr);

    // ── 4. AuraPerps (with openPositionAtPrice) ─────────────────
    const Perps = await ethers.getContractFactory("AuraPerps");
    const perps = await Perps.deploy(aUSDAddr, oracleAddr, vaultAddr);
    await perps.waitForDeployment();
    const perpsAddr = await perps.getAddress();
    console.log("✅ AuraPerps           ", perpsAddr);

    await (await vault.setAuraPerps(perpsAddr)).wait();
    console.log("   vault → perps wired");

    // ── 5. AuraOrderBook (with sorted views + consume_order) ────
    const LOB = await ethers.getContractFactory("AuraOrderBook");
    const lob = await LOB.deploy();
    await lob.waitForDeployment();
    const lobAddr = await lob.getAddress();
    console.log("✅ AuraOrderBook       ", lobAddr);

    // ── 6. AuraPerpsRouter (with placeLimitOrderFor + routedMarketOpen) ──
    const Router = await ethers.getContractFactory("AuraPerpsRouter");
    const router = await Router.deploy(aUSDAddr, lobAddr, perpsAddr, oracleAddr);
    await router.waitForDeployment();
    const routerAddr = await router.getAddress();
    console.log("✅ AuraPerpsRouter     ", routerAddr);

    // Wire everything that points back at the router.
    await (await perps.setRouter(routerAddr)).wait();
    console.log("   perps → router wired");

    await (await lob.initialize(routerAddr, deployer.address)).wait();
    console.log("   lob.initialize(router, keeper=deployer)");

    // Register all 7 markets on the router.
    for (const asset of Object.keys(ASSETS_AND_PRICES)) {
        await (await router.registerAsset(asset)).wait();
    }
    console.log("   assets registered  ", Object.keys(ASSETS_AND_PRICES).length);

    await (await router.setMmAgent(mmAgent)).wait();
    console.log("   router.setMmAgent(", mmAgent, ")");

    // ── 7. AuraMMFund ───────────────────────────────────────────
    const MMFund = await ethers.getContractFactory("AuraMMFund");
    const mmFund = await MMFund.deploy(aUSDAddr, routerAddr);
    await mmFund.waitForDeployment();
    const mmFundAddr = await mmFund.getAddress();
    console.log("✅ AuraMMFund          ", mmFundAddr);

    await (await mmFund.setAgent(mmAgent)).wait();
    console.log("   mmFund.setAgent(", mmAgent, ")");

    // ── 8. Seed liquidity ───────────────────────────────────────
    await (await aUSD.approve(vaultAddr, VAULT_SEED)).wait();
    await (await vault.deposit(VAULT_SEED, deployer.address)).wait();
    console.log("   vault seeded with  ", ethers.formatUnits(VAULT_SEED, 18), "aUSD");

    await (await aUSD.approve(mmFundAddr, MMFUND_SEED)).wait();
    await (await mmFund.deposit(MMFUND_SEED)).wait();
    console.log("   MMFund seeded with ", ethers.formatUnits(MMFUND_SEED, 18), "aUSD");

    // ── SUMMARY ─────────────────────────────────────────────────
    const summary = {
        aUSD:        aUSDAddr,
        MockOracle:  oracleAddr,
        AuraVault:   vaultAddr,
        AuraPerps:   perpsAddr,
        AuraOrderBook: lobAddr,
        AuraPerpsRouter: routerAddr,
        AuraMMFund:  mmFundAddr,
        MmAgent:     mmAgent,
    };

    console.log("\n╔══════════════════════════════════════════════════════╗");
    console.log("║                   .env DIFF                           ║");
    console.log("╚══════════════════════════════════════════════════════╝");
    console.log(`# ── Aura Hybrid LOB+AMM addresses ────────────────────`);
    console.log(`AUSD_ADDRESS=${aUSDAddr}`);
    console.log(`MOCK_ORACLE_ADDRESS=${oracleAddr}`);
    console.log(`AURA_VAULT_ADDRESS=${vaultAddr}`);
    console.log(`AURA_PERPS_ADDRESS=${perpsAddr}`);
    console.log(`STYLUS_LOB_ADDRESS=${lobAddr}                  # name kept for backwards-compat — currently the Solidity LOB`);
    console.log(`LOB_ROUTER_ADDRESS=${routerAddr}`);
    console.log(`MM_FUND_ADDRESS=${mmFundAddr}`);
    console.log();
    console.log(`# ── Frontend Next.js public env (frontend/.env) ──────`);
    console.log(`NEXT_PUBLIC_LOB_ROUTER_ADDRESS=${routerAddr}`);
    console.log(`NEXT_PUBLIC_MM_FUND_ADDRESS=${mmFundAddr}`);
    console.log();
    console.log(`# ── frontend/lib/contracts.ts ────────────────────────`);
    console.log(`#   Update:`);
    console.log(`#     AURA_PERPS:  "${perpsAddr}"`);
    console.log(`#     AURA_VAULT:  "${vaultAddr}"`);
    console.log(`#     AUSD:        "${aUSDAddr}"`);
    console.log(`#     MOCK_ORACLE: "${oracleAddr}"`);
    console.log(`#     STYLUS_LOB:  "${lobAddr}"`);
    console.log();
    console.log("Tip: scripts/check-hybrid.js verifies the wiring post-deploy.");
    console.log();

    return summary;
}

main()
    .then(() => process.exit(0))
    .catch((e) => {
        console.error("\n❌ Deployment failed:", e);
        process.exit(1);
    });
