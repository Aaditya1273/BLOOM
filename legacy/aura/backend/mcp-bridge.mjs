/**
 * mcp-bridge.mjs — Simple SSE-to-stdio bridge for Claude Code
 * Connects to the Aura MCP server via SSE and exposes it as stdio.
 * No OAuth, no browser popup.
 */
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const SSE_URL = process.env.AURA_MCP_URL || "https://mcp-serv-aura.up.railway.app/sse";

// Connect as client to remote SSE server
const sseTransport = new SSEClientTransport(new URL(SSE_URL));
const client = new Client({ name: "aura-bridge", version: "1.0.0" });
await client.connect(sseTransport);

// Get available tools from remote
const { tools } = await client.listTools();

// Create local stdio server that proxies to remote
const server = new McpServer({ name: "aura-perps", version: "1.0.0" });

for (const tool of tools) {
  server.registerTool(tool.name, {
    description: tool.description,
    inputSchema: z.object({}).passthrough(), // accept any input
  }, async (args) => {
    const result = await client.callTool({ name: tool.name, arguments: args });
    return result;
  });
}

const stdioTransport = new StdioServerTransport();
await server.connect(stdioTransport);
