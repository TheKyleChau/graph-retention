# Graph Retention

Local-first graph memory for AI coding agents. Stores code knowledge (files, symbols, dependencies) and session knowledge (decisions, preferences, tasks, insights) in SQLite, links them with typed edges, and applies decay-based retention so stale context fades instead of filling the window.

Works with Cursor, Claude Code, Codex, and VS Code (Copilot Agent Mode) through a shared MCP server.

## Architecture

```
Cursor / Claude Code / Codex / VS Code
                 │
     Agent Plugin + MCP (stdio)
                 │
     ┌───────────┴───────────┐
     │  GraphEngine (core)   │
     │  Retention + Search   │
     │  SQLite + FTS5        │
     └───────────────────────┘
```

Default database:

| Scope | Path |
|-------|------|
| Inside a git repo | `<git-root>/.graph-retention/graph.db` |
| Otherwise | `~/.graph-retention/graph.db` |

Recall (`graph_surface`, `graph_search`, `graph_expand`, stats, export) is scoped to the current working directory: the git root if you are in a repo, otherwise the resolved cwd. It is not scoped to a git branch. Other projects in a shared DB are not returned.

## Context savings

| Metric | Result |
|--------|--------|
| Injected hybrid context | **284 tokens** (flat as the graph grows) |
| Naive full dump of active nodes | 87,103 tokens before retention |
| Cut vs full dump | **99.7%** |
| Active nodes | 389 -> 68 |
| Sources compressed into blocks | 368 |
| Planted facts still retrievable | **5 / 5** (surface, FTS, or block expand) |

| Observations | Naive full dump | Naive compact dump | Hybrid `graph_surface` | Cut vs full |
|--------------|-----------------|--------------------|------------------------|-------------|
| 24 | 1,820 | 98 | 130 | 92.9% |
| 48 | 7,991 | 151 | 283 | 96.5% |
| 96 | 20,337 | 257 | 283 | 98.6% |
| 192 | 44,974 | 470 | 284 | 99.4% |
| 384 | 94,274 | 894 | 284 | 99.7% |

## Proof of concept

### 8k dump

| Model | No graph | Hybrid (271 tok) | Full dump (7,910 tok) |
|-------|----------|------------------|------------------------|
| Claude Haiku 4.5 | 0/5 | **3/5** | 4/5 |
| Claude Sonnet 5 | 0/5 | **3/5** | 4/5 |
| Claude Opus 5 | 0/5 | **3/5** | 4/5 |
| GPT-OSS 20B | 0/5 | **3/5** | 4/5 |
| GPT-5.6 Sol | 0/5 | **3/5** | 4/5 |
| GPT-5.6 Terra | 0/5 | **3/5** | 4/5 |
| GPT-5.6 Luna | 0/5 | **3/5** | 4/5 |
| GPT-5.5 | 0/5 | **3/5** | 4/5 |
| DeepSeek V4 Pro | 0/5 | **3/5** | 4/5 |
| DeepSeek V4 Flash | 0/5 | 2/5 | 4/5 |
| Gemini 3.7 Flash | 0/5 | **3/5** | 4/5 |
| Kimi K3 | 0/5 | **3/5** | 4/5 |
| Qwen 3.8 Max | 0/5 | **3/5** | 4/5 |
| Muse Spark 1.2 | 0/5 | **3/5** | 4/5 |

### ~120k-140k dump

