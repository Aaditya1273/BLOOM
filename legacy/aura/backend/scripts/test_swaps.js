/**
 * Test all Synthra V3 swap paths — PROVEN "transfer-to-router + payerIsUser=false" pattern.
 * 
 * Tests:
 *  1. ETH → AMZN  (deposit WETH → transfer to router → swap)
 *  2. AMZN → WETH (transfer to router → swap)
 *  3. AMZN → TSLA (transfer to router → swap token-to-token)
 * 
 * Usage: node scripts/test_swaps.js
 */
require("dotenv").config();
const { ethers } = require("ethers");

const RPC = process.env.RPC_URL || "https://rpc.testnet.chain.robinhood.com";
const PK = process.env.PRIVATE_KEY;

const TOKENS = {
    WETH: "0x33e4191705c386532ba27cBF171Db86919200B94",
    AMZN: "0x5884aD2f920c162CFBbACc88C9C51AA75eC09E02",
    TSLA: "0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E",
    AMD: "0x71178BAc73cBeb415514eB542a8995b82669778d",
    AUSD: process.env.AUSD_ADDRESS || "0x359961489f069F16E5dbA46d9b174bBF7b25147B",
};

const SYNTHRA_ROUTER = process.env.ROUTER_ADDRESS || "0x6F308B834595312f734e65e273F2210f43Fc48F8";

const ERC20_ABI = [
    "function approve(address, uint256) external returns (bool)",
    "function balanceOf(address) view returns (uint256)",
    "function transfer(address, uint256) external returns (bool)",
];

const WETH_ABI = [
    "function deposit() external payable",
    "function balanceOf(address) view returns (uint256)",
];

const ROUTER_ABI = [
    "function execute(bytes calldata commands, bytes[] calldata inputs, uint256 deadline) external payable",
];

let passed = 0, failed = 0;

async function main() {
    const network = ethers.Network.from(46630);
    const provider = new ethers.JsonRpcProvider(RPC, network, { staticNetwork: network });
    const wallet = new ethers.Wallet(PK, provider);

    console.log(`\n🧪 SYNTHRA SWAP TEST SUITE (transfer-to-router pattern)`);
    console.log(`═══════════════════════════════════`);
    console.log(`Wallet: ${wallet.address}`);
    
    const ethBal = await provider.getBalance(wallet.address);
    console.log(`ETH balance: ${ethers.formatEther(ethBal)}`);
    for (const [sym, addr] of Object.entries(TOKENS)) {
        const c = new ethers.Contract(addr, ERC20_ABI, provider);
        const bal = await c.balanceOf(wallet.address);
        console.log(`${sym} balance: ${ethers.formatEther(bal)}`);
    }
    console.log(`═══════════════════════════════════\n`);

    // Test 1: ETH → AMZN
    await testEthToToken(wallet, TOKENS.AMZN, "AMZN", "0.0001");
    await sleep(2000);

    // Test 2: AMZN → WETH
    await testTokenToToken(wallet, TOKENS.AMZN, TOKENS.WETH, "AMZN", "WETH", "0.0001");
    await sleep(2000);

    // Test 3: AMZN → TSLA
    await testTokenToToken(wallet, TOKENS.AMZN, TOKENS.TSLA, "AMZN", "TSLA", "0.0001");
    await sleep(2000);

    // Test 4: AMZN → AMD
    await testTokenToToken(wallet, TOKENS.AMZN, TOKENS.AMD, "AMZN", "AMD", "0.0001");
    await sleep(2000);

    // Test 5: TSLA → AMZN
    await testTokenToToken(wallet, TOKENS.TSLA, TOKENS.AMZN, "TSLA", "AMZN", "0.0001");
    await sleep(2000);

    // Test 6: TSLA → WETH
    await testTokenToToken(wallet, TOKENS.TSLA, TOKENS.WETH, "TSLA", "WETH", "0.0001");
    await sleep(2000);

    // Test 7: WETH → AMZN
    await testTokenToToken(wallet, TOKENS.WETH, TOKENS.AMZN, "WETH", "AMZN", "0.0001");
    await sleep(2000);

    // Test 8: WETH → TSLA
    await testTokenToToken(wallet, TOKENS.WETH, TOKENS.TSLA, "WETH", "TSLA", "0.0001");
    await sleep(2000);

    // Test 9: ETH → TSLA
    await testEthToToken(wallet, TOKENS.TSLA, "TSLA", "0.0001");
    // Test 10: aUSD → WETH
    await testTokenToToken(wallet, TOKENS.AUSD, TOKENS.WETH, "AUSD", "WETH", "0.0001");
    await sleep(2000);

    console.log(`✅ Passed: ${passed}  ❌ Failed: ${failed}`);
    console.log(`═══════════════════════════════════\n`);
    process.exit(failed > 0 ? 1 : 0);
}

