#!/usr/bin/env node
'use strict';

// A trivial fake MCP server over stdio. Responds to `initialize` with a
// minimal valid result. Useful for testing mcp-pulse without
// installing a real MCP server.

let buffer = '';

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  let nl;
  while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim();
    buffer = buffer.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (_) { continue; }
    if (msg.method === 'initialize') {
      respond(msg.id, {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'fake-stdio', version: '0.0.1' },
      });
    } else if (msg.method === 'tools/list') {
      respond(msg.id, { tools: [] });
    }
  }
});

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\n');
}
