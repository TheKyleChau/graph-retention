import fs from "node:fs";
import path from "node:path";
import type { RetentionConfig } from "./types.js";
import { DEFAULT_RETENTION_CONFIG } from "./types.js";

function readNumber(value: string | undefined): number | undefined {
  if (value === undefined || value === "") {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function fromEnv(): Partial<RetentionConfig> {
  const archiveInactiveDays = readNumber(process.env.GRAPH_RETENTION_ARCHIVE_DAYS);
  const purgeArchivedDays = readNumber(process.env.GRAPH_RETENTION_PURGE_DAYS);
  const decayThreshold = readNumber(process.env.GRAPH_RETENTION_DECAY_THRESHOLD);
  const purgeImportanceThreshold = readNumber(
    process.env.GRAPH_RETENTION_PURGE_IMPORTANCE,
  );
  const recencyHalfLifeDays = readNumber(process.env.GRAPH_RETENTION_HALF_LIFE_DAYS);
  const consolidationThreshold = readNumber(
    process.env.GRAPH_RETENTION_CONSOLIDATION_THRESHOLD,
  );
  const windowSize = readNumber(process.env.GRAPH_RETENTION_WINDOW_SIZE);
  const blockSize = readNumber(process.env.GRAPH_RETENTION_BLOCK_SIZE);
  const blockOverlap = readNumber(process.env.GRAPH_RETENTION_BLOCK_OVERLAP);
  const surfaceSinks = readNumber(process.env.GRAPH_RETENTION_SURFACE_SINKS);
  const surfaceWindow = readNumber(process.env.GRAPH_RETENTION_SURFACE_WINDOW);
  const surfaceBlocks = readNumber(process.env.GRAPH_RETENTION_SURFACE_BLOCKS);
  const pinImportance = readNumber(process.env.GRAPH_RETENTION_PIN_IMPORTANCE);

  return {
    ...(archiveInactiveDays !== undefined ? { archiveInactiveDays } : {}),
    ...(purgeArchivedDays !== undefined ? { purgeArchivedDays } : {}),
    ...(decayThreshold !== undefined ? { decayThreshold } : {}),
    ...(purgeImportanceThreshold !== undefined ? { purgeImportanceThreshold } : {}),
    ...(recencyHalfLifeDays !== undefined ? { recencyHalfLifeDays } : {}),
    ...(consolidationThreshold !== undefined ? { consolidationThreshold } : {}),
    ...(windowSize !== undefined ? { windowSize } : {}),
    ...(blockSize !== undefined ? { blockSize } : {}),
    ...(blockOverlap !== undefined ? { blockOverlap } : {}),
    ...(surfaceSinks !== undefined ? { surfaceSinks } : {}),
    ...(surfaceWindow !== undefined ? { surfaceWindow } : {}),
    ...(surfaceBlocks !== undefined ? { surfaceBlocks } : {}),
    ...(pinImportance !== undefined ? { pinImportance } : {}),
  };
}

function fromFile(dbPath: string): Partial<RetentionConfig> {
  const configPath = path.join(path.dirname(dbPath), "retention.config.json");
  if (!fs.existsSync(configPath)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(configPath, "utf8")) as Partial<RetentionConfig>;
  } catch {
    return {};
  }
}

export function loadRetentionConfig(
  dbPath: string,
  overrides: Partial<RetentionConfig> = {},
): RetentionConfig {
  return {
    ...DEFAULT_RETENTION_CONFIG,
    ...fromFile(dbPath),
    ...fromEnv(),
    ...overrides,
  };
}
