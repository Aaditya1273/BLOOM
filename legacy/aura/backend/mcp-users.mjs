/**
 * mcp-users.mjs — MCP user store (delegation model)
 *
 * Maps API keys to AuraAccount addresses. No private keys stored.
 * The MCP server executes via executeBatchByAgent using its own wallet.
 * File: backend/.mcp-users.json
 */

import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STORE_PATH = process.env.MCP_STORE_PATH || join(__dirname, ".mcp-users.json");

function loadStore() {
  // Try file first
  if (existsSync(STORE_PATH)) {
    try { return JSON.parse(readFileSync(STORE_PATH, "utf8")); } catch {}
  }
  // Fallback: load from env var (persists across Railway deploys)
  if (process.env.MCP_USERS_DATA) {
    try { return JSON.parse(process.env.MCP_USERS_DATA); } catch {}
  }
  return {};
}

function saveStore(store) {
  writeFileSync(STORE_PATH, JSON.stringify(store, null, 2));
}

/**
 * Register a user's AuraAccount. Returns the API key. 1 per account.
 */
export function registerUser(auraAccountAddress, ownerWallet) {
  const normalized = auraAccountAddress.toLowerCase();
  const store = loadStore();

  // Check if account already has a key
  for (const [apiKey, record] of Object.entries(store)) {
    if (record.auraAccount === normalized) throw new Error("ALREADY_EXISTS");
  }

  const apiKey = `aura_${randomUUID().replace(/-/g, "")}`;
  store[apiKey] = { auraAccount: normalized, ownerWallet: ownerWallet ? ownerWallet.toLowerCase() : null, createdAt: Date.now() };
  saveStore(store);
  return apiKey;
}

/**
 * Resolve an API key to an AuraAccount address. Returns null if not found.
 */
export function resolveApiKey(apiKey) {
  const store = loadStore();
  const record = store[apiKey];
  return record ? { auraAccount: record.auraAccount, ownerWallet: record.ownerWallet || null } : null;
}

/**
 * Get the API key for an AuraAccount address.
 */
export function getKeyForAccount(auraAccountAddress) {
  const normalized = auraAccountAddress.toLowerCase();
  const store = loadStore();
  for (const [apiKey, record] of Object.entries(store)) {
    if (record.auraAccount === normalized) {
      return { apiKey, auraAccount: normalized };
    }
  }
  return null;
}

/**
 * Delete the API key for an AuraAccount address.
 */
export function deleteKeyForAccount(auraAccountAddress) {
  const normalized = auraAccountAddress.toLowerCase();
  const store = loadStore();
  for (const [apiKey, record] of Object.entries(store)) {
    if (record.auraAccount === normalized) {
      delete store[apiKey];
      saveStore(store);
      return true;
    }
  }
  return false;
}
