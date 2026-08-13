# Cursor adapter

1. Build the monorepo: `pnpm install && pnpm build`
2. Set `GRAPH_RETENTION_ROOT` to the clone root
3. Merge [`mcp.json`](./mcp.json) into `.cursor/mcp.json`
4. Merge [`hooks.json`](./hooks.json) into `.cursor/hooks.json`
5. Optional: copy [`../../plugin/skills/graph-retention`](../../plugin/skills/graph-retention) into `.cursor/skills/graph-retention`

See [INSTALL.md](../../INSTALL.md) for env vars and path expansion.
