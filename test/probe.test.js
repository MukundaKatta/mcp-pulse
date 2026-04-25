// Tests for probeServer.
//
// We spin up tiny inline Node processes via `node -e` so the test stays
// dependency-free and self-contained. Two scenarios:
//   1. A fake server that responds to `initialize` -> probe should succeed.
//   2. A fake server that never responds         -> probe should time out.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { probeServer } from '../src/probe.js';

// Inline server: reads JSON-RPC lines on stdin, replies to `initialize`
// with a valid result, ignores everything else.
const FAKE_RESPONDER = `
let buf = '';
process.stdin.on('data', (chunk) => {
  buf += chunk.toString('utf8');
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    if (msg.method === 'initialize') {
      const reply = {
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'fake', version: '0.0.1' },
        },
      };
      process.stdout.write(JSON.stringify(reply) + '\\n');
    }
  }
});
// keep alive until parent kills us
setInterval(() => {}, 60_000);
`;

// Inline server that just sleeps forever; never replies.
const FAKE_SILENT = `
setInterval(() => {}, 60_000);
`;

test('probeServer: stdio probe succeeds against a responsive fake', async () => {
  const result = await probeServer(
    {
      name: 'fake',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', FAKE_RESPONDER],
    },
    { timeoutMs: 5000 },
  );
  assert.equal(result.ok, true, `probe should be ok, got error: ${result.error}`);
  assert.equal(typeof result.latencyMs, 'number');
  assert.ok(result.latencyMs >= 0, 'latencyMs should be non-negative');
});

test('probeServer: stdio probe times out when server never replies', async () => {
  const result = await probeServer(
    {
      name: 'silent',
      transport: 'stdio',
      command: process.execPath,
      args: ['-e', FAKE_SILENT],
    },
    { timeoutMs: 250 },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /timed out/);
});

test('probeServer: stdio probe reports failure for missing binary', async () => {
  const result = await probeServer(
    {
      name: 'nope',
      transport: 'stdio',
      command: '/this/binary/definitely/does/not/exist-xyz',
      args: [],
    },
    { timeoutMs: 1000 },
  );
  assert.equal(result.ok, false);
  assert.ok(result.error, 'should have an error message');
});

test('probeServer: rejects unknown transport without throwing', async () => {
  const result = await probeServer(
    { name: 'weird', transport: 'carrier-pigeon' },
    { timeoutMs: 500 },
  );
  assert.equal(result.ok, false);
  assert.match(result.error, /unknown transport/);
});
