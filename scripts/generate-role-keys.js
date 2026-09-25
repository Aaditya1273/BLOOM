// Creates one distinct key per Bloom role in the repo-root .env.local (gitignored) if missing. Prints ADDRESSES only.
// A legacy single `PRIVATE_KEY=` line is renamed to DEPLOYER_PRIVATE_KEY and flagged: that key controlled every role
// before key separation, so it must be treated as compromised and used for nothing but retiring itself.
//   node scripts/generate-role-keys.js
const fs = require("fs");
const path = require("path");
const { parseEnv } = require("util");
const { Wallet } = require("ethers");

const file = path.join(__dirname, "..", ".env.local");
let text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
const ROLES = ["ADMIN", "REPORTER", "AGENT", "CLAIM_AUTHORITY", "DEMO_OWNER", "FAUCET", "MOCK_ORACLE"];

if (/^PRIVATE_KEY=/m.test(text) && !/^DEPLOYER_PRIVATE_KEY=/m.test(text)) {
  text = text.replace(
    /^PRIVATE_KEY=/m,
    "# RETIRED single key: it held every role before key separation. Treat as compromised; never reuse for any role.\nDEPLOYER_PRIVATE_KEY=",
  );
  console.log("renamed PRIVATE_KEY -> DEPLOYER_PRIVATE_KEY (marked retired)");
}
const env = parseEnv(text);
const lines = [];
for (const r of ROLES) {
  const name = `${r}_PRIVATE_KEY`;
  if (env[name]) {
    console.log(`${r.padEnd(16)} ${new Wallet(env[name].startsWith("0x") ? env[name] : `0x${env[name]}`).address}  (existing)`);
    continue;
  }
  const w = Wallet.createRandom();
  lines.push(`${name}=${w.privateKey}`);
  console.log(`${r.padEnd(16)} ${w.address}  (new)`);
}
if (lines.length) text = `${text.replace(/\n*$/, "\n")}\n# Bloom role keys (one per role, generated ${new Date().toISOString().slice(0, 10)})\n${lines.join("\n")}\n`;
fs.writeFileSync(file, text, { mode: 0o600 });
fs.chmodSync(file, 0o600);