| Model | No graph | Hybrid | Full dump |
|-------|----------|--------|-----------|
| DeepSeek V4 Pro | 0/5 | **3/5** (506 tok) | 4/5 (139,068 tok) |
| DeepSeek V4 Flash | 0/5 | **3/5** (506 tok) | 4/5 (139,068 tok) |
| Gemini 3.7 Flash | 0/5 | **3/5** (450 tok) | 4/5 (143,290 tok) |
| Kimi K3 | 0/5 | **3/5** (477 tok) | 4/5 (132,277 tok) |
| Qwen 3.8 Max | 0/5 | **3/5** (483 tok) | 4/5 (141,805 tok) |
| Muse Spark 1.2 | 0/5 | **3/5** (397 tok) | 4/5 (131,963 tok) |
| GPT-5.6 Sol | 0/5 | **3/5** (398 tok) | 4/5 (131,982 tok) |
| GPT-5.6 Terra | 0/5 | **3/5** (398 tok) | 4/5 (131,982 tok) |
| GPT-5.6 Luna | 0/5 | **3/5** (398 tok) | 4/5 (131,982 tok) |
| GPT-5.5 | 0/5 | **3/5** (398 tok) | 4/5 (131,982 tok) |
| GPT-OSS 20B | 0/5 | **3/5** (457 tok) | 4/5 (85,305 tok) |

## Install

Full per-platform steps: **[INSTALL.md](INSTALL.md)**.

```bash
pnpm install
pnpm build
```

Requires Node.js 22+. Claude Code and Codex spawn the MCP on launch after one register:

```bash
node scripts/install-mcp.mjs
```

| Platform | How to attach |
|----------|----------------|
| **Cursor** | Merge into `.cursor/mcp.json` using `${env:GRAPH_RETENTION_ROOT}`. Optional hooks and skill. |
| **Claude Code** | `node scripts/install-mcp.mjs` (user-scope `claude mcp add` with an absolute launcher path) |
| **Codex** | Same installer writes `~/.codex/config.toml` |
| **VS Code** | Open this repo (extension registers MCP) or add `.vscode/mcp.json`. Needs VS Code 1.102+ / Copilot Agent Mode. |
| **Any Agent Plugins 1.0.0 client** | Load the [`plugin/`](plugin) bundle (`plugin.json` + `mcp.json` + `skills/`). |

Override the DB with `GRAPH_RETENTION_DB`. Override the project cwd with `GRAPH_RETENTION_CWD`.

## Graph model

### Node types

| Type | Role |
|------|------|
| `file` | Path in the repo |
| `symbol` | Function/class/type |
| `dependency` | Package or import |
| `decision` | Durable design choice |
| `preference` | User/tooling preference |
| `task` | Tracked work item |
| `insight` | Session learning |
| `session` | Agent session metadata |
| `block` | Compressed summary of older observations |

### Edge types

| Relation | Typical use |
|----------|-------------|
| `depends_on` | file/symbol → file/symbol/dependency |
| `modified_in` | file/symbol → session |
| `decided_in` | decision → session |
| `applies_to` | decision/preference → file/symbol |
| `relates_to` | insight → anything |
| `supersedes` | newer decision → older decision |
| `extracted_from` | insight/decision → session, or `block` → archived sources |
| `parent_of` | parent → child (session/decision holding details) |

Each node has `importance` (0-1), `decay_score`, `access_count`, `pinned`, and a retention `zone`: `active` -> `archived` -> `purged`. Preferences and nodes with `pinned` true skip archive. Do not pass `importance: 1`; type defaults apply unless `pinned` is true.

`graph_surface` injects compact roots (child counts in the line). `graph_expand` walks `parent_of` children on demand.

## MCP tools

| Tool | Purpose |
|------|---------|
| `graph_write` | Upsert a node; optional `parentId` and edges. Omit importance. |
| `graph_read` | Fetch by id (records access by default) |
| `graph_link` | Create/update an edge |
| `graph_search` | FTS5 → graph expansion → decay rerank |
| `graph_expand` | Compact walk from a node (`parent_of` first) |
| `graph_surface` | Hybrid recall: pinned roots + recent roots + compressed blocks |
| `graph_observe` | Lightweight file-edit capture (low importance) |
| `retention_preview` | Dry-run archive / purge / consolidate / compress |
| `retention_run` | Apply retention, compress blocks, and graph the run as an insight |
| `retention_restore` | Archived → active |
| `graph_stats` | Counts by type/zone plus `pendingCompressWindows` |
| `graph_export` | JSON backup |

