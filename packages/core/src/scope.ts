import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface ScopeInfo {
  dbPath: string;
  projectId: string | null;
  gitRoot: string | null;
}

function findGitRoot(startDir: string): string | null {
  let current = path.resolve(startDir);
  while (true) {
    if (fs.existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function resolveScope(
  cwd: string = process.cwd(),
  options: { create?: boolean } = {},
): ScopeInfo {
  const create = options.create ?? true;
  const gitRoot = findGitRoot(cwd);
  if (gitRoot) {
    const projectDir = path.join(gitRoot, ".graph-retention");
    if (create) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    return {
      dbPath: path.join(projectDir, "graph.db"),
      projectId: gitRoot,
      gitRoot,
    };
  }

  const globalDir = path.join(os.homedir(), ".graph-retention");
  if (create) {
    fs.mkdirSync(globalDir, { recursive: true });
  }
  return {
    dbPath: path.join(globalDir, "graph.db"),
    projectId: path.resolve(cwd),
    gitRoot: null,
  };
}

export function resolveDbPath(explicitPath?: string): string {
  if (explicitPath) {
    const dir = path.dirname(explicitPath);
    fs.mkdirSync(dir, { recursive: true });
    return explicitPath;
  }
  return resolveScope().dbPath;
}
