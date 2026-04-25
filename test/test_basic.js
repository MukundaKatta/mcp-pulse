'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { Store } = require('../src/store');
const { classify, renderTable, humanAgo } = require('../src/render');
const { normalize } = require('../src/config');
const { probeServer } = require('../src/probe');

test('store: records ok and down probes', async (t) => {
  const tmp = path.join(os.tmpdir(), `mcp-store-${Date.now()}.jsonl`);
  t.after(async () => { try { await fs.unlink(tmp); } catch (_) {} });
  const store = new Store(tmp);
  await store.load();
  const a = store.recordProbe('foo', { ok: true, latencyMs: 12 });
  assert.strictEqual(a.failStreak, 0);
  assert.strictEqual(a.p50, 12);
  const b = store.recordProbe('foo', { ok: false, latencyMs: null, error: 'boom' });
  assert.strictEqual(b.failStreak, 1);
  const c = store.recordProbe('foo', { ok: false, error: 'boom2' });
  assert.strictEqual(c.failStreak, 2);
  await store.save();
  const reloaded = new Store(tmp);
  await reloaded.load();
  const d = reloaded.recordProbe('foo', { ok: true, latencyMs: 20 });
  assert.strictEqual(d.failStreak, 0);
});

test('classify: returns expected status labels', () => {
  assert.strictEqual(classify({ ok: true, latencyMs: 50 }, { p95: 50 }, { slowMs: 1000 }), 'ok');
  assert.strictEqual(classify({ ok: true, latencyMs: 1500 }, { p95: 1500 }, { slowMs: 1000 }), 'slow');
  assert.strictEqual(classify({ ok: false, latencyMs: null }, { p95: null, lastOk: '2026-01-01' }, {}), 'down');
  assert.strictEqual(classify({ ok: false, latencyMs: null }, { p95: null, lastOk: null }, {}), 'unknown');
});

test('renderTable: produces non-empty fixed-width text', () => {
  const out = renderTable([
    { name: 'a', status: 'ok',   latencyMs: 10,  p95: 12,  lastOk: new Date().toISOString(), failStreak: 0 },
    { name: 'b', status: 'down', latencyMs: null, p95: null, lastOk: null, failStreak: 4 },
  ]);
  assert.match(out, /NAME/);
  assert.match(out, /STATUS/);
  assert.match(out, /down/);
});

test('humanAgo: returns reasonable strings', () => {
  assert.strictEqual(humanAgo(new Date().toISOString()), 'just now');
  const oneMinAgo = new Date(Date.now() - 60_000).toISOString();
  assert.match(humanAgo(oneMinAgo), /(1m|60s) ago/);
});

test('config.normalize: parses claude-style mcpServers', () => {
  const parsed = {
    mcpServers: {
      foo: { command: 'node', args: ['x.js'] },
      bar: { url: 'http://localhost:9000/mcp', type: 'sse' },
      bad: { what: 'is this' },
    },
  };
  const out = normalize(parsed, 'claude');
  assert.strictEqual(out.servers.foo.transport, 'stdio');
  assert.strictEqual(out.servers.bar.transport, 'sse');
  assert.ok(!('bad' in out.servers));
});

test('probeServer: stdio probe succeeds against the bundled fake server', async () => {
  const result = await probeServer('fake', {
    transport: 'stdio',
    command: 'node',
    args: [path.join(__dirname, '..', 'examples', 'fake-mcp-stdio.js')],
  }, { timeoutMs: 5000 });
  assert.strictEqual(result.ok, true, result.error || '');
  assert.strictEqual(typeof result.latencyMs, 'number');
});

test('probeServer: returns ok=false on bad command without throwing', async () => {
  const result = await probeServer('nope', {
    transport: 'stdio',
    command: 'this-binary-does-not-exist-xyz',
    args: [],
  }, { timeoutMs: 1500 });
  assert.strictEqual(result.ok, false);
  assert.ok(result.error);
});
