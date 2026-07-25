/**
 * MCP Server for SubScript Web3 USDC Payments & Vault Metering.
 * Exposes payment tools for AI Agents (create_intent, create_subscription, report_vault_usage).
 */
import readline from "node:readline";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false,
});

const TOOLS = [
  {
    name: "subscript_create_intent",
    description: "Create a one-time SubScript checkout intent for USDC payment",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        amountUsdcMicros: { type: "string" },
        externalReference: { type: "string" },
      },
      required: ["title", "amountUsdcMicros"],
    },
  },
  {
    name: "subscript_create_subscription",
    description: "Create a recurring SubScript USDC subscription",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string" },
        amountUsdcMicros: { type: "string" },
        interval: { type: "string", enum: ["weekly", "monthly"] },
      },
      required: ["title", "amountUsdcMicros", "interval"],
    },
  },
  {
    name: "subscript_report_vault_usage",
    description: "Report metered usage against a customer's SubScript vault",
    inputSchema: {
      type: "object",
      properties: {
        userAddress: { type: "string" },
        amountUsdcMicros: { type: "string" },
      },
      required: ["userAddress", "amountUsdcMicros"],
    },
  },
];

rl.on("line", (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.method === "tools/list") {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: { tools: TOOLS },
        })
      );
    } else if (msg.method === "initialize") {
      console.log(
        JSON.stringify({
          jsonrpc: "2.0",
          id: msg.id,
          result: {
            protocolVersion: "2024-11-05",
            capabilities: { tools: {} },
            serverInfo: { name: "subscript-mcp", version: "1.0.0" },
          },
        })
      );
    }
  } catch {
    // Ignore malformed JSON
  }
});
