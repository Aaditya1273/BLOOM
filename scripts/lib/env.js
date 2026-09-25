// Loads .env.local then .env (first value wins) and normalises the deployer key.
// PRIVATE_KEY (with or without 0x) is accepted as DEPLOYER_PRIVATE_KEY. Keys are never logged.
const path = require("path");
const dotenv = require("dotenv");

const root = path.join(__dirname, "..", "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const hex = (k) => (k ? (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) : undefined);
if (!process.env.DEPLOYER_PRIVATE_KEY && process.env.PRIVATE_KEY) process.env.DEPLOYER_PRIVATE_KEY = hex(process.env.PRIVATE_KEY);
if (process.env.DEPLOYER_PRIVATE_KEY) process.env.DEPLOYER_PRIVATE_KEY = hex(process.env.DEPLOYER_PRIVATE_KEY);

/** Testnet convenience: operational roles fall back to the deployer key. Never used for chain 4663. */
function testnetRoleKey(name) {
  return hex(process.env[name]) || process.env.DEPLOYER_PRIVATE_KEY;
}

module.exports = { testnetRoleKey };
