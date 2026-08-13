import type { DetailLevel, GraphNode, SearchResult } from "./types.js";

const COMPACT_MAX = 50;
const SUMMARY_MAX = 150;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function truncate(text: string, max: number): string {
  if (text.length <= max) {
    return text;
  }
  return `${text.slice(0, max - 3)}...`;
}

export function formatNodeDetail(
  node: GraphNode,
  level: DetailLevel = "compact",
  childCount = 0,
): string {
  const suffix = childCount > 0 ? ` (${childCount} children)` : "";
  switch (level) {
    case "full":
      return JSON.stringify(
        {
          id: node.id,
          type: node.type,
          label: node.label,
          content: node.content,
          metadata: node.metadata,
          zone: node.zone,
          decayScore: node.decayScore,
          importance: node.importance,
          pinned: node.pinned,
          childCount,
        },
        null,
        2,
      );
    case "summary":
      return truncate(
        `[${node.type}] ${node.label}: ${contentSummary(node)}${suffix}`,
        SUMMARY_MAX,
      );
    case "compact":
    default: {
      const budget = Math.max(10, COMPACT_MAX - suffix.length);
      return `${truncate(`[${node.type}] ${node.label}`, budget)}${suffix}`;
    }
  }
}

function contentSummary(node: GraphNode): string {
  const text =
    typeof node.content.text === "string"
      ? node.content.text
      : typeof node.content.rationale === "string"
        ? node.content.rationale
        : typeof node.content.path === "string"
          ? node.content.path
          : "";
  return text || node.label;
}

export function estimateDetailTokens(node: GraphNode, level: DetailLevel): number {
  return estimateTokens(formatNodeDetail(node, level));
}

function isSearchResult(item: GraphNode | SearchResult): item is SearchResult {
  return "matchSource" in item && "node" in item;
}

export function buildSurfaceContext(
  items: Array<GraphNode | SearchResult>,
  level: DetailLevel = "compact",
): string {
  if (items.length === 0) {
    return "";
  }

  const results: SearchResult[] = items.map((item) =>
    isSearchResult(item)
      ? item
      : {
          node: item,
          score: 0,
          matchSource: "surface" as const,
          detail: formatNodeDetail(item, level),
        },
  );

  const hasBands = results.some(
    (r) =>
      r.matchSource === "sink" ||
      r.matchSource === "window" ||
      r.matchSource === "block",
  );
  if (!hasBands) {
    const lines = results.map((r) => `- ${r.detail}`);
    return `Relevant graph memory:\n${lines.join("\n")}`;
  }

  const parts = ["Relevant graph memory:"];
  const bands: Array<[string, SearchResult["matchSource"]]> = [
    ["Pinned", "sink"],
    ["Recent", "window"],
    ["Compressed", "block"],
  ];
  for (const [title, source] of bands) {
    const band = results.filter((r) => r.matchSource === source);
    if (band.length === 0) {
      continue;
    }
    parts.push(`${title}:`);
    for (const r of band) {
      parts.push(`- ${r.detail}`);
    }
  }
  const rest = results.filter(
    (r) =>
      r.matchSource !== "sink" &&
      r.matchSource !== "window" &&
      r.matchSource !== "block",
  );
  for (const r of rest) {
    parts.push(`- ${r.detail}`);
  }
  return parts.join("\n");
}
