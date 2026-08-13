import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

export function repoRoot() {
  const fromEnv = process.env.GRAPH_RETENTION_ROOT;
  if (fromEnv) {
    return path.resolve(fromEnv);
  }
  return path.resolve(scriptsDir, "..");
}

export function mcpServerPath() {
  const candidates = [
    process.env.GRAPH_RETENTION_MCP,
    path.join(repoRoot(), "packages", "mcp-server", "dist", "index.js"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}

export function cliPath() {
  const candidates = [
    process.env.GRAPH_RETENTION_CLI,
    path.join(repoRoot(), "packages", "cli", "dist", "index.js"),
  ].filter(Boolean);
  return candidates.find((p) => fs.existsSync(p));
}
