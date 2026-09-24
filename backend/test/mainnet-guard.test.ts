// On chain 4663 the server must refuse owner-key, faucet and simulate operations and never load those keys.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.BLOOM_DEPLOYMENT = "../backend/test/fixtures/mainnet-deployment";
process.env.RPC_URL = "http://127.0.0.1:1"; // never contacted by these routes
process.env.BLOOM_DATA_DIR = mkdtempSync(join(tmpdir(), "bloom-"));
process.env.DEMO_OWNER_PRIVATE_KEY = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba"; // must be ignored
const { createApp } = await import("../src/app.ts");
const ctx = await import("../src/ctx.ts");

test("mainnet: demo owner / minter keys are not loaded", () => {
  assert.equal(ctx.MAINNET, true);
  assert.equal(ctx.demoOwner, null);
  assert.equal(ctx.minter, null);
});

test("mainnet: faucet, owner actions and simulate return TESTNET_ONLY", async () => {
  const server = createApp(null).listen(0);
  const port = (server.address() as any).port;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, body: (await r.json()) as any };
  };
  const owner = "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc";
  try {
    for (const [path, body] of [
      ["/api/faucet", { owner }],
      ["/api/deposit", { owner, amount: "1" }],
      ["/api/risk/simulate", { symbol: "AAPL", scenario: "HALT" }],
    ] as const) {
      const r = await post(path, body);
      assert.equal(r.status, 403, path);
      assert.equal(r.body.error.code, "TESTNET_ONLY", path);
    }
  } finally {
    server.close();
  }
});
