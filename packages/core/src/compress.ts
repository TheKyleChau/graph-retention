import type { GraphNode, NodeType, RetentionConfig } from "./types.js";

export const COMPRESSIBLE_TYPES: readonly NodeType[] = [
  "insight",
  "file",
  "symbol",
  "task",
];

export function isCompressible(node: GraphNode): boolean {
  return (
    node.zone === "active" &&
    !node.pinned &&
    COMPRESSIBLE_TYPES.includes(node.type)
  );
}

export function isSinkNode(node: GraphNode): boolean {
  if (node.zone !== "active") {
    return false;
  }
  return node.pinned || node.type === "preference";
}

export function compressionWindows<T>(
  items: T[],
  blockSize: number,
  overlap: number,
): T[][] {
  if (blockSize <= 0 || items.length < blockSize) {
    return [];
  }
  const step = Math.max(1, blockSize - Math.max(0, overlap));
  const windows: T[][] = [];
  for (let i = 0; i + blockSize <= items.length; i += step) {
    windows.push(items.slice(i, i + blockSize));
  }
  return windows;
}

export function sourceSnippet(node: GraphNode): string {
  const extra =
    typeof node.content.text === "string"
      ? node.content.text
      : typeof node.content.rationale === "string"
        ? node.content.rationale
        : typeof node.content.path === "string"
          ? node.content.path
          : "";
  return extra && extra !== node.label ? `${node.label}: ${extra}` : node.label;
}

export function weightedBlockSummary(sources: GraphNode[]): {
  label: string;
  text: string;
  importance: number;
} {
  const raw = sources.map((n) => Math.max(0.01, n.importance * n.decayScore));
  const maxW = Math.max(...raw);
  const exps = raw.map((w) => Math.exp((w / maxW) * 3));
  const sumExp = exps.reduce((a, b) => a + b, 0);
  const ranked = sources
    .map((n, i) => ({ n, w: exps[i]! / sumExp }))
    .sort((a, b) => b.w - a.w);

  const label = ranked
    .slice(0, 3)
    .map((r) => r.n.label)
    .join(" + ")
    .slice(0, 200);
  const text = ranked.map((r) => sourceSnippet(r.n)).join("; ");
  const importance = Math.min(
    1,
    ranked.reduce((sum, r) => sum + r.n.importance * r.w, 0),
  );
  return { label, text, importance };
}

export function eligibleForCompression(
  nodes: GraphNode[],
  alreadyCompressedIds: Set<string>,
  config: Pick<RetentionConfig, "windowSize">,
): GraphNode[] {
  const eligible = nodes
    .filter((n) => isCompressible(n) && !alreadyCompressedIds.has(n.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  if (eligible.length <= config.windowSize) {
    return [];
  }
  return eligible.slice(0, eligible.length - config.windowSize);
}
