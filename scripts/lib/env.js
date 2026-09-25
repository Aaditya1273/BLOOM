// Loads .env.local then .env (first value wins). Keys are never logged.
// Key separation: there is NO fallback between roles and no PRIVATE_KEY alias. Each role has its own variable:
//   DEPLOYER_PRIVATE_KEY  ADMIN_PRIVATE_KEY (or ADMIN_ADDRESS for a multisig)  REPORTER_*  AGENT_*  CLAIM_AUTHORITY_*
//   DEMO_OWNER_*  FAUCET_*  MOCK_ORACLE_*   (use *_ADDRESS when only the address is needed, e.g. at deploy time)
const path = require("path");
const dotenv = require("dotenv");

const root = path.join(__dirname, "..", "..");
dotenv.config({ path: path.join(root, ".env.local"), quiet: true });
dotenv.config({ path: path.join(root, ".env"), quiet: true });

const hex = (k) => (k ? (k.trim().startsWith("0x") ? k.trim() : `0x${k.trim()}`) : undefined);
if (process.env.DEPLOYER_PRIVATE_KEY) process.env.DEPLOYER_PRIVATE_KEY = hex(process.env.DEPLOYER_PRIVATE_KEY);

/** Address for a role from ROLE_ADDRESS or ROLE_PRIVATE_KEY; throws if neither is set. */
function roleAddress(role) {
  const { ethers } = require("ethers");
  const a = process.env[`${role}_ADDRESS`];
  if (a) return ethers.getAddress(a);
  const k = process.env[`${role}_PRIVATE_KEY`];
  if (k) return new ethers.Wallet(hex(k)).address;
  throw new Error(`Set ${role}_ADDRESS or ${role}_PRIVATE_KEY (each role needs its own key)`);
}
const roleKey = (role) => hex(process.env[`${role}_PRIVATE_KEY`]);

module.exports = { roleAddress, roleKey, hex };
