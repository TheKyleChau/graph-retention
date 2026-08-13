#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mcpServerPath } from "./resolve-bin.mjs";

const server = mcpServerPath();
if (!server) {
  process.stderr.write(
    "graph-retention MCP server not found. Run pnpm build, or set GRAPH_RETENTION_MCP / GRAPH_RETENTION_ROOT.\n",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [server, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: process.env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 1);
});