Search `detailLevel`: `compact` (default, ~50 chars, plus child count), `summary` (~150 chars), `full`. `graph_surface` without a `nodeType` filter injects three bands (Pinned / Recent / Compressed) of compact roots. On connect, the MCP server sends agent instructions (omit importance, use `parentId`, surface then expand).

## Retention policy

Default (copy [`packages/core/retention.config.json`](packages/core/retention.config.json) next to `graph.db` to override):

| Zone | Trigger |
|------|---------|
| **active** | Default; fully searchable |
| **archived** | `decay_score < 0.15` **or** inactive > 30 days; also sources after block compression |
| **purged** | Archived > 180 days **and** `importance < 0.3` |

Pinned nodes (preferences, or `pinned: true`) skip archive.

Hybrid compression (inside `retention_run`): every 8 observations beyond a live window of 12 become a `block`, with overlap 2 so boundary facts survive. The agent should call `retention_preview` then `retention_run` (MCP) when a session ends or `graph_stats.pendingCompressWindows > 0`. A successful run is written into the graph as an `insight` (`metadata.kind = "retention_run"`). Session-end CLI hooks stay preview-only.

Decay: `importance * recency_boost * access_boost` (exponential recency, log access boost). Near-duplicate `insight` / `decision` / `preference` labels (Jaccard >= 0.85) are merged.

Env overrides: `GRAPH_RETENTION_ARCHIVE_DAYS`, `GRAPH_RETENTION_PURGE_DAYS`, `GRAPH_RETENTION_DECAY_THRESHOLD`, `GRAPH_RETENTION_PURGE_IMPORTANCE`, `GRAPH_RETENTION_HALF_LIFE_DAYS`, `GRAPH_RETENTION_CONSOLIDATION_THRESHOLD`, `GRAPH_RETENTION_WINDOW_SIZE`, `GRAPH_RETENTION_BLOCK_SIZE`, `GRAPH_RETENTION_BLOCK_OVERLAP`, `GRAPH_RETENTION_PIN_IMPORTANCE`.

## CLI (hooks)

```bash
node "$GRAPH_RETENTION_ROOT/scripts/run-cli.mjs" session-start
node "$GRAPH_RETENTION_ROOT/scripts/run-cli.mjs" session-end
node "$GRAPH_RETENTION_ROOT/scripts/run-cli.mjs" observe-file-edit
node "$GRAPH_RETENTION_ROOT/scripts/run-cli.mjs" pre-compact
node "$GRAPH_RETENTION_ROOT/scripts/run-cli.mjs" surface
node "$GRAPH_RETENTION_ROOT/scripts/run-cli.mjs" stats
```

Hooks call the CLI; they do not embed storage logic.

## Smoke check

After `pnpm build`:

1. **Cursor**: Add the MCP server, start a chat, call `graph_write` with a `decision`. In a new session, `graph_search` finds it with `decayScore`.
2. **Claude Code**: Same MCP tools via the plugin. SessionStart injects hybrid `graph_surface` (Pinned / Recent / Compressed).
3. **Codex**: MCP config loads. `graph_stats` returns `dbPath`.
4. **VS Code**: Extension activates. Copilot Agent Mode lists Graph Retention tools.

## Packages

| Package | Role |
|---------|------|
| [`packages/core`](packages/core) | Graph store, retention, search |
| [`packages/mcp-server`](packages/mcp-server) | stdio MCP server |
| [`packages/cli`](packages/cli) | Hook entrypoints |
| [`packages/vscode`](packages/vscode) | VS Code MCP provider extension |
| [`adapters/*`](adapters) | Thin platform templates |
| [`plugin/`](plugin) | Agent Plugins 1.0.0 bundle |

## License

GNU GPLv3. See [LICENSE](LICENSE).
