#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerEventTools } from "./tools/events.js";
import { registerEventDetailTools } from "./tools/event-details.js";

const server = new McpServer({ name: "smoothcomp-mcp-server", version: "1.0.0" });

registerEventTools(server);
registerEventDetailTools(server);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("smoothcomp-mcp-server running on stdio");
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
