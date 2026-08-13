# Claude Code adapter

Install as a local plugin or merge the MCP server by hand.

```bash
pnpm install && pnpm build
node scripts/install-mcp.mjs
```

Or load this directory for one session:

```bash
claude --plugin-dir "$GRAPH_RETENTION_ROOT/adapters/claude-code"
```

[`plugin.json`](./plugin.json) points at [`mcp.json`](./mcp.json). [`hooks.json`](./hooks.json) runs [`hooks/run.mjs`](./hooks/run.mjs) for SessionStart, SessionEnd, PreCompact, and Stop.

See [INSTALL.md](../../INSTALL.md).
