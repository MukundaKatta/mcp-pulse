#!/usr/bin/env node
// mcp-pulse CLI entry.
//
// Subcommands:
//   watch <config.json> [--interval=<sec>] [--json]
//   check <config.json> [--json]
//
// Args are parsed by hand to keep the project zero-dependency.

import { loadConfig } from './config.js';
import { probeServer } from './probe.js';
import { RollingStore } from './store.js';
import { renderTable, renderJson } from './report.js';

const VERSION = '0.1.0';

const HELP = `mcp-pulse v${VERSION}
Watch a fleet of MCP servers and report health, latency, and uptime.

Usage:
  mcp-pulse watch <config.json> [--interval=<sec>] [--json]
  mcp-pulse check <config.json> [--json]
  mcp-pulse --help
  mcp-pulse --version

Commands:
  watch   Probe servers on a loop and print a rolling status table.
  check   Run one probe pass; exit 0 if all healthy, 1 if any down.

Options:
  --interval=<sec>  Watch interval in seconds (default: 10).
  --json            Emit JSON instead of an ANSI table.
  --help            Show this help.
  --version         Print version and exit.
`;

function parseArgs(argv) {
  const out = { positional: [], flags: {} };
  for (const tok of argv) {
    if (tok.startsWith('--')) {
      const eq = tok.indexOf('=');
      if (eq >= 0) {
        out.flags[tok.slice(2, eq)] = tok.slice(eq + 1);
      } else {
        out.flags[tok.slice(2)] = true;
      }
    } else {
      out.positional.push(tok);
    }
  }
  return out;
}

async function probeAll(config) {
  // Probe in parallel; each probe already has its own timeout, so
  // Promise.all is bounded by the slowest server's timeoutMs.
  return Promise.all(
    config.servers.map(async (server) => {
      const result = await probeServer(server);
      return { server, result, ts: Date.now() };
    }),
  );
}

async function runCheck(configPath, flags) {
  const config = await loadConfig(configPath);
  const store = new RollingStore({ window: 1 });
  const probes = await probeAll(config);
  for (const { server, result, ts } of probes) {
    store.record(server.name, { ts, ok: result.ok, latencyMs: result.latencyMs, error: result.error });
  }
  const summaries = store.summaries();
  if (flags.json) {
    process.stdout.write(renderJson(summaries) + '\n');
  } else {
    process.stdout.write(renderTable(summaries) + '\n');
  }
  const anyDown = summaries.some((s) => !s.lastOk);
  process.exit(anyDown ? 1 : 0);
}

async function runWatch(configPath, flags) {
  const config = await loadConfig(configPath);
  const intervalSec = clampInterval(flags.interval);
  const store = new RollingStore({ window: 100 });

  let stopping = false;
  const onSignal = () => {
    if (stopping) return;
    stopping = true;
    process.stdout.write('\nstopping...\n');
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  while (!stopping) {
    const probes = await probeAll(config);
    for (const { server, result, ts } of probes) {
      store.record(server.name, { ts, ok: result.ok, latencyMs: result.latencyMs, error: result.error });
    }
    const summaries = store.summaries();
    if (flags.json) {
      process.stdout.write(renderJson(summaries) + '\n');
    } else {
      // Clear screen + cursor to top so the table refreshes in place.
      process.stdout.write('\x1b[2J\x1b[H');
      process.stdout.write(`mcp-pulse v${VERSION} - watching ${config.servers.length} server(s) every ${intervalSec}s - Ctrl+C to stop\n\n`);
      process.stdout.write(renderTable(summaries) + '\n');
    }
    if (stopping) break;
    await sleep(intervalSec * 1000, () => stopping);
  }
  process.exit(0);
}

function clampInterval(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 10;
  // Clamp to a sane range; most users want 1s..1h.
  return Math.max(1, Math.min(3600, Math.floor(n)));
}

function sleep(ms, shouldAbort = () => false) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      if (shouldAbort()) return resolve();
      const elapsed = Date.now() - start;
      if (elapsed >= ms) return resolve();
      const remaining = Math.min(250, ms - elapsed);
      setTimeout(tick, remaining).unref?.();
    };
    tick();
  });
}

async function main(argv) {
  const args = parseArgs(argv);

  if (args.flags.help || args.flags.h) {
    process.stdout.write(HELP);
    return;
  }
  if (args.flags.version || args.flags.v) {
    process.stdout.write(VERSION + '\n');
    return;
  }

  const cmd = args.positional[0];
  const configPath = args.positional[1];

  if (!cmd) {
    process.stdout.write(HELP);
    process.exit(0);
  }

  if (cmd === 'check') {
    if (!configPath) {
      process.stderr.write('mcp-pulse check: missing <config.json> argument\n');
      process.exit(2);
    }
    return runCheck(configPath, args.flags);
  }

  if (cmd === 'watch') {
    if (!configPath) {
      process.stderr.write('mcp-pulse watch: missing <config.json> argument\n');
      process.exit(2);
    }
    return runWatch(configPath, args.flags);
  }

  process.stderr.write(`mcp-pulse: unknown command "${cmd}"\n\n`);
  process.stderr.write(HELP);
  process.exit(64);
}

main(process.argv.slice(2)).catch((e) => {
  process.stderr.write(`mcp-pulse: ${e?.message ?? e}\n`);
  process.exit(1);
});
