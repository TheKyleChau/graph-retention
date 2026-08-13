#!/usr/bin/env node
import {
  AGENT_INSTRUCTIONS,
  GraphEngine,
  buildSurfaceContext,
} from "@graph-retention/core";

const [, , command, ...rest] = process.argv;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) {
      resolve("");
      return;
    }
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      data += chunk;
    });
    process.stdin.on("end", () => resolve(data));
  });
}

function output(data: unknown): void {
  process.stdout.write(JSON.stringify(data));
}

async function sessionStart(): Promise<void> {
  const engine = new GraphEngine({
    dbPath: process.env.GRAPH_RETENTION_DB,
    cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  });

  const session = engine.writeNode({
    type: "session",
    label: `Session ${new Date().toISOString()}`,
    content: { startedAt: new Date().toISOString() },
    metadata: { hook: "sessionStart" },
  });

  const surface = engine.surface(5, {}, "compact");
  const memory = buildSurfaceContext(surface, "compact");
  const context = [AGENT_INSTRUCTIONS.trim(), memory].filter(Boolean).join("\n");

  engine.close();
  output({
    sessionId: session.id,
    context,
    additionalContext: context || undefined,
  });
}

async function sessionEnd(): Promise<void> {
  const stdin = await readStdin();
  let payload: Record<string, unknown> = {};
  if (stdin.trim()) {
    try {
      payload = JSON.parse(stdin) as Record<string, unknown>;
    } catch {
      payload = { raw: stdin };
    }
  }

  const engine = new GraphEngine({
    dbPath: process.env.GRAPH_RETENTION_DB,
    cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  });

  const summary =
    typeof payload.summary === "string"
      ? payload.summary
      : typeof payload.conversation_id === "string"
        ? `Session ended (${payload.conversation_id})`
        : "Session ended";

  const insight = engine.writeNode({
    type: "insight",
    label: summary.slice(0, 200),
    content: { text: summary, hookPayload: payload },
    metadata: { hook: "sessionEnd" },
    importance: 0.6,
  });

  const preview = engine.previewRetention();
  engine.close();

  output({
    insightId: insight.id,
    retentionPreview: {
      toArchive: preview.toArchive.length,
      toPurge: preview.toPurge.length,
      toConsolidate: preview.toConsolidate.length,
    },
  });
}

async function observeFileEdit(): Promise<void> {
  const stdin = await readStdin();
  let payload: Record<string, unknown> = {};
  if (stdin.trim()) {
    try {
      payload = JSON.parse(stdin) as Record<string, unknown>;
    } catch {
      return;
    }
  }

  const filePath =
    typeof payload.file_path === "string"
      ? payload.file_path
      : typeof payload.path === "string"
        ? payload.path
        : null;

  if (!filePath) {
    return;
  }

  const engine = new GraphEngine({
    dbPath: process.env.GRAPH_RETENTION_DB,
    cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  });

  const node = engine.observe({
    type: "file",
    label: filePath,
    content: { path: filePath },
    metadata: { hook: "afterFileEdit" },
  });

  engine.close();
  output({ nodeId: node.id, path: filePath });
}

async function preCompact(): Promise<void> {
  const engine = new GraphEngine({
    dbPath: process.env.GRAPH_RETENTION_DB,
    cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  });

  const node = engine.writeNode({
    type: "insight",
    label: `Pre-compact checkpoint ${new Date().toISOString()}`,
    content: {
      text: "Context compaction imminent: checkpoint saved",
      timestamp: new Date().toISOString(),
    },
    metadata: { hook: "preCompact" },
    importance: 0.7,
  });

  engine.close();
  output({ checkpointId: node.id });
}

async function surface(): Promise<void> {
  const limit = rest[0] ? Number.parseInt(rest[0], 10) : 10;
  const engine = new GraphEngine({
    dbPath: process.env.GRAPH_RETENTION_DB,
    cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  });

  const results = engine.surface(limit, {}, "compact");
  const context = buildSurfaceContext(results, "compact");

  engine.close();
  output({ context, results });
}

async function stats(): Promise<void> {
  const engine = new GraphEngine({
    dbPath: process.env.GRAPH_RETENTION_DB,
    cwd: process.env.GRAPH_RETENTION_CWD ?? process.cwd(),
  });
  const stats = engine.getStats();
  engine.close();
  output(stats);
}

async function main(): Promise<void> {
  switch (command) {
    case "session-start":
      await sessionStart();
      break;
    case "session-end":
      await sessionEnd();
      break;
    case "observe-file-edit":
      await observeFileEdit();
      break;
    case "pre-compact":
      await preCompact();
      break;
    case "surface":
      await surface();
      break;
    case "stats":
      await stats();
      break;
    default:
      console.error(
        "Usage: graph-retention <session-start|session-end|observe-file-edit|pre-compact|surface|stats>",
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
