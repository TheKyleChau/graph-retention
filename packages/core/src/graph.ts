import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import {
  computeDecayScore,
  contentToSearchText,
  jaccardSimilarity,
  shouldArchive,
  shouldPurge,
} from "./retention.js";
import {
  compressionWindows,
  eligibleForCompression,
  isSinkNode,
  weightedBlockSummary,
} from "./compress.js";
import { formatNodeDetail } from "./search.js";
import { resolveImportance, resolvePinned } from "./importance.js";
import { MIGRATIONS, SCHEMA_VERSION } from "./schema.js";
import { resolveDbPath, resolveScope } from "./scope.js";
import { loadRetentionConfig } from "./config.js";
import type {
  DetailLevel,
  GraphEdge,
  GraphNode,
  GraphStats,
  LinkInput,
  ObserveInput,
  RetentionConfig,
  RetentionPreview,
  RetentionRunResult,
  SearchFilters,
  SearchResult,
  WriteNodeInput,
  Zone,
} from "./types.js";

interface RowNode {
  id: string;
  type: string;
  label: string;
  content: string;
  metadata: string;
  project_id: string | null;
  git_branch: string | null;
  created_at: string;
  last_accessed: string;
  access_count: number;
  importance: number;
  decay_score: number;
  zone: string;
  pinned: number;
}

interface RowEdge {
  id: string;
  source_id: string;
  target_id: string;
  relation: string;
  weight: number;
  metadata: string;
  created_at: string;
}

export interface GraphEngineOptions {
  dbPath?: string;
  cwd?: string;
  retentionConfig?: Partial<RetentionConfig>;
}

export class GraphEngine {
  private db: Database.Database;
  private dbPath: string;
  private projectId: string | null;
  private cwd: string;
  private retentionConfig: RetentionConfig;

