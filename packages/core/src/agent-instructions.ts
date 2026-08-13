/** Injected on MCP initialize and session-start. Keep compact. */
export const AGENT_INSTRUCTIONS = `Graph Retention is local SQLite memory for this project. Keep prompts small.

Recall:
- All recall is for this git repo (or cwd), not a git branch. Switching branches does not hide prior knowledge.
- Call graph_surface at session start and when switching tasks. You get compact roots (Pinned / Recent / Compressed), not every node.
- A line like "[decision] Use JWT (3 children)" means call graph_expand on that node's id. Do not dump children until you expand.
- graph_search for a specific fact. detailLevel=compact by default; full only for the top 1-3 hits.
- Do not inject archived originals. Expand a block if you need sources.

Write (graph_write, not graph_observe, for durable facts):
- decision: a design choice that should survive this session
- preference: lasting user or tooling preference
- task: tracked work
- insight: a non-obvious learning for a future session
- Attach details with parentId (use the current session or a decision as parent). That creates parent_of.
- Also link: applies_to file/symbol, supersedes an older decision, decided_in or extracted_from the session, relates_to related insights.
- Omit importance. Never pass importance 1. Type defaults apply. Set pinned true only for lasting user preferences.

Observe: graph_observe is for file-edit breadcrumbs only (low importance). Do not use it for decisions.

Retention (do this without waiting for the user):
- At session end, compact, or when graph_stats.pendingCompressWindows > 0: retention_preview, then retention_run if there is work.
`;
