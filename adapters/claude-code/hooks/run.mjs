#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { cliPath } from "../../../scripts/resolve-bin.mjs";

const hook = process.argv[2];
const hookMap = {
  SessionStart: "session-start",
  SessionEnd: "session-end",
  PreCompact: "pre-compact",
  Stop: "session-end",
};

const command = hookMap[hook ?? ""];
if (!command) {
  process.exit(0);
}

const resolved = cliPath();
if (!resolved) {
  process.stderr.write(
    "graph-retention CLI not built. Run pnpm build, or set GRAPH_RETENTION_CLI / GRAPH_RETENTION_ROOT.\n",
  );
  process.exit(0);
}

let stdin = "";
if (!process.stdin.isTTY) {
  stdin = await new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => {
      data += c;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

const result = spawnSync(process.execPath, [resolved, command], {
  input: stdin,
  encoding: "utf8",
  env: {
    ...process.env,
    GRAPH_RETENTION_CWD: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  },
});

if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.status !== 0 && result.status !== null) {
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status);
}
