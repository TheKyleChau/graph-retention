---
name: graph-retention
description: >-
  Local-first graph memory for code and session knowledge. Use when you need to
  recall prior decisions, preferences, tasks, file relationships, or session
  insights; when starting a session; before compacting context; or when the user
  asks to remember, search, or retain knowledge across agent sessions.
---

# Graph Retention

Persistent knowledge graph stored in local SQLite. Search before answering questions about prior work. Write durable facts after decisions.

## When to search

`graph_surface` injects compact **roots** (not every leaf):

- **Pinned**: preferences and explicitly pinned nodes (never archived)
- **Recent**: last uncompressed root observations
- **Compressed**: block summaries of older observations

A compact line like `[decision] Use JWT (3 children)` means call `graph_expand` on that id. Do not dump children into context until you expand.

Call `graph_surface` at session start or when switching tasks. Escalate with `graph_search` (`detailLevel=full` only for the top 1-3 hits) or `graph_expand` on a parent or block. Do not inject archived originals into context.

## When to write

Call `graph_write` (not `graph_observe`) for durable knowledge:

| Type | Write when |
|------|------------|
| `decision` | A design choice is made and should survive this session |
| `preference` | User states a lasting workflow/tooling preference |
| `task` | A tracked piece of work is created, updated, or completed |
| `insight` | A non-obvious learning that would help a future session |
| `session` | Session start (hooks usually do this) |

**Importance:** omit it. Do not pass `importance: 1`. Type defaults apply. Set `pinned: true` only for lasting user preferences.

**Hierarchy:** attach details with `parentId` (session or decision as parent). Cross-links still apply:

- `parent_of` via `parentId` (parent → child)
- `decided_in` / `extracted_from` → current session
- `applies_to` → relevant `file` or `symbol`
- `supersedes` → the decision this replaces
- `relates_to` → related insights

Call `graph_observe` for lightweight file-edit breadcrumbs. Importance stays low; do not use it for decisions.

## Retention

Call these **without waiting for the user**:

1. `retention_preview`: if `toCompress`, `toArchive`, `toPurge`, or `toConsolidate` is non-empty, continue
2. `retention_run` (`dryRun` omitted or false): applies archive / purge / consolidate / compress and **writes an insight node** (`metadata.kind = "retention_run"`) into the graph

Auto-run when:

- The session is ending, compacting, or stopping
- `graph_stats.pendingCompressWindows > 0`
- Active `insight` / `file` counts are past the live window (~12)

Do not dump archived sources into context after a run. Use `graph_surface` (the new `block`s show under Compressed) and `graph_expand` on a block if you need originals.

`retention_restore` brings an archived node back to `active`. Session-end CLI hooks stay preview-only; **you** (the agent) own `retention_run` via MCP.
