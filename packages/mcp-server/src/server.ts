import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  AGENT_INSTRUCTIONS,
  DetailLevelSchema,
  EdgeRelationSchema,
  formatNodeDetail,
  GraphEngine,
  NodeTypeSchema,
  ZoneSchema,
} from "@graph-retention/core";
import { z } from "zod";

function jsonText(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function toolError(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return jsonText({ error: message });
}

export const MCP_TOOL_NAMES = [
  "graph_write",
  "graph_read",
  "graph_link",
  "graph_search",
  "graph_expand",
  "graph_surface",
  "graph_observe",
  "retention_preview",
  "retention_run",
  "retention_restore",
  "graph_stats",
  "graph_export",
] as const;

export function createMcpServer(engine: GraphEngine): McpServer {
  const server = new McpServer(
    {
      name: "graph-retention",
      version: "0.1.0",
    },
    { instructions: AGENT_INSTRUCTIONS },
  );

  server.tool(
    "graph_write",
    "Upsert a durable graph node. Omit importance (never pass 1). Set parentId to hang this node under a session or decision. Set pinned true only for lasting user preferences.",
    {
      id: z.string().optional(),
      type: NodeTypeSchema.describe(
        "file | symbol | dependency | decision | preference | task | insight | session | block",
      ),
      label: z.string().describe("Short human label"),
      content: z.record(z.unknown()).optional().describe("Small payload; keep short"),
      metadata: z.record(z.unknown()).optional(),
      importance: z
        .number()
        .min(0)
        .max(1)
        .optional()
        .describe("Omit. Do not pass 1. Clamped to a type default unless pinned is true"),
      pinned: z
        .boolean()
        .optional()
        .describe("True only for lasting user preferences"),
      parentId: z
        .string()
        .optional()
        .describe("Parent node id. Creates parent_of. Prefer current session or a decision"),
      edges: z
        .array(
          z.object({
            sourceId: z.string(),
            targetId: z.string(),
            relation: EdgeRelationSchema,
            weight: z.number().optional().describe("Omit. Unused for ranking."),
          }),
        )
        .optional()
        .describe("Optional extra edges: applies_to, supersedes, relates_to, decided_in, extracted_from."),
    },
    async (args) => {
      try {
        const node = engine.writeNode(
          {
            id: args.id,
            type: args.type,
            label: args.label,
            content: args.content,
            metadata: args.metadata,
            importance: args.importance,
            pinned: args.pinned,
            parentId: args.parentId,
          },
          args.edges,
        );
        return jsonText(node);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "graph_read",
    "Fetch one node by id. Records access by default (boosts decay). Prefer graph_surface or graph_search first.",
    { id: z.string(), recordAccess: z.boolean().optional() },
    async (args) => {
      const node = engine.readNode(args.id, args.recordAccess ?? true);
      if (!node) {
        return jsonText({ error: "Node not found", id: args.id });
      }
      return jsonText(node);
    },
  );

  server.tool(
    "graph_link",
    "Create or update an edge. Prefer parentId on graph_write for parent_of. Use applies_to, supersedes, relates_to, decided_in, extracted_from for cross-links. Omit weight.",
    {
      sourceId: z.string(),
      targetId: z.string(),
      relation: EdgeRelationSchema,
      weight: z.number().optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    async (args) => {
      try {
        const edge = engine.link(args);
        return jsonText(edge);
      } catch (err) {
        return toolError(err);
      }
    },
  );

  server.tool(
    "graph_search",
    "Search this working directory only. FTS then expand neighbors. detailLevel compact by default. Use full only for the top 1-3 hits. Prefer graph_surface when you do not have a specific query.",
    {
      query: z.string(),
      nodeType: NodeTypeSchema.optional(),
      zone: ZoneSchema.optional(),
      since: z.string().optional(),
      depth: z.number().int().min(0).max(3).optional(),
      detailLevel: DetailLevelSchema.optional(),
      limit: z.number().int().min(1).max(100).optional(),
    },
    async (args) => {
      const results = engine.search(
        args.query,
        {
          nodeType: args.nodeType,
          zone: args.zone,
          since: args.since,
        },
        args.depth ?? 1,
        args.detailLevel ?? "compact",
        args.limit ?? 20,
      );
      const totalTokens = results.reduce(
        (sum, r) => sum + Math.ceil(r.detail.length / 4),
        0,
      );
      return jsonText({
        results,
        totalTokens,
        count: results.length,
        projectId: engine.getProjectId(),
        cwd: engine.getCwd(),
      });
    },
  );

  server.tool(
    "graph_expand",
    "Walk children from a node id (parent_of first), compact by default, cap 20. Call when graph_surface shows (N children). Do not request full unless you need one node's content.",
    {
      nodeId: z.string(),
      depth: z.number().int().min(1).max(5).optional(),
      detailLevel: DetailLevelSchema.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    },
    async (args) => {
      const detailLevel = args.detailLevel ?? "compact";
      const nodes = engine.expand(args.nodeId, args.depth ?? 1, args.limit ?? 20);
      return jsonText({
        results: nodes.map((node) => {
          const childCount = engine.childCount(node.id);
          return {
            id: node.id,
            type: node.type,
            childCount,
            detail: formatNodeDetail(node, detailLevel, childCount),
          };
        }),
        count: nodes.length,
        projectId: engine.getProjectId(),
        cwd: engine.getCwd(),
      });
    },
  );

  server.tool(
    "graph_surface",
    "Recall compact roots for this working directory only: Pinned / Recent / Compressed. Call at session start and when switching tasks. Expand a parent to see children. Do not dump the graph.",
    {
      limit: z.number().int().min(1).max(50).optional(),
      nodeType: NodeTypeSchema.optional(),
      detailLevel: DetailLevelSchema.optional(),
    },
    async (args) => {
      const results = engine.surface(
        args.limit ?? 10,
        {
          nodeType: args.nodeType,
        },
        args.detailLevel ?? "compact",
      );
      return jsonText({
        results,
        count: results.length,
        projectId: engine.getProjectId(),
        cwd: engine.getCwd(),
      });
    },
  );

  server.tool(
    "graph_observe",
    "Lightweight file-edit breadcrumb (importance 0.3). Do not use for decisions, preferences, tasks, or insights. Use graph_write for those.",
    {
      type: NodeTypeSchema,
      label: z.string(),
      content: z.record(z.unknown()).optional(),
      metadata: z.record(z.unknown()).optional(),
    },
    async (args) => {
      const node = engine.observe({
        type: args.type,
        label: args.label,
        content: args.content,
        metadata: args.metadata,
      });
      return jsonText(node);
    },
  );

  server.tool(
    "retention_preview",
    "Dry-run archive, purge, consolidate, and compress. If any list is non-empty, call retention_run. Do this at session end without waiting for the user.",
    {},
    async () => {
      const preview = engine.previewRetention();
      return jsonText({
        toArchive: preview.toArchive.map((n) => ({
          id: n.id,
          label: n.label,
          type: n.type,
        })),
        toPurge: preview.toPurge.map((n) => ({
          id: n.id,
          label: n.label,
          type: n.type,
        })),
        toConsolidate: preview.toConsolidate.map((g) => ({
          canonical: { id: g.canonical.id, label: g.canonical.label },
          duplicates: g.duplicates.map((d) => ({ id: d.id, label: d.label })),
        })),
        toCompress: preview.toCompress.map((w) => ({
          sourceIds: w.sources.map((s) => s.id),
          labels: w.sources.map((s) => s.label),
        })),
      });
    },
  );

  server.tool(
    "retention_run",
    "Apply archive, purge, consolidate, compress. Call after retention_preview when there is work, or when graph_stats.pendingCompressWindows > 0. Writes a retention_run insight. Do not dump archived sources afterward.",
    { dryRun: z.boolean().optional() },
    async (args) => {
      const result = engine.runRetention(args.dryRun ?? false);
      return jsonText(result);
    },
  );

  server.tool(
    "retention_restore",
    "Restore one archived node to active. Use after the user asks to recover a specific fact, not to undo a retention run wholesale.",
    { id: z.string() },
    async (args) => {
      const node = engine.restoreNode(args.id);
      if (!node) {
        return jsonText({ error: "Node not found or not archived", id: args.id });
      }
      return jsonText(node);
    },
  );

  server.tool(
    "graph_stats",
    "Graph health: counts by type/zone, dbPath, pendingCompressWindows. If pendingCompressWindows > 0, call retention_preview then retention_run.",
    {},
    async () => jsonText(engine.getStats()),
  );

  server.tool(
    "graph_export",
    "JSON backup of nodes and edges. Do not inject the export into the prompt; write it only when the user asks to backup.",
    {},
    async () => jsonText(engine.exportJson()),
  );

  return server;
}
