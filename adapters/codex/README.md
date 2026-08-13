# Codex integration

Set `GRAPH_RETENTION_ROOT` to the clone root, then add the server:

```bash
pnpm install && pnpm build
node scripts/install-mcp.mjs
```

Or merge [`mcp.json`](./mcp.json) into Codex config as a `[mcp_servers.graph-retention]` TOML table. Codex does not read JSON `mcpServers` blocks.

See [INSTALL.md](../../INSTALL.md).
