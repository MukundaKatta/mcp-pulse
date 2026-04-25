# mcp-pulse

A small, dependency-free Node.js CLI that watches a fleet of MCP (Model Context Protocol) servers and reports health, latency, and uptime. Zero runtime dependencies. Works on Node 20+.

If you run more than a couple of MCP servers, you have probably already had this problem: one of them silently times out, your agent starts hallucinating around the missing tool, and you only notice when something downstream breaks. `mcp-pulse` keeps a small rolling window of probe results per server so you can see at a glance which servers are healthy, which are slow, and which are down.

## Install

```bash
npm install -g @mukundakatta/mcp-pulse
```

You can also invoke it as `mp` after install.

## Quick start

Create a `fleet.json` describing your MCP servers:

```json
{
  "servers": [
    {
      "name": "fs-local",
      "transport": "stdio",
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    {
      "name": "search-remote",
      "transport": "http",
      "url": "http://localhost:9000/mcp",
      "timeoutMs": 3000
    }
  ]
}
```

Run a one-shot health check:

```bash
mcp-pulse check fleet.json
```

Watch on a 10-second loop:

```bash
mcp-pulse watch fleet.json --interval=10
```

## CLI reference

```
mcp-pulse watch <config.json> [--interval=<sec>] [--json]
mcp-pulse check <config.json> [--json]
mcp-pulse --help
mcp-pulse --version
```

Options:

| Flag               | Default | Notes                                                 |
|--------------------|---------|-------------------------------------------------------|
| `--interval=<sec>` | `10`    | How often to re-probe in `watch` mode.                |
| `--json`           | off     | Emit JSON instead of an ANSI table.                   |

Exit codes:

- `check` exits `0` when every server is healthy on the latest probe, `1` if any server is down.
- `watch` runs until you send `SIGINT` (Ctrl+C).

## Status table

```
name           status  uptime%  p50ms  p95ms  last_error
-------------  ------  -------  -----  -----  ----------
fs-local       ●       100.0    12     14
search-remote  ✗       66.7     -      -      http status 502
```

The status column shows `●` for the most recent probe being healthy and `✗` for failed. Uptime, p50, and p95 are computed from the rolling sample window (default 100).

## Library usage

The package also exports the building blocks for programmatic use:

```js
import { probeServer, RollingStore, loadConfig } from '@mukundakatta/mcp-pulse';

const config = await loadConfig('./fleet.json');
const store = new RollingStore({ window: 50 });

for (const server of config.servers) {
  const result = await probeServer(server);
  store.record(server.name, { ok: result.ok, latencyMs: result.latencyMs, error: result.error });
}

console.table(store.summaries());
```

`probeServer(server, opts?)` returns `{ ok, latencyMs, error?, capabilities? }` and never throws.

## Config schema

```ts
type Config = {
  servers: Array<
    | {
        name: string;
        transport: 'stdio';
        command: string;
        args?: string[];
        timeoutMs?: number; // default 5000
      }
    | {
        name: string;
        transport: 'http';
        url: string;
        timeoutMs?: number;
      }
  >;
};
```

Validation is strict; missing fields raise a clear error pointing at the offending entry.

## Why zero dependencies?

`mcp-pulse` ships only Node stdlib. That keeps install fast, the supply chain small, and makes it easy to drop into a CI image or a Pi. Probing uses `child_process.spawn` for stdio servers and the built-in `fetch` (with `AbortController`) for HTTP.

## License

MIT
