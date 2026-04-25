// Config loader for mcp-pulse.
//
// A config file is plain JSON of the shape:
//   { servers: [ { name, transport, command?, args?, url?, timeoutMs? } ] }
//
// `loadConfig(path)` reads the file, validates it, and returns the parsed
// object. It throws a clear error if anything is missing or malformed so
// the CLI can surface a useful message.

import { readFile } from 'node:fs/promises';

const VALID_TRANSPORTS = new Set(['stdio', 'http']);

export async function loadConfig(path) {
  if (typeof path !== 'string' || !path.length) {
    throw new Error('loadConfig: a config path is required');
  }
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (e) {
    throw new Error(`loadConfig: cannot read ${path}: ${e.message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`loadConfig: invalid JSON in ${path}: ${e.message}`);
  }
  return validateConfig(parsed, path);
}

export function validateConfig(parsed, source = 'config') {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${source}: top-level must be an object`);
  }
  if (!Array.isArray(parsed.servers)) {
    throw new Error(`${source}: missing required field "servers" (array)`);
  }
  if (parsed.servers.length === 0) {
    throw new Error(`${source}: "servers" must contain at least one entry`);
  }
  const seen = new Set();
  const servers = parsed.servers.map((entry, idx) => validateServer(entry, idx, seen, source));
  return { servers };
}

function validateServer(entry, idx, seen, source) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${source}: servers[${idx}] must be an object`);
  }
  if (typeof entry.name !== 'string' || !entry.name.length) {
    throw new Error(`${source}: servers[${idx}] missing required field "name"`);
  }
  if (seen.has(entry.name)) {
    throw new Error(`${source}: duplicate server name "${entry.name}"`);
  }
  seen.add(entry.name);

  if (typeof entry.transport !== 'string' || !VALID_TRANSPORTS.has(entry.transport)) {
    throw new Error(
      `${source}: servers[${idx}] ("${entry.name}") "transport" must be one of: ${[...VALID_TRANSPORTS].join(', ')}`,
    );
  }

  const out = {
    name: entry.name,
    transport: entry.transport,
    timeoutMs: typeof entry.timeoutMs === 'number' && entry.timeoutMs > 0 ? entry.timeoutMs : 5000,
  };

  if (entry.transport === 'stdio') {
    if (typeof entry.command !== 'string' || !entry.command.length) {
      throw new Error(`${source}: servers[${idx}] ("${entry.name}") stdio transport requires "command"`);
    }
    out.command = entry.command;
    out.args = Array.isArray(entry.args) ? entry.args.map(String) : [];
  } else if (entry.transport === 'http') {
    if (typeof entry.url !== 'string' || !entry.url.length) {
      throw new Error(`${source}: servers[${idx}] ("${entry.name}") http transport requires "url"`);
    }
    try {
      // eslint-disable-next-line no-new
      new URL(entry.url);
    } catch (_e) {
      throw new Error(`${source}: servers[${idx}] ("${entry.name}") "url" is not a valid URL`);
    }
    out.url = entry.url;
  }

  return out;
}
