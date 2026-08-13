import type { GraphNode, NodeType, WriteNodeInput } from "./types.js";

export function defaultImportance(type: NodeType): number {
  switch (type) {
    case "preference":
      return 0.9;
    case "decision":
      return 0.7;
    case "task":
      return 0.6;
    case "insight":
    case "session":
      return 0.5;
    case "file":
    case "symbol":
    case "dependency":
      return 0.4;
    case "block":
      return 0.5;
  }
}

export function resolveImportance(
  input: Pick<WriteNodeInput, "type" | "importance" | "pinned">,
  existing: GraphNode | null,
  pinImportance: number,
): number {
  if (input.type === "block") {
    return input.importance ?? existing?.importance ?? defaultImportance("block");
  }
  if (input.importance === undefined) {
    return existing?.importance ?? defaultImportance(input.type);
  }
  if (input.importance >= pinImportance && input.pinned !== true) {
    return defaultImportance(input.type);
  }
  return input.importance;
}

export function resolvePinned(
  input: Pick<WriteNodeInput, "type" | "pinned">,
  existing: GraphNode | null,
): boolean {
  if (input.pinned !== undefined) {
    return input.pinned;
  }
  if (existing) {
    return existing.pinned;
  }
  return input.type === "preference";
}
