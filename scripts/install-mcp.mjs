#!/usr/bin/env node
/**
 * Register graph-retention with Claude Code and Codex using absolute
 * paths so the clients spawn the stdio server on launch. Does not
 * leave a node process running.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { repoRoot } from "./resolve-bin.mjs";

const launcher = path.join(repoRoot(), "scripts", "run-mcp.mjs");
const nodeBin = process.execPath;

function which(bin) {
  const result = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function run(bin, args, { ignoreStatus = false } = {}) {
  const result = spawnSync(bin, args, { stdio: "inherit", encoding: "utf8" });
  if (!ignoreStatus && result.status !== 0) {
    return false;
  }
  return result.status === 0 || ignoreStatus;
}

console.log(`Launcher: ${nodeBin} ${launcher}`);

let failed = 0;

if (which("claude")) {
  for (const scope of ["user", "local", "project"]) {
    run("claude", ["mcp", "remove", "-s", scope, "graph-retention"], { ignoreStatus: true });
  }
  const ok = run("claude", [
    "mcp",
    "add",
    "-s",
    "user",
    "graph-retention",
    "--",
    nodeBin,
    launcher,
  ]);
  if (ok) {
    console.log("Claude Code: registered (user scope). Restarts spawn the MCP.");
  } else {
    console.error("Claude Code: failed to register.");
    failed += 1;
  }
} else {
  console.log("Claude Code: `claude` CLI not on PATH. Skip.");
}

if (which("codex")) {
  run("codex", ["mcp", "remove", "graph-retention"], { ignoreStatus: true });
  const ok = run("codex", ["mcp", "add", "graph-retention", "--", nodeBin, launcher]);
  if (ok) {
    console.log("Codex: registered. Restarts spawn the MCP.");
  } else {
    console.error("Codex: failed to register.");
    failed += 1;
  }
} else {
  console.log("Codex: `codex` CLI not on PATH. Skip.");
}

if (!which("claude") && !which("codex")) {
  console.error("Neither `claude` nor `codex` is on PATH.");
  process.exit(1);
}

process.exit(failed === 0 ? 0 : 1);