async function testEthToToken(wallet, tokenOutAddr, tokenOutSym, amount) {
    console.log(`\n─── Test: ETH → ${tokenOutSym} (${amount} ETH) ───`);
    const amt = ethers.parseEther(amount);
    const WETH = TOKENS.WETH;
    const ROUTER = SYNTHRA_ROUTER;

    try {
        // 1. Wrap
        const weth = new ethers.Contract(WETH, WETH_ABI, wallet);
        const wrapTx = await weth.deposit({ value: amt });
        await wrapTx.wait();
        console.log(`  1. ✅ Wrapped ETH→WETH`);

        // 2. Transfer to router
        const erc = new ethers.Contract(WETH, ERC20_ABI, wallet);
        const txTx = await erc.transfer(ROUTER, amt);
        await txTx.wait();
        console.log(`  2. ✅ Transferred WETH to Router`);

        // 3. Swap
        const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
        const path = ethers.solidityPacked(["address","uint24","address"], [WETH, 3000, tokenOutAddr]);
        const inp = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address","uint256","uint256","bytes","bool"],
            [wallet.address, amt, 0, path, false]
        );
        const swapTx = await router.execute("0x00", [inp], Math.floor(Date.now()/1000)+1800);
        const rc = await swapTx.wait();
        console.log(`  3. ✅ Swap OK! TX: ${rc.hash} | Gas: ${rc.gasUsed}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAILED: ${err.shortMessage || err.message}`);
        failed++;
    }
}

async function testTokenToToken(wallet, tokenInAddr, tokenOutAddr, inSym, outSym, amount) {
    console.log(`\n─── Test: ${inSym} → ${outSym} (${amount} ${inSym}) ───`);
    const amt = ethers.parseEther(amount);
    const ROUTER = SYNTHRA_ROUTER;

    try {
        const erc = new ethers.Contract(tokenInAddr, ERC20_ABI, wallet);
        const bal = await erc.balanceOf(wallet.address);
        if (bal < amt) {
            console.log(`  ⚠️ Insufficient ${inSym}: ${ethers.formatEther(bal)}. Skipping.`);
            return;
        }

        // 1. Transfer to router
        const txTx = await erc.transfer(ROUTER, amt);
        await txTx.wait();
        console.log(`  1. ✅ Transferred ${inSym} to Router`);

        // 2. Swap
        const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
        const wethAddress = TOKENS.WETH; // Use WETH from TOKENS
        let path;
        if (tokenInAddr.toLowerCase() === wethAddress.toLowerCase() || tokenOutAddr.toLowerCase() === wethAddress.toLowerCase()) {
            path = ethers.solidityPacked(["address","uint24","address"], [tokenInAddr, 3000, tokenOutAddr]);
        } else {
            path = ethers.solidityPacked(
                ["address", "uint24", "address", "uint24", "address"],
                [tokenInAddr, 3000, wethAddress, 3000, tokenOutAddr]
            );
        }
        const inp = ethers.AbiCoder.defaultAbiCoder().encode(
            ["address","uint256","uint256","bytes","bool"],
            [wallet.address, amt, 0, path, false]
        );
        const swapTx = await router.execute("0x00", [inp], Math.floor(Date.now()/1000)+1800);
        const rc = await swapTx.wait();
        console.log(`  2. ✅ Swap OK! TX: ${rc.hash} | Gas: ${rc.gasUsed}`);
        passed++;
    } catch (err) {
        console.error(`  ❌ FAILED: ${err.shortMessage || err.message}`);
        failed++;
    }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
main().catch(console.error);
