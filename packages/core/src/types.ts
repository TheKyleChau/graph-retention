import { z } from "zod";

export const NodeTypeSchema = z.enum([
  "file",
  "symbol",
  "dependency",
  "decision",
  "preference",
  "task",
  "insight",
  "session",
  "block",
]);

export const EdgeRelationSchema = z.enum([
  "depends_on",
  "modified_in",
  "decided_in",
  "applies_to",
  "relates_to",
  "supersedes",
  "extracted_from",
  "parent_of",
]);

export const ZoneSchema = z.enum(["active", "archived", "purged"]);

export const DetailLevelSchema = z.enum(["compact", "summary", "full"]);

export type NodeType = z.infer<typeof NodeTypeSchema>;
export type EdgeRelation = z.infer<typeof EdgeRelationSchema>;
export type Zone = z.infer<typeof ZoneSchema>;
export type DetailLevel = z.infer<typeof DetailLevelSchema>;

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  content: Record<string, unknown>;
  metadata: Record<string, unknown>;
  projectId: string | null;
  gitBranch: string | null;
  createdAt: string;
  lastAccessed: string;
  accessCount: number;
  importance: number;
  decayScore: number;
  zone: Zone;
  pinned: boolean;
}

export interface GraphEdge {
  id: string;
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight: number;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface RetentionConfig {
  archiveInactiveDays: number;
  purgeArchivedDays: number;
  decayThreshold: number;
  purgeImportanceThreshold: number;
  recencyHalfLifeDays: number;
  consolidationThreshold: number;
  windowSize: number;
  blockSize: number;
  blockOverlap: number;
  surfaceSinks: number;
  surfaceWindow: number;
  surfaceBlocks: number;
  pinImportance: number;
}

export const DEFAULT_RETENTION_CONFIG: RetentionConfig = {
  archiveInactiveDays: 30,
  purgeArchivedDays: 180,
  decayThreshold: 0.15,
  purgeImportanceThreshold: 0.3,
  recencyHalfLifeDays: 14,
  consolidationThreshold: 0.85,
  windowSize: 12,
  blockSize: 8,
  blockOverlap: 2,
  surfaceSinks: 4,
  surfaceWindow: 8,
  surfaceBlocks: 5,
  pinImportance: 0.85,
};

export interface SearchFilters {
  nodeType?: NodeType;
  projectId?: string;
  zone?: Zone;
  since?: string;
}

export interface SearchResult {
  node: GraphNode;
  score: number;
  matchSource: "fts" | "expansion" | "surface" | "sink" | "window" | "block";
  detail: string;
}

export interface RetentionPreview {
  toArchive: GraphNode[];
  toPurge: GraphNode[];
  toConsolidate: Array<{ canonical: GraphNode; duplicates: GraphNode[] }>;
  toCompress: Array<{ sources: GraphNode[] }>;
}

export interface RetentionRunResult {
  archived: number;
  purged: number;
  consolidated: number;
  compressed: number;
  runId: string;
  node: GraphNode | null;
}

export interface GraphStats {
  totalNodes: number;
  totalEdges: number;
  byType: Record<string, number>;
  byZone: Record<string, number>;
  dbPath: string;
  projectId: string | null;
  cwd: string;
  pendingCompressWindows: number;
}

export interface WriteNodeInput {
  id?: string;
  type: NodeType;
  label: string;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  projectId?: string | null;
  importance?: number;
  pinned?: boolean;
  parentId?: string;
}

export interface LinkInput {
  sourceId: string;
  targetId: string;
  relation: EdgeRelation;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface ObserveInput {
  type: NodeType;
  label: string;
  content?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  projectId?: string | null;
}
