import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

function resolveMcpServerPath(extensionPath: string): string | undefined {
  const fromEnv = process.env.GRAPH_RETENTION_MCP;
  if (fromEnv && fs.existsSync(fromEnv)) {
    return fromEnv;
  }

  const root = process.env.GRAPH_RETENTION_ROOT;
  const candidates = [
    root
      ? path.join(root, "packages", "mcp-server", "dist", "index.js")
      : undefined,
    path.join(extensionPath, "mcp-server", "index.js"),
    path.join(extensionPath, "..", "mcp-server", "dist", "index.js"),
  ].filter((p): p is string => Boolean(p));

  return candidates.find((candidate) => fs.existsSync(candidate));
}

export function activate(context: vscode.ExtensionContext): void {
  const serverPath = resolveMcpServerPath(context.extensionPath);
  if (!serverPath) {
    throw new Error(
      "graph-retention MCP server not found. Run pnpm build, or set GRAPH_RETENTION_MCP / GRAPH_RETENTION_ROOT.",
    );
  }

  const cwd =
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  const provider: vscode.McpServerDefinitionProvider = {
    provideMcpServerDefinitions: async () => [
      new vscode.McpStdioServerDefinition(
        "Graph Retention",
        process.execPath,
        [serverPath],
        { GRAPH_RETENTION_CWD: cwd },
      ),
    ],
  };

  context.subscriptions.push(
    vscode.lm.registerMcpServerDefinitionProvider(
      "graph-retention.mcp",
      provider,
    ),
  );
}

export function deactivate(): void {}
