#!/usr/bin/env node
/**
 * mcp-register.mjs — Register a user wallet for the Aura MCP server
 *
 * Usage:
 *   node mcp-register.mjs                    (interactive — prompts for private key)
 *   node mcp-register.mjs --key 0xabc...     (non-interactive)
 *   node mcp-register.mjs --list             (show registered users)
 *
 * The private key is encrypted with AES-256-GCM and stored locally.
 * You receive an API key to use as Bearer token with the MCP server.
 */

import { config } from "dotenv";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "readline";
import { randomBytes } from "crypto";
import { existsSync, appendFileSync } from "fs";
import { ethers } from "ethers";
import { registerUser, listUsers } from "./mcp-users.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, ".env"), override: true });

// Auto-generate MCP_MASTER_SECRET if missing
if (!process.env.MCP_MASTER_SECRET || process.env.MCP_MASTER_SECRET.length < 16) {
  const generated = randomBytes(32).toString("hex");
  appendFileSync(join(__dirname, ".env"), `\nMCP_MASTER_SECRET=${generated}\n`);
  process.env.MCP_MASTER_SECRET = generated;
  console.log("✓ Generated MCP_MASTER_SECRET (appended to .env)");
}

const args = process.argv.slice(2);

if (args.includes("--list")) {
  const users = await listUsers();
  if (users.length === 0) { console.log("No users registered."); process.exit(0); }
  console.log("\nRegistered MCP users:");
  for (const u of users) console.log(`  ${u.apiKeyPrefix}  →  ${u.address}`);
  process.exit(0);
}

let privateKey = args.includes("--key") ? args[args.indexOf("--key") + 1] : null;

if (!privateKey) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  privateKey = await new Promise((resolve) => {
    rl.question("Enter private key (0x...): ", (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

// Validate
if (!privateKey.startsWith("0x") || privateKey.length < 64) {
  console.error("✗ Invalid private key format. Must start with 0x and be 66 chars.");
  process.exit(1);
}

try {
  const wallet = new ethers.Wallet(privateKey);
  const apiKey = await registerUser(privateKey);

  console.log(`\n╔═══════════════════════════════════════════════════════════╗`);
  console.log(`║  ✓ User registered for Aura MCP Server                   ║`);
  console.log(`╠═══════════════════════════════════════════════════════════╣`);
  console.log(`║  Address:  ${wallet.address}  ║`);
  console.log(`║  API Key:  ${apiKey}  ║`);
  console.log(`╠═══════════════════════════════════════════════════════════╣`);
  console.log(`║  Use this API key as Bearer token in your MCP client:    ║`);
  console.log(`║                                                           ║`);
  console.log(`║  Authorization: Bearer ${apiKey.slice(0, 20)}...          ║`);
  console.log(`╚═══════════════════════════════════════════════════════════╝`);
  console.log(`\nClaude Desktop config (HTTP mode):`);
  console.log(JSON.stringify({
    mcpServers: {
      "aura-perps": {
        url: "http://localhost:3002/mcp",
        headers: { Authorization: `Bearer ${apiKey}` }
      }
    }
  }, null, 2));
} catch (e) {
  console.error("✗ Registration failed:", e.message);
  process.exit(1);
}
