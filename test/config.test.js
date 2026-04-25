// Tests for loadConfig: validates schema and surfaces clear errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { loadConfig, validateConfig } from '../src/config.js';

async function withTempFile(name, contents, fn) {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-pulse-cfg-'));
  const path = join(dir, name);
  await writeFile(path, contents, 'utf8');
  try {
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test('loadConfig: parses a valid stdio + http config', async () => {
  const cfg = {
    servers: [
      { name: 'stdio-srv', transport: 'stdio', command: 'node', args: ['x.js'] },
      { name: 'http-srv', transport: 'http', url: 'http://localhost:9000/mcp' },
    ],
  };
  await withTempFile('ok.json', JSON.stringify(cfg), async (p) => {
    const out = await loadConfig(p);
    assert.equal(out.servers.length, 2);
    assert.equal(out.servers[0].command, 'node');
    assert.deepEqual(out.servers[0].args, ['x.js']);
    assert.equal(out.servers[1].url, 'http://localhost:9000/mcp');
    assert.equal(out.servers[0].timeoutMs, 5000);
  });
});

test('loadConfig: respects per-server timeoutMs', async () => {
  const cfg = {
    servers: [{ name: 'a', transport: 'stdio', command: 'node', timeoutMs: 1234 }],
  };
  await withTempFile('to.json', JSON.stringify(cfg), async (p) => {
    const out = await loadConfig(p);
    assert.equal(out.servers[0].timeoutMs, 1234);
  });
});

test('loadConfig: fails clearly on missing servers field', async () => {
  await withTempFile('miss.json', JSON.stringify({ foo: 'bar' }), async (p) => {
    await assert.rejects(() => loadConfig(p), /missing required field "servers"/);
  });
});

test('loadConfig: fails clearly on missing name', async () => {
  await withTempFile(
    'noname.json',
    JSON.stringify({ servers: [{ transport: 'stdio', command: 'node' }] }),
    async (p) => {
      await assert.rejects(() => loadConfig(p), /missing required field "name"/);
    },
  );
});

test('loadConfig: rejects unknown transport', async () => {
  await withTempFile(
    'badt.json',
    JSON.stringify({ servers: [{ name: 'x', transport: 'carrier-pigeon' }] }),
    async (p) => {
      await assert.rejects(() => loadConfig(p), /transport/);
    },
  );
});

test('loadConfig: stdio requires command', async () => {
  await withTempFile(
    'nocmd.json',
    JSON.stringify({ servers: [{ name: 'x', transport: 'stdio' }] }),
    async (p) => {
      await assert.rejects(() => loadConfig(p), /requires "command"/);
    },
  );
});

test('loadConfig: http requires a valid url', async () => {
  await withTempFile(
    'badurl.json',
    JSON.stringify({ servers: [{ name: 'x', transport: 'http', url: 'not a url' }] }),
    async (p) => {
      await assert.rejects(() => loadConfig(p), /not a valid URL/);
    },
  );
});

test('loadConfig: rejects invalid JSON with a clear message', async () => {
  await withTempFile('busted.json', '{ this is not json', async (p) => {
    await assert.rejects(() => loadConfig(p), /invalid JSON/);
  });
});

test('loadConfig: rejects duplicate server names', async () => {
  const cfg = {
    servers: [
      { name: 'dup', transport: 'stdio', command: 'a' },
      { name: 'dup', transport: 'stdio', command: 'b' },
    ],
  };
  await withTempFile('dup.json', JSON.stringify(cfg), async (p) => {
    await assert.rejects(() => loadConfig(p), /duplicate server name/);
  });
});

test('validateConfig: rejects empty servers array', () => {
  assert.throws(() => validateConfig({ servers: [] }), /at least one entry/);
});
