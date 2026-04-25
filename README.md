# mcp-pulse

A small, dependency-free Node.js CLI that watches a fleet of Model Context Protocol (MCP) servers and tells you which ones are healthy, slow, or down. With over 110 million monthly MCP downloads in 2026, "is the gateway up?" has quietly become a real production question. This tool gives you an answer in 30 seconds.

## Why

Most MCP setups today look like this:

- 3 to 8 MCP servers, half local stdio, half remote HTTP / SSE.
- A connector list spread across `~/.cursor/mcp.json`, `~/.claude/mcp.json`, and a couple of project files.
- No observability when something starts timing out.

`mcp-pulse` reads your MCP config files, pings each server with a lightweight initialize/tools-list probe, records latency and last-seen, and prints a status board you can run on demand or pipe into a check script.

## Features

- Reads MCP server lists from common config files (Claude Desktop, Cursor, Cline, Windsurf, Zed) or from a custom JSON file.
- Probes HTTP, SSE, and stdio servers with a real MCP `initialize` + `tools/list` round trip.
- Records uptime, p50/p95 latency, and consecutive failure counts in a local SQLite-free JSONL store.
- Watch mode: re-runs probes every N seconds and updates a single-screen status board.
- JSON output mode for piping into alerts, dashboards, or CI checks.
- Zero npm dependencies for the core; only the Node.js standard library.

## Installation

```bash
npm install -g mcp-pulse
```

Or run without installing:

```bash
npx mcp-pulse check
```

From source:

```bash
git clone https://github.com/MukundaKatta/mcp-pulse.git
cd mcp-pulse
npm link
```

## Usage

### One-shot check

```bash
mcp-pulse check
```

Output:

```
NAME                STATUS   LATENCY   LAST OK         FAILS
github-mcp          ok       42ms      just now        0
fs-local            ok       8ms       just now        0
brave-search        slow     1820ms    2m ago          0
notion-mcp          down     -         18m ago         3
```

### Watch mode

```bash
mcp-pulse watch --interval 30
```

Re-probes every 30 seconds, refreshes the table in place. Press `Ctrl+C` to stop.

### JSON output

```bash
mcp-pulse check --json
```

Returns a parseable record per server with status, latency_ms, last_ok, fail_streak, and the probe transport used. Pipe it anywhere.

### Custom server list

```bash
mcp-pulse check --config ./my-mcp-servers.json
```

The config file is a simple JSON object:

```json
{
  "servers": {
    "github-mcp":   { "transport": "stdio", "command": "npx", "args": ["-y", "@github/mcp"] },
    "brave-search": { "transport": "http",  "url": "http://localhost:3030/mcp" },
    "notion-mcp":   { "transport": "sse",   "url": "https://example.com/mcp/sse" }
  }
}
```

## Status Categories

| Status | Meaning                                                            |
|--------|--------------------------------------------------------------------|
| ok     | Initialize + tools/list succeeded under the slow threshold.        |
| slow   | Succeeded but p95 latency is over the slow threshold (default 1s). |
| down   | Probe failed: connection refused, timeout, or invalid handshake.   |
| unknown| Never been probed in this session and no history file yet.         |

## Examples

See the `examples/` directory:

- `examples/local-mcps.json` - a sample config with common local MCP servers.
- `examples/run-and-alert.js` - run a one-shot check, exit non-zero if anything is `down`.
- `examples/watch-loop.js` - programmatic watch loop, useful inside larger tools.

## Contributing

We welcome issues and PRs. Some good starter tasks:

- Add a Prometheus exporter for `/metrics`.
- Add probe support for the streamable-HTTP transport spec variants.
- Plug in a tiny webhook notifier (Slack, Discord) for `down` transitions.
- Extend the config readers to detect more IDE config locations.

Run the test suite with:

```bash
npm test
```

## License

MIT. See LICENSE.
