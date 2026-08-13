import type { GraphNode, RetentionConfig } from "./types.js";
import { DEFAULT_RETENTION_CONFIG } from "./types.js";

const MS_PER_DAY = 86_400_000;

export function computeRecencyBoost(
  lastAccessed: string,
  halfLifeDays: number = DEFAULT_RETENTION_CONFIG.recencyHalfLifeDays,
  now: Date = new Date(),
): number {
  const last = new Date(lastAccessed).getTime();
  const daysSince = Math.max(0, (now.getTime() - last) / MS_PER_DAY);
  return Math.pow(0.5, daysSince / halfLifeDays);
}

export function computeAccessBoost(accessCount: number): number {
  return 1 + Math.log1p(accessCount) * 0.3;
}

export function computeDecayScore(
  node: Pick<GraphNode, "importance" | "lastAccessed" | "accessCount">,
  config: RetentionConfig = DEFAULT_RETENTION_CONFIG,
  now: Date = new Date(),
): number {
  const recency = computeRecencyBoost(node.lastAccessed, config.recencyHalfLifeDays, now);
  const access = computeAccessBoost(node.accessCount);
  return Math.min(1, node.importance * recency * access);
}

export function shouldArchive(
  node: GraphNode,
  config: RetentionConfig = DEFAULT_RETENTION_CONFIG,
  now: Date = new Date(),
): boolean {
  if (node.zone !== "active" || node.pinned) {
    return false;
  }
  const decay = computeDecayScore(node, config, now);
  const inactiveDays =
    (now.getTime() - new Date(node.lastAccessed).getTime()) / MS_PER_DAY;
  return decay < config.decayThreshold || inactiveDays > config.archiveInactiveDays;
}

export function shouldPurge(
  node: GraphNode,
  config: RetentionConfig = DEFAULT_RETENTION_CONFIG,
  now: Date = new Date(),
): boolean {
  if (node.zone !== "archived") {
    return false;
  }
  const archivedDays =
    (now.getTime() - new Date(node.lastAccessed).getTime()) / MS_PER_DAY;
  return (
    archivedDays > config.purgeArchivedDays &&
    node.importance < config.purgeImportanceThreshold
  );
}

export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(normalizeText(a).split(" ").filter(Boolean));
  const setB = new Set(normalizeText(b).split(" ").filter(Boolean));
  if (setA.size === 0 && setB.size === 0) {
    return 1;
  }
  if (setA.size === 0 || setB.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of setA) {
    if (setB.has(token)) {
      intersection++;
    }
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function contentToSearchText(content: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const value of Object.values(content)) {
    if (typeof value === "string") {
      parts.push(value);
    } else if (value != null) {
      parts.push(JSON.stringify(value));
    }
  }
  return parts.join(" ");
}
