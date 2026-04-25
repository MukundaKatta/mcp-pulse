'use strict';

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

/**
 * Default locations to search for MCP server configs across common tools.
 * Each entry has a `path` and a `style` so we know how to parse it.
 */
const DEFAULT_LOCATIONS = [
  { style: 'claude', path: path.join(os.homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json') },
  { style: 'claude', path: path.join(os.homedir(), '.config', 'Claude', 'claude_desktop_config.json') },
  { style: 'cursor', path: path.join(os.homedir(), '.cursor', 'mcp.json') },
  { style: 'cursor', path: path.join(os.homedir(), '.config', 'cursor', 'mcp.json') },
  { style: 'cline',  path: path.join(os.homedir(), '.cline', 'mcp_settings.json') },
  { style: 'windsurf', path: path.join(os.homedir(), '.windsurf', 'mcp_config.json') },
  { style: 'zed',    path: path.join(os.homedir(), '.config', 'zed', 'settings.json') },
];

/**
 * Load a config object of the shape:
 *   { servers: { <name>: { transport, command|url, args?, env? } } }
 *
 * If `configPath` is provided we trust it and parse directly.
 * Otherwise, we walk the default locations and merge any servers we find,
 * with the first-seen name winning on conflict.
 */
async function loadConfig(configPath) {
  if (configPath) {
    const raw = await fs.readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw);
    return normalize(parsed, 'custom');
  }

  const merged = { servers: {} };
  for (const loc of DEFAULT_LOCATIONS) {
    let raw;
    try {
      raw = await fs.readFile(loc.path, 'utf8');
    } catch (_e) {
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (_e) {
      continue;
    }
    const norm = normalize(parsed, loc.style);
    for (const [name, spec] of Object.entries(norm.servers)) {
      if (!(name in merged.servers)) {
        merged.servers[name] = spec;
      }
    }
  }
  return merged;
}

/**
 * Normalize different tool config shapes to a single internal format.
 * All tools we currently support use a top-level `mcpServers` object
 * keyed by server name. Inside each entry we look for either
 * `command/args/env` (stdio) or `url`/`type` (http/sse).
 */
function normalize(parsed, style) {
  const out = { servers: {} };
  // Some tools nest under settings, e.g. Zed has top-level "context_servers".
  const buckets = [
    parsed.mcpServers,
    parsed.context_servers,
    parsed.mcp_servers,
    parsed.servers,
  ].filter((b) => b && typeof b === 'object');

  for (const bucket of buckets) {
    for (const [name, raw] of Object.entries(bucket)) {
      if (!raw || typeof raw !== 'object') continue;
      const spec = inferTransport(raw);
      if (spec) {
        out.servers[name] = spec;
      }
    }
  }

  return out;
}

function inferTransport(raw) {
  if (typeof raw.command === 'string') {
    return {
      transport: 'stdio',
      command: raw.command,
      args: Array.isArray(raw.args) ? raw.args : [],
      env: raw.env && typeof raw.env === 'object' ? raw.env : {},
    };
  }
  if (typeof raw.url === 'string') {
    const t = (raw.type || raw.transport || '').toLowerCase();
    const transport = t === 'sse' ? 'sse' : 'http';
    return { transport, url: raw.url, headers: raw.headers || {} };
  }
  return null;
}

module.exports = { loadConfig, DEFAULT_LOCATIONS, normalize };