  constructor(options: GraphEngineOptions = {}) {
    const cwd = path.resolve(options.cwd ?? process.cwd());
    const scope = resolveScope(cwd, { create: !options.dbPath });
    this.cwd = cwd;
    this.dbPath = options.dbPath ?? scope.dbPath;
    this.projectId = scope.projectId;
    this.retentionConfig = loadRetentionConfig(
      this.dbPath,
      options.retentionConfig ?? {},
    );

    const dir = path.dirname(this.dbPath);
    if (dir && dir !== ".") {
      fs.mkdirSync(dir, { recursive: true });
    }

    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  getDbPath(): string {
    return this.dbPath;
  }

  getProjectId(): string | null {
    return this.projectId;
  }

  getCwd(): string {
    return this.cwd;
  }

  private projectKeys(): string[] {
    if (!this.projectId) {
      return [];
    }
    const keys = [this.projectId];
    const base = path.basename(this.projectId);
    if (base && base !== this.projectId) {
      keys.push(base);
    }
    return keys;
  }

  private inCurrentProject(node: GraphNode): boolean {
    const keys = this.projectKeys();
    if (keys.length === 0) {
      return true;
    }
    return node.projectId !== null && keys.includes(node.projectId);
  }

  private projectClause(column = "project_id"): { sql: string; params: string[] } {
    const keys = this.projectKeys();
    if (keys.length === 0) {
      return { sql: "1=1", params: [] };
    }
    const placeholders = keys.map(() => "?").join(", ");
    return { sql: `${column} IN (${placeholders})`, params: keys };
  }

  private migrate(): void {
    for (const sql of MIGRATIONS) {
      this.db.exec(sql);
    }
    const row = this.db
      .prepare("SELECT version FROM schema_version LIMIT 1")
      .get() as { version: number } | undefined;
    if (!row) {
      this.db
        .prepare("INSERT INTO schema_version (version) VALUES (?)")
        .run(SCHEMA_VERSION);
    } else if (row.version < SCHEMA_VERSION) {
      this.db
        .prepare("UPDATE schema_version SET version = ?")
        .run(SCHEMA_VERSION);
    }
    this.ensurePinnedColumn();
  }

  private ensurePinnedColumn(): void {
    const cols = this.db
      .prepare("PRAGMA table_info(nodes)")
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "pinned")) {
      this.db.exec(
        "ALTER TABLE nodes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0",
      );
    }
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_nodes_pinned ON nodes(pinned)");
  }

  private rowToNode(row: RowNode): GraphNode {
    return {
      id: row.id,
      type: row.type as GraphNode["type"],
      label: row.label,
      content: JSON.parse(row.content) as Record<string, unknown>,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      projectId: row.project_id,
      gitBranch: row.git_branch,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      accessCount: row.access_count,
      importance: row.importance,
      decayScore: row.decay_score,
      zone: row.zone as Zone,
      pinned: Boolean(row.pinned),
    };
  }

  private rowToEdge(row: RowEdge): GraphEdge {
    return {
      id: row.id,
      sourceId: row.source_id,
      targetId: row.target_id,
      relation: row.relation as GraphEdge["relation"],
      weight: row.weight,
      metadata: JSON.parse(row.metadata) as Record<string, unknown>,
      createdAt: row.created_at,
    };
  }

  private syncFts(node: GraphNode): void {
    const contentText = contentToSearchText(node.content);
    this.db
      .prepare("DELETE FROM nodes_fts WHERE node_id = ?")
      .run(node.id);
    this.db
      .prepare(
        "INSERT INTO nodes_fts (node_id, label, content_text) VALUES (?, ?, ?)",
      )
      .run(node.id, node.label, contentText);
  }

  writeNode(input: WriteNodeInput, edges: LinkInput[] = []): GraphNode {
    const now = new Date().toISOString();
    const id = input.id ?? uuidv4();
    const existing = this.readNode(id);

    if (input.parentId) {
      const parent = this.readNode(input.parentId);
      if (!parent) {
        throw new Error(`parentId not found: ${input.parentId}`);
      }
      if (this.wouldCreateParentCycle(input.parentId, id)) {
        throw new Error("parentId would create a cycle");
      }
    }

    const importance = resolveImportance(
      input,
      existing,
      this.retentionConfig.pinImportance,
    );
    const pinned = resolvePinned(input, existing);

    const node: GraphNode = {
      id,
      type: input.type,
      label: input.label,
      content: input.content ?? {},
      metadata: input.metadata ?? {},
      projectId: this.projectId,
      gitBranch: existing?.gitBranch ?? null,
      createdAt: existing?.createdAt ?? now,
      lastAccessed: now,
      accessCount: existing?.accessCount ?? 0,
      importance,
      decayScore: 0,
      zone: existing?.zone ?? "active",
      pinned,
    };
    node.decayScore = computeDecayScore(node, this.retentionConfig);

    if (existing) {
      this.db
        .prepare(
          `UPDATE nodes SET type=?, label=?, content=?, metadata=?, project_id=?,
           git_branch=?, last_accessed=?, importance=?, decay_score=?, zone=?, pinned=?
           WHERE id=?`,
        )
        .run(
          node.type,
          node.label,
          JSON.stringify(node.content),
          JSON.stringify(node.metadata),
          node.projectId,
          node.gitBranch,
          node.lastAccessed,
          node.importance,
          node.decayScore,
          node.zone,
          node.pinned ? 1 : 0,
          node.id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO nodes (id, type, label, content, metadata, project_id, git_branch,
           created_at, last_accessed, access_count, importance, decay_score, zone, pinned)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          node.id,
          node.type,
          node.label,
          JSON.stringify(node.content),
          JSON.stringify(node.metadata),
          node.projectId,
          node.gitBranch,
          node.createdAt,
          node.lastAccessed,
          node.accessCount,
          node.importance,
          node.decayScore,
          node.zone,
          node.pinned ? 1 : 0,
        );
    }

    this.syncFts(node);

    if (input.parentId) {
      this.link({
        sourceId: input.parentId,
        targetId: node.id,
        relation: "parent_of",
      });
    }

    for (const edge of edges) {
      this.link({
        ...edge,
        sourceId: edge.sourceId === "self" ? node.id : edge.sourceId,
        targetId: edge.targetId === "self" ? node.id : edge.targetId,
      });
    }

    return node;
  }

  observe(input: ObserveInput): GraphNode {
    return this.writeNode({
      type: input.type,
      label: input.label,
      content: input.content ?? {},
      metadata: { ...input.metadata, observed: true },
      importance: 0.3,
    });
  }

  readNode(id: string, recordAccess = false): GraphNode | null {
    const row = this.db
      .prepare("SELECT * FROM nodes WHERE id = ? AND zone != 'purged'")
      .get(id) as RowNode | undefined;
    if (!row) {
      return null;
    }
    const node = this.rowToNode(row);
    if (!this.inCurrentProject(node)) {
      return null;
    }
    if (recordAccess) {
      return this.recordAccess(node);
    }
    return node;
  }

  recordAccess(node: GraphNode): GraphNode {
    const now = new Date().toISOString();
    const accessCount = node.accessCount + 1;
    const updated: GraphNode = {
      ...node,
      lastAccessed: now,
      accessCount,
      decayScore: computeDecayScore(
        { ...node, lastAccessed: now, accessCount },
        this.retentionConfig,
      ),
    };
    this.db
      .prepare(
        "UPDATE nodes SET last_accessed=?, access_count=?, decay_score=? WHERE id=?",
      )
      .run(updated.lastAccessed, updated.accessCount, updated.decayScore, updated.id);
    this.db
      .prepare("INSERT INTO access_log (node_id, accessed_at) VALUES (?, ?)")
      .run(updated.id, now);
    return updated;
  }

  link(input: LinkInput): GraphEdge {
    if (input.relation === "parent_of") {
      const parent = this.readNode(input.sourceId);
      if (!parent) {
        throw new Error(`parent not found: ${input.sourceId}`);
      }
      const child = this.readNode(input.targetId);
      if (!child) {
        throw new Error(`child not found: ${input.targetId}`);
      }
      if (this.wouldCreateParentCycle(input.sourceId, input.targetId)) {
        throw new Error("parent_of would create a cycle");
      }
    }

    const now = new Date().toISOString();
    const existing = this.db
      .prepare(
        "SELECT id FROM edges WHERE source_id=? AND target_id=? AND relation=?",
      )
      .get(input.sourceId, input.targetId, input.relation) as
      | { id: string }
      | undefined;

    const id = existing?.id ?? uuidv4();
    if (existing) {
      this.db
        .prepare("UPDATE edges SET weight=?, metadata=? WHERE id=?")
        .run(
          input.weight ?? 1,
          JSON.stringify(input.metadata ?? {}),
          id,
        );
    } else {
      this.db
        .prepare(
          `INSERT INTO edges (id, source_id, target_id, relation, weight, metadata, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id,
          input.sourceId,
          input.targetId,
          input.relation,
          input.weight ?? 1,
          JSON.stringify(input.metadata ?? {}),
          now,
        );
    }

    const row = this.db.prepare("SELECT * FROM edges WHERE id = ?").get(id) as RowEdge;
    return this.rowToEdge(row);
  }

  childCount(id: string): number {
    const row = this.db
      .prepare(
        "SELECT COUNT(*) AS n FROM edges WHERE source_id = ? AND relation = 'parent_of'",
      )
      .get(id) as { n: number };
    return row.n;
  }

  parentId(id: string): string | null {
    const row = this.db
      .prepare(
        "SELECT source_id FROM edges WHERE target_id = ? AND relation = 'parent_of' LIMIT 1",
      )
      .get(id) as { source_id: string } | undefined;
    return row?.source_id ?? null;
  }

  isRoot(node: GraphNode | string): boolean {
    const id = typeof node === "string" ? node : node.id;
    return this.parentId(id) === null;
  }

  private wouldCreateParentCycle(parentId: string, childId: string): boolean {
    if (parentId === childId) {
      return true;
    }
    const seen = new Set<string>();
    let current: string | null = parentId;
    while (current) {
      if (current === childId) {
        return true;
      }
      if (seen.has(current)) {
        return true;
      }
      seen.add(current);
      current = this.parentId(current);
    }
    return false;
  }

  private formatNode(node: GraphNode, level: DetailLevel): string {
    return formatNodeDetail(node, level, this.childCount(node.id));
  }

  getEdges(nodeId: string, direction: "out" | "in" | "both" = "both"): GraphEdge[] {
    const edges: GraphEdge[] = [];
    if (direction === "out" || direction === "both") {
      const rows = this.db
        .prepare("SELECT * FROM edges WHERE source_id = ?")
        .all(nodeId) as RowEdge[];
      edges.push(...rows.map((r) => this.rowToEdge(r)));
    }
    if (direction === "in" || direction === "both") {
      const rows = this.db
        .prepare("SELECT * FROM edges WHERE target_id = ?")
        .all(nodeId) as RowEdge[];
      edges.push(...rows.map((r) => this.rowToEdge(r)));
    }
    return edges;
  }

  expand(nodeId: string, depth = 1, limit = 20): GraphNode[] {
    const visited = new Set<string>();
    const result: GraphNode[] = [];
    const queue: Array<{ id: string; d: number }> = [{ id: nodeId, d: 0 }];

    while (queue.length > 0 && result.length < limit) {
      const current = queue.shift()!;
      if (visited.has(current.id)) {
        continue;
      }
      visited.add(current.id);

      const node = this.readNode(current.id);
      if (!node) {
        continue;
      }
      if (current.d > 0) {
        result.push(node);
        if (result.length >= limit) {
          break;
        }
      }

      if (current.d >= depth) {
        continue;
      }

      const edges = this.getEdges(current.id).sort((a, b) => {
        const rank = (edge: GraphEdge) => {
          if (edge.relation === "parent_of" && edge.sourceId === current.id) {
            return 0;
          }
          if (edge.relation === "parent_of") {
            return 1;
          }
          return 2;
        };
        return rank(a) - rank(b);
      });

      for (const edge of edges) {
        const neighborId =
          edge.sourceId === current.id ? edge.targetId : edge.sourceId;
        if (!visited.has(neighborId)) {
          queue.push({ id: neighborId, d: current.d + 1 });
        }
      }
    }

    return result;
  }

  search(
    query: string,
    filters: SearchFilters = {},
    depth = 1,
    detailLevel: DetailLevel = "compact",
    limit = 20,
  ): SearchResult[] {
    const results: SearchResult[] = [];
    const seen = new Set<string>();

    let ftsQuery = query.trim();
    if (ftsQuery) {
      ftsQuery = ftsQuery
        .split(/\s+/)
        .filter(Boolean)
        .map((t) => `"${t.replace(/"/g, "")}"`)
        .join(" OR ");
    }

    if (ftsQuery) {
      const ftsRows = this.db
        .prepare(
          `SELECT node_id, bm25(nodes_fts) AS score FROM nodes_fts
           WHERE nodes_fts MATCH ?
           ORDER BY score
           LIMIT ?`,
        )
        .all(ftsQuery, limit * 2) as Array<{ node_id: string; score: number }>;

      for (const row of ftsRows) {
        if (seen.has(row.node_id)) {
          continue;
        }
        const node = this.readNode(row.node_id);
        if (!node || !this.matchesFilters(node, filters)) {
          continue;
        }
        seen.add(node.id);
        const accessed = this.recordAccess(node);
        results.push({
          node: accessed,
          score: Math.abs(row.score) * accessed.decayScore,
          matchSource: "fts",
          detail: this.formatNode(accessed, detailLevel),
        });
      }
    }

    if (depth > 0 && results.length > 0) {
      const seeds = results.slice(0, 5).map((r) => r.node.id);
      for (const seedId of seeds) {
        for (const expanded of this.expand(seedId, depth)) {
          if (seen.has(expanded.id) || !this.matchesFilters(expanded, filters)) {
            continue;
          }
          seen.add(expanded.id);
          const accessed = this.recordAccess(expanded);
          results.push({
            node: accessed,
            score: accessed.decayScore * 0.5,
            matchSource: "expansion",
            detail: this.formatNode(accessed, detailLevel),
          });
        }
      }
    }

    if (results.length === 0 && !query.trim()) {
      return this.surface(limit, filters, detailLevel).map((r) => ({
        ...r,
        matchSource: "surface" as const,
      }));
    }

    return results
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  surface(
    limit = 10,
    filters: SearchFilters = {},
    detailLevel: DetailLevel = "compact",
  ): SearchResult[] {
    if (filters.nodeType) {
      return this.surfaceFlat(limit, filters, detailLevel);
    }

    const { sql: projectSql, params: projectParams } = this.projectClause();
    const active = (
      this.db
        .prepare(
          `SELECT * FROM nodes WHERE zone = 'active' AND ${projectSql}`,
        )
        .all(...projectParams) as RowNode[]
    )
      .map((r) => this.rowToNode(r))
      .filter((n) => this.matchesFilters(n, filters));

    const parentOfChild = new Map<string, string>();
    const parentRows = this.db
      .prepare(
        "SELECT source_id, target_id FROM edges WHERE relation = 'parent_of'",
      )
      .all() as Array<{ source_id: string; target_id: string }>;
    for (const row of parentRows) {
      parentOfChild.set(row.target_id, row.source_id);
    }

    const isRootNode = (n: GraphNode) => !parentOfChild.has(n.id);
    const pickPreferRoots = (
      candidates: GraphNode[],
      cap: number,
      already: Set<string>,
    ): GraphNode[] => {
      const picked: GraphNode[] = [];
      const tryAdd = (n: GraphNode) => {
        if (picked.length >= cap) {
          return;
        }
        if (already.has(n.id) || picked.some((p) => p.id === n.id)) {
          return;
        }
        const parent = parentOfChild.get(n.id);
        if (
          parent &&
          (already.has(parent) || picked.some((p) => p.id === parent))
        ) {
          return;
        }
        picked.push(n);
      };
      for (const n of candidates.filter(isRootNode)) {
        tryAdd(n);
      }
      for (const n of candidates) {
        tryAdd(n);
      }
      return picked;
    };

    const sinkCap = this.retentionConfig.surfaceSinks;
    const windowCap = this.retentionConfig.surfaceWindow;
    const blockCap = this.retentionConfig.surfaceBlocks;

    const sinkCandidates = active
      .filter((n) => isSinkNode(n))
      .sort((a, b) => b.importance - a.importance || b.decayScore - a.decayScore);
    const sinks = pickPreferRoots(sinkCandidates, sinkCap, new Set());
    const sinkIds = new Set(sinks.map((n) => n.id));

    const windowCandidates = active
      .filter((n) => n.type !== "block" && !sinkIds.has(n.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const windowNodes = pickPreferRoots(windowCandidates, windowCap, sinkIds);

    const blocks = active
      .filter((n) => n.type === "block")
      .sort((a, b) => b.decayScore - a.decayScore || b.importance - a.importance)
      .slice(0, blockCap);

    const results: SearchResult[] = [
      ...sinks.map((node) => ({
        node,
        score: node.importance,
        matchSource: "sink" as const,
        detail: this.formatNode(node, detailLevel),
      })),
      ...windowNodes.map((node) => ({
        node,
        score: node.decayScore,
        matchSource: "window" as const,
        detail: this.formatNode(node, detailLevel),
      })),
      ...blocks.map((node) => ({
        node,
        score: node.decayScore,
        matchSource: "block" as const,
        detail: this.formatNode(node, "summary"),
      })),
    ];

    const budget = Math.max(limit, sinkCap + windowCap + blockCap);
    return results.slice(0, budget);
  }

  private surfaceFlat(
    limit: number,
    filters: SearchFilters,
    detailLevel: DetailLevel,
  ): SearchResult[] {
    let sql = `SELECT * FROM nodes WHERE zone = 'active' AND ${this.projectClause().sql}`;
    const params: unknown[] = [...this.projectClause().params];

    if (filters.nodeType) {
      sql += " AND type = ?";
      params.push(filters.nodeType);
    }

    sql += " ORDER BY decay_score DESC, importance DESC LIMIT ?";
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as RowNode[];
    return rows.map((row) => {
      const node = this.rowToNode(row);
      return {
        node,
        score: node.decayScore,
        matchSource: "surface" as const,
        detail: this.formatNode(node, detailLevel),
      };
    });
  }

  private matchesFilters(node: GraphNode, filters: SearchFilters): boolean {
    if (!this.inCurrentProject(node)) {
      return false;
    }
    if (filters.nodeType && node.type !== filters.nodeType) {
      return false;
    }
    if (filters.zone && node.zone !== filters.zone) {
      return false;
    }
    if (filters.since && node.createdAt < filters.since) {
      return false;
    }
    return true;
  }

  previewRetention(): RetentionPreview {
    const { sql: projectSql, params: projectParams } = this.projectClause();
    const now = new Date();
    const activeNodes = this.db
      .prepare(`SELECT * FROM nodes WHERE zone = 'active' AND ${projectSql}`)
      .all(...projectParams) as RowNode[];
    const archivedNodes = this.db
      .prepare(`SELECT * FROM nodes WHERE zone = 'archived' AND ${projectSql}`)
      .all(...projectParams) as RowNode[];

    const toArchive = activeNodes
      .map((r) => this.rowToNode(r))
      .filter((n) => shouldArchive(n, this.retentionConfig, now));

    const toPurge = archivedNodes
      .map((r) => this.rowToNode(r))
      .filter((n) => shouldPurge(n, this.retentionConfig, now));

    const toConsolidate = this.findConsolidationCandidates();
    const toCompress = this.previewCompressionWindows();
    const compressIds = new Set(
      toCompress.flatMap((w) => w.sources.map((s) => s.id)),
    );

    return {
      toArchive: toArchive.filter((n) => !compressIds.has(n.id)),
      toPurge,
      toConsolidate,
      toCompress,
    };
  }

  private alreadyCompressedIds(): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT e.target_id AS id FROM edges e
         INNER JOIN nodes b ON b.id = e.source_id
         WHERE e.relation = 'extracted_from' AND b.type = 'block'`,
      )
      .all() as Array<{ id: string }>;
    return new Set(rows.map((r) => r.id));
  }

  private previewCompressionWindows(): Array<{ sources: GraphNode[] }> {
    const { sql: projectSql, params: projectParams } = this.projectClause();
    const active = (
      this.db
        .prepare(`SELECT * FROM nodes WHERE zone = 'active' AND ${projectSql}`)
        .all(...projectParams) as RowNode[]
    ).map((r) => this.rowToNode(r));
    const eligible = eligibleForCompression(
      active,
      this.alreadyCompressedIds(),
      this.retentionConfig,
    );
    return compressionWindows(
      eligible,
      this.retentionConfig.blockSize,
      this.retentionConfig.blockOverlap,
    ).map((sources) => ({ sources }));
  }

  private applyCompression(
    windows: Array<{ sources: GraphNode[] }>,
    now: string,
  ): number {
    let compressed = 0;
    const archivedSources = new Set<string>();
    for (const { sources } of windows) {
      if (sources.length === 0) {
        continue;
      }
      const summary = weightedBlockSummary(sources);
      const block = this.writeNode({
        type: "block",
        label: summary.label,
        content: {
          text: summary.text,
          sourceIds: sources.map((s) => s.id),
          compressedAt: now,
        },
        importance: summary.importance,
        projectId: this.projectId,
        metadata: { kind: "block", sourceCount: sources.length },
      });
      for (const source of sources) {
        this.link({
          sourceId: block.id,
          targetId: source.id,
          relation: "extracted_from",
        });
        if (!archivedSources.has(source.id)) {
          this.db
            .prepare("UPDATE nodes SET zone='archived' WHERE id=?")
            .run(source.id);
          archivedSources.add(source.id);
          compressed++;
        }
      }
    }
    return compressed;
  }

  private findConsolidationCandidates(): Array<{
    canonical: GraphNode;
    duplicates: GraphNode[];
  }> {
    const { sql: projectSql, params: projectParams } = this.projectClause();
    const rows = this.db
      .prepare(
        `SELECT * FROM nodes WHERE zone = 'active' AND type IN ('insight', 'decision', 'preference') AND ${projectSql}`,
      )
      .all(...projectParams) as RowNode[];
    const nodes = rows.map((r) => this.rowToNode(r));
    const groups: Array<{ canonical: GraphNode; duplicates: GraphNode[] }> = [];
    const used = new Set<string>();

    for (const node of nodes) {
      if (used.has(node.id)) {
        continue;
      }
      const duplicates: GraphNode[] = [];
      for (const other of nodes) {
        if (other.id === node.id || used.has(other.id)) {
          continue;
        }
        if (node.type !== other.type) {
          continue;
        }
        const sim = jaccardSimilarity(node.label, other.label);
        if (sim >= this.retentionConfig.consolidationThreshold) {
          duplicates.push(other);
          used.add(other.id);
        }
      }
      if (duplicates.length > 0) {
        used.add(node.id);
        groups.push({ canonical: node, duplicates });
      }
    }

    return groups;
  }

  runRetention(dryRun = false): RetentionRunResult {
    const preview = this.previewRetention();
    const runId = uuidv4();
    const now = new Date().toISOString();

    if (dryRun) {
      return {
        archived: preview.toArchive.length,
        purged: preview.toPurge.length,
        consolidated: preview.toConsolidate.reduce(
          (sum, g) => sum + g.duplicates.length,
          0,
        ),
        compressed: new Set(
          preview.toCompress.flatMap((w) => w.sources.map((s) => s.id)),
        ).size,
        runId,
        node: null,
      };
    }

    this.db
      .prepare(
        `INSERT INTO retention_runs (id, started_at, details) VALUES (?, ?, '{}')`,
      )
      .run(runId, now);

    let archived = 0;
    let purged = 0;
    let consolidated = 0;

    for (const group of preview.toConsolidate) {
      for (const dup of group.duplicates) {
        this.db
          .prepare("UPDATE edges SET source_id=? WHERE source_id=?")
          .run(group.canonical.id, dup.id);
        this.db
          .prepare("UPDATE edges SET target_id=? WHERE target_id=?")
          .run(group.canonical.id, dup.id);
        this.db.prepare("UPDATE nodes SET zone='purged' WHERE id=?").run(dup.id);
        this.db.prepare("DELETE FROM nodes_fts WHERE node_id = ?").run(dup.id);
        consolidated++;
      }
      const mergedImportance = Math.min(
        1,
        group.canonical.importance +
          group.duplicates.reduce((s, d) => s + d.importance * 0.1, 0),
      );
      this.db
        .prepare("UPDATE nodes SET importance=? WHERE id=?")
        .run(mergedImportance, group.canonical.id);
    }

    const compressed = this.applyCompression(preview.toCompress, now);

    for (const node of preview.toArchive) {
      const current = this.readNode(node.id);
      if (!current || current.zone !== "active" || current.pinned) {
        continue;
      }
      this.db
        .prepare(
          "UPDATE nodes SET zone='archived', last_accessed=? WHERE id=?",
        )
        .run(now, node.id);
      archived++;
    }

    for (const node of preview.toPurge) {
      this.db
        .prepare("UPDATE nodes SET zone='purged' WHERE id=?")
        .run(node.id);
      this.db.prepare("DELETE FROM nodes_fts WHERE node_id = ?").run(node.id);
      purged++;
    }

    this.db
      .prepare(
        `UPDATE retention_runs SET completed_at=?, archived_count=?, purged_count=?,
         consolidated_count=?, details=? WHERE id=?`,
      )
      .run(
        now,
        archived,
        purged,
        consolidated,
        JSON.stringify({ compressed }),
        runId,
      );

    const didWork = archived + purged + consolidated + compressed > 0;
    const node = didWork
      ? this.recordRetentionRunNode({
          runId,
          archived,
          purged,
          consolidated,
          compressed,
        })
      : null;

    return { archived, purged, consolidated, compressed, runId, node };
  }

  private recordRetentionRunNode(counts: {
    runId: string;
    archived: number;
    purged: number;
    consolidated: number;
    compressed: number;
  }): GraphNode {
    const node = this.writeNode({
      type: "insight",
      label: `Retention run: archived ${counts.archived}, compressed ${counts.compressed}, purged ${counts.purged}`,
      content: counts,
      metadata: { kind: "retention_run" },
      importance: 0.4,
    });
    const session = this.db
      .prepare(
        `SELECT * FROM nodes WHERE zone = 'active' AND type = 'session'
         ORDER BY created_at DESC LIMIT 1`,
      )
      .get() as RowNode | undefined;
    if (session) {
      this.link({
        sourceId: node.id,
        targetId: session.id,
        relation: "extracted_from",
      });
    }
    return this.readNode(node.id) ?? node;
  }

  restoreNode(id: string): GraphNode | null {
    const node = this.readNode(id);
    if (!node || node.zone !== "archived") {
      return null;
    }
    const now = new Date().toISOString();
    this.db
      .prepare(
        "UPDATE nodes SET zone='active', last_accessed=?, decay_score=? WHERE id=?",
      )
      .run(
        now,
        computeDecayScore(
          { ...node, lastAccessed: now },
          this.retentionConfig,
        ),
        id,
      );
    return this.readNode(id);
  }

  getStats(): GraphStats {
    const { sql: projectSql, params: projectParams } = this.projectClause();
    const { sql: edgeProjectSql } = this.projectClause("n.project_id");
    const totalNodes =
      (this.db
        .prepare(
          `SELECT COUNT(*) as c FROM nodes WHERE zone != 'purged' AND ${projectSql}`,
        )
        .get(...projectParams) as { c: number }).c;
    const totalEdges =
      (this.db
        .prepare(
          `SELECT COUNT(*) as c FROM edges e
           INNER JOIN nodes n ON n.id = e.source_id
           WHERE ${edgeProjectSql}`,
        )
        .get(...projectParams) as { c: number }).c;

    const typeRows = this.db
      .prepare(
        `SELECT type, COUNT(*) as c FROM nodes WHERE zone != 'purged' AND ${projectSql} GROUP BY type`,
      )
      .all(...projectParams) as Array<{ type: string; c: number }>;
    const zoneRows = this.db
      .prepare(
        `SELECT zone, COUNT(*) as c FROM nodes WHERE ${projectSql} GROUP BY zone`,
      )
      .all(...projectParams) as Array<{ zone: string; c: number }>;

    const byType: Record<string, number> = {};
    for (const row of typeRows) {
      byType[row.type] = row.c;
    }
    const byZone: Record<string, number> = {};
    for (const row of zoneRows) {
      byZone[row.zone] = row.c;
    }

    return {
      totalNodes,
      totalEdges,
      byType,
      byZone,
      dbPath: this.dbPath,
      projectId: this.projectId,
      cwd: this.cwd,
      pendingCompressWindows: this.previewCompressionWindows().length,
    };
  }

  exportJson(): { nodes: GraphNode[]; edges: GraphEdge[] } {
    const { sql: projectSql, params: projectParams } = this.projectClause();
    const nodeRows = this.db
      .prepare(`SELECT * FROM nodes WHERE zone != 'purged' AND ${projectSql}`)
      .all(...projectParams) as RowNode[];
    const nodes = nodeRows.map((r) => this.rowToNode(r));
    const ids = new Set(nodes.map((n) => n.id));
    const edgeRows = this.db.prepare("SELECT * FROM edges").all() as RowEdge[];
    return {
      nodes,
      edges: edgeRows
        .map((r) => this.rowToEdge(r))
        .filter((e) => ids.has(e.sourceId) && ids.has(e.targetId)),
    };
  }

  close(): void {
    this.db.close();
  }

  /** @internal Used by scripts/bench-retention.mjs */
  setLastAccessed(id: string, iso: string): void {
    this.db.prepare("UPDATE nodes SET last_accessed=? WHERE id=?").run(iso, id);
  }

  /** @internal Used by scripts/bench-retention.mjs */
  setCreatedAt(id: string, iso: string): void {
    this.db.prepare("UPDATE nodes SET created_at=? WHERE id=?").run(iso, id);
  }
}

export { resolveDbPath, resolveScope };
