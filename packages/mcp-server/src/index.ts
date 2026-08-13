#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GraphEngine } from "@graph-retention/core";
import { createMcpServer } from "./server.js";

const engine = new GraphEngine({
  dbPath: process.env.GRAPH_RETENTION_DB,
  cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
});

const server = createMcpServer(engine);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

process.on("SIGINT", () => {
  engine.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  engine.close();
  process.exit(0);
});
