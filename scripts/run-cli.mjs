#!/usr/bin/env node
import { spawn } from "node:child_process";
import { cliPath } from "./resolve-bin.mjs";

const cli = cliPath();
if (!cli) {
  process.stderr.write(
    "graph-retention CLI not found. Run pnpm build, or set GRAPH_RETENTION_CLI / GRAPH_RETENTION_ROOT.\n",
  );
  process.exit(1);
}

const child = spawn(process.execPath, [cli, ...process.argv.slice(2)], {
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
