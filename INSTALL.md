# Install Graph Retention MCP

One stdio MCP server. Same 12 tools on Claude Code, Cursor, Codex, and VS Code.

## 1. Build once

Requires **Node.js 22+** and [pnpm](https://pnpm.io/).

```bash
git clone <this-repo>
cd graph-retention
pnpm install
pnpm build
```

Export the clone root. Every config below uses this instead of a baked-in path:

```bash
export GRAPH_RETENTION_ROOT="$(pwd)"
```

Optional: `GRAPH_RETENTION_MCP` (server entry), `GRAPH_RETENTION_CLI` (hook CLI), `GRAPH_RETENTION_DB` (SQLite file), `GRAPH_RETENTION_CWD` (project root for git-scoped DB).

Register once so Claude Code and Codex spawn the stdio server when they start. You do not keep a `node` process running:

```bash
node scripts/install-mcp.mjs
```

The installer writes an absolute path to `scripts/run-mcp.mjs` (and to the `node` that ran it). Manual `claude mcp add` / `codex mcp add` with an unset `GRAPH_RETENTION_ROOT` stores `node /scripts/run-mcp.mjs` and the client cannot start the server.

The graph database is created automatically:

| You are... | Database |
|------------|----------|
| Inside a git repo | `<git-root>/.graph-retention/graph.db` |
| Otherwise | `~/.graph-retention/graph.db` |

The launchers resolve `packages/*/dist` from `GRAPH_RETENTION_ROOT` (or from their own location if you pass them an absolute path). Nothing in the repo is tied to a specific machine.

---

## 2. Claude Code

### Option A: installer (recommended)

User-wide (all projects). Writes a real absolute command so Claude spawns the server on launch:

```bash
node scripts/install-mcp.mjs
```

Equivalent by hand (expand the path in your shell; do not leave `GRAPH_RETENTION_ROOT` empty):

```bash
claude mcp add --scope user graph-retention -- node "$GRAPH_RETENTION_ROOT/scripts/run-mcp.mjs"
```

This project only (writes `.mcp.json`, shareable if teammates also set `GRAPH_RETENTION_ROOT`):

```bash
claude mcp add --scope project graph-retention \
  --env GRAPH_RETENTION_CWD="$(pwd)" \
  -- node "$GRAPH_RETENTION_ROOT/scripts/run-mcp.mjs"
```

Default `--scope local` is private to you and only this project (`~/.claude.json`).

Restart Claude Code (or run `/mcp` in a session). Ask it to call `graph_stats`. You should see `dbPath` and `pendingCompressWindows`.

### Option B: `.mcp.json` in the project

Copy the template from [`adapters/claude-code/mcp.json`](adapters/claude-code/mcp.json). It references `${GRAPH_RETENTION_ROOT}/scripts/run-mcp.mjs`. Set that env var in the environment Claude inherits, or substitute the path when you copy.

### Option C: plugin + hooks (this session)

```bash
claude --plugin-dir "$GRAPH_RETENTION_ROOT/adapters/claude-code"
```

[`adapters/claude-code`](adapters/claude-code) ships `plugin.json`, `mcp.json`, and hooks (`SessionStart`, `SessionEnd`, `PreCompact`, `Stop`). Marketplace installs use `claude plugin install name@marketplace`. For day-to-day use, Option A is enough.

### Skill (so the agent auto-runs retention)

```bash
mkdir -p .claude/skills
cp -R "$GRAPH_RETENTION_ROOT/plugin/skills/graph-retention" .claude/skills/graph-retention
```

The skill tells the agent to `graph_surface` at session start and to call `retention_preview` then `retention_run` at session end when there is work.

---

## 3. Cursor

### MCP

Create or merge **`.cursor/mcp.json`** in the project (or `~/.cursor/mcp.json` for all projects). Cursor expands `${env:...}`:

```json
{
  "mcpServers": {
    "graph-retention": {
      "command": "node",
      "args": ["${env:GRAPH_RETENTION_ROOT}/scripts/run-mcp.mjs"],
      "env": {
        "GRAPH_RETENTION_CWD": "${workspaceFolder}"
      }
    }
  }
}
```

Set `GRAPH_RETENTION_ROOT` in your shell profile or Cursor env so the substitution resolves. Reload Cursor. **Settings > MCP** should list `graph-retention` with the 12 tools.

### Hooks (optional)

Copy [`adapters/cursor/hooks.json`](adapters/cursor/hooks.json) to `.cursor/hooks.json`. Commands use `${GRAPH_RETENTION_ROOT}/scripts/run-cli.mjs`. If Cursor does not expand that variable in hook commands, substitute `"$GRAPH_RETENTION_ROOT"` yourself when copying.

### Skill

```bash
mkdir -p .cursor/skills
cp -R "$GRAPH_RETENTION_ROOT/plugin/skills/graph-retention" .cursor/skills/graph-retention
```

---

## 4. Codex

Codex uses **TOML**, not JSON. User-wide: `~/.codex/config.toml`. Project: `.codex/config.toml` (trusted directories only). Shared by Codex CLI, the IDE extension, and the desktop app.

### CLI (recommended)

```bash
node scripts/install-mcp.mjs
```

Equivalent by hand (expand the path in your shell; do not leave `GRAPH_RETENTION_ROOT` empty):

```bash
codex mcp add graph-retention -- node "$GRAPH_RETENTION_ROOT/scripts/run-mcp.mjs"
```

### `config.toml`

```toml
[mcp_servers.graph-retention]
command = "node"
args = ["${GRAPH_RETENTION_ROOT}/scripts/run-mcp.mjs"]

[mcp_servers.graph-retention.env]
GRAPH_RETENTION_CWD = "."
```

If your Codex build does not expand env in `args`, paste the absolute path your shell prints for `"$GRAPH_RETENTION_ROOT/scripts/run-mcp.mjs"`.

The table name is `mcp_servers` (underscore). JSON `mcpServers` blocks from Cursor/Claude will be ignored.

```bash
codex mcp list
codex mcp get graph-retention
```

In a Codex session, `/mcp` should list Graph Retention. Call `graph_stats` and confirm `dbPath`.

---

## 5. VS Code (Copilot Agent Mode)

Needs **VS Code 1.102+** and Copilot Chat Agent Mode.

### Option A: this repo as the workspace

1. `pnpm build`
2. Open this repository in VS Code
3. The [`packages/vscode`](packages/vscode) extension registers the MCP server on activation (no `.vscode/mcp.json`)

Package and install the extension:

```bash
cd packages/vscode
npx --yes @vscode/vsce package --no-dependencies
code --install-extension ./*.vsix
```

The extension reads `GRAPH_RETENTION_MCP` or `GRAPH_RETENTION_ROOT`, then falls back to `packages/mcp-server/dist` next to the extension.

### Option B: any workspace via `mcp.json`

In the project you edit, create `.vscode/mcp.json`:

```json
{
  "servers": {
    "graph-retention": {
      "type": "stdio",
      "command": "node",
      "args": ["${env:GRAPH_RETENTION_ROOT}/scripts/run-mcp.mjs"],
      "env": {
        "GRAPH_RETENTION_CWD": "${workspaceFolder}"
      }
    }
  }
}
```

Some VS Code builds still use `"mcpServers"` instead of `"servers"`. If the server does not appear, swap the key.

Open Copilot Chat > Agent. The Graph Retention tools should be listed.

---

## 6. Agent Plugins 1.0.0 (portable bundle)

If the client supports Agent Plugins, load [`plugin/`](plugin) (`plugin.json` + `mcp.json` + `skills/`). Set `GRAPH_RETENTION_ROOT` so [`plugin/mcp.json`](plugin/mcp.json) can resolve the launcher.

---

## 7. Smoke check (any platform)

After the server is connected, in an agent chat:

1. Call `graph_stats`. You get `dbPath`, `byType`, `pendingCompressWindows`.
2. Call `graph_write` with `type: "decision"`, `label: "Use JWT over sessions"`.
3. New session (or same): `graph_search` query `JWT`. Hit with `decayScore`.
4. Call `graph_surface`. Hybrid bands: Pinned / Recent / Compressed.
5. Call `retention_preview`, then `retention_run` if there is work. A successful run writes an insight `metadata.kind = "retention_run"`.

If tools do not appear:

- `pnpm build` was not run
- Claude/Codex still have `node /scripts/run-mcp.mjs` from an unset `GRAPH_RETENTION_ROOT` (re-run `node scripts/install-mcp.mjs`)
- Client was not restarted after editing MCP config
- Node on `PATH` is older than 22 (`node -v`)

---

## 8. What gets installed

| Piece | Role |
|-------|------|
| `scripts/install-mcp.mjs` | Registers Claude Code + Codex to spawn MCP on launch |
| `scripts/run-mcp.mjs` | MCP stdio launcher (required) |
| `scripts/run-cli.mjs` | Hook CLI launcher (optional) |
| `plugin/skills/graph-retention` | Agent rubric: when to search / write / auto `retention_run` |
| `adapters/claude-code` | Claude plugin + hooks |
| `adapters/cursor` | Cursor `mcp.json` + `hooks.json` |
| `adapters/codex` | Codex MCP template |
| `packages/vscode` | VS Code MCP provider extension |

You only **need** the MCP server. Hooks and the skill make capture and auto-retention reliable.
