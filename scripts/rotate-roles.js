// Moves every role of an EXISTING deployment off the (retired) single deployer key onto distinct role keys.
//   npx hardhat run scripts/rotate-roles.js --network robinhoodTestnet
// Funds each role key with a little gas from the deployer (ROLE_GAS_ETH), hands over all roles (admin accepts
// ownership), then proves the deployer holds nothing and records the roles in the deployment manifest.
const fs = require("fs");
const path = require("path");
const { ethers, network } = require("hardhat");
const { roleAddress, roleKey } = require("./lib/env");
const { handOverRoles, rolesHeldBy } = require("./lib/roles");

const GAS_ETH = {
  ADMIN: "0.0006", REPORTER: "0.0025", MOCK_ORACLE: "0.0025", AGENT: "0.0015", CLAIM_AUTHORITY: "0.0005", FAUCET: "0.001", DEMO_OWNER: "0.0003",
};

async function main() {
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  if (chainId !== 46630) throw new Error(`rotate-roles is for Robinhood Chain testnet (46630), got ${chainId}`);
  const file = path.join(__dirname, "..", "deployments", "robinhood-testnet.json");
  const dep = JSON.parse(fs.readFileSync(file, "utf8"));
  const [deployer] = await ethers.getSigners();
  const roles = Object.fromEntries(Object.keys(GAS_ETH).map((r) => [r, roleAddress(r)]));
  const all = [deployer.address, ...Object.values(roles)].map((a) => a.toLowerCase());
  if (new Set(all).size !== all.length) throw new Error("every role (and the deployer) must be a distinct address");
  console.log(`network ${network.name}, deployer ${deployer.address} (retiring), balance ${ethers.formatEther(await ethers.provider.getBalance(deployer.address))} ETH`);

  console.log("\nFunding role keys with gas:");
  for (const [r, a] of Object.entries(roles)) {
    const want = ethers.parseEther(process.env[`ROLE_GAS_${r}`] ?? GAS_ETH[r]);
    const have = await ethers.provider.getBalance(a);
    if (have >= want) {
      console.log(`  · ${r.padEnd(16)} ${a} already has ${ethers.formatEther(have)} ETH`);
      continue;
    }
    const tx = await deployer.sendTransaction({ to: a, value: want - have });
    await tx.wait();
    console.log(`  ✓ ${r.padEnd(16)} ${a} +${ethers.formatEther(want - have)} ETH  ${tx.hash}`);
  }

  console.log("\nHanding over roles:");
  const adminSigner = new ethers.Wallet(roleKey("ADMIN"), ethers.provider);
  const pending = await handOverRoles(dep, {
    deployer, adminSigner, admin: roles.ADMIN, reporter: roles.REPORTER, claimAuthority: roles.CLAIM_AUTHORITY,
    faucet: roles.FAUCET, mockOracle: roles.MOCK_ORACLE, log: console.log,
  });
  if (pending.length) throw new Error(`unexpected pending actions: ${pending.join("; ")}`);

  const left = await rolesHeldBy(dep, deployer.address);
  if (left.length) throw new Error(`deployer still holds: ${left.join(", ")}`);
  console.log("\n✓ deployer holds no role on any contract");

  dep.roles = {
    admin: roles.ADMIN, reporter: roles.REPORTER, agent: roles.AGENT, claimAuthority: roles.CLAIM_AUTHORITY,
    demoOwner: roles.DEMO_OWNER, faucet: roles.FAUCET, mockOracle: roles.MOCK_ORACLE,
    deployer: `${deployer.address} (retired: no roles; former single key, treat as compromised)`,
  };
  dep.rolesRotatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(dep, null, 2) + "\n");
  console.log(`roles recorded in deployments/robinhood-testnet.json`);
}

main().catch((e) => {
  console.error(`\nROTATION FAILED: ${e.message}`);
  process.exitCode = 1;
});
