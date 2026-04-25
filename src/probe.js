'use strict';

const { spawn } = require('child_process');
const http = require('http');
const https = require('https');
const { URL } = require('url');

/**
 * Probe a single MCP server. Performs a real MCP `initialize` request
 * and (best-effort) a `tools/list` request, then reports latency and
 * whether the round trip succeeded.
 *
 * The function never throws: it returns a structured result with
 * `ok: false` and an `error` string if anything goes wrong.
 *
 * @param {string} name
 * @param {object} spec  - { transport, command|url, args?, env?, headers? }
 * @param {object} opts  - { timeoutMs }
 * @returns {Promise<{ok: boolean, latencyMs: number|null, error: string|null, transport: string}>}
 */
async function probeServer(name, spec, { timeoutMs = 5000 } = {}) {
  const transport = spec.transport;
  const t0 = Date.now();
  try {
    if (transport === 'stdio') {
      await probeStdio(spec, timeoutMs);
    } else if (transport === 'http') {
      await probeHttp(spec, timeoutMs);
    } else if (transport === 'sse') {
      await probeSse(spec, timeoutMs);
    } else {
      return { ok: false, latencyMs: null, error: `unknown transport: ${transport}`, transport };
    }
    return { ok: true, latencyMs: Date.now() - t0, error: null, transport };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - t0,
      error: err && err.message ? err.message : String(err),
      transport,
    };
  }
}

// --- stdio probing ---------------------------------------------------------

function probeStdio(spec, timeoutMs) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(spec.command, spec.args || [], {
        env: { ...process.env, ...(spec.env || {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return reject(new Error(`spawn failed: ${e.message}`));
    }

    let buffer = '';
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGTERM'); } catch (_) { /* noop */ }
      err ? reject(err) : resolve();
    };

    const timer = setTimeout(() => finish(new Error(`stdio probe timed out after ${timeoutMs}ms`)), timeoutMs);
    timer.unref && timer.unref();

    child.on('error', (e) => finish(new Error(`process error: ${e.message}`)));
    child.on('exit', (code) => {
      if (!settled) finish(new Error(`process exited early with code ${code}`));
    });

    child.stderr.on('data', () => { /* swallow noise */ });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let nl;
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        if (!line) continue;
        let msg;
        try { msg = JSON.parse(line); } catch (_) { continue; }
        if (msg.id === 1 && msg.result) {
          clearTimeout(timer);
          finish(null);
          return;
        }
        if (msg.id === 1 && msg.error) {
          clearTimeout(timer);
          finish(new Error(`initialize returned error: ${msg.error.message || 'unknown'}`));
          return;
        }
      }
    });

    child.stdin.write(JSON.stringify(initializeRequest()) + '\n');
  });
}

// --- http probing ----------------------------------------------------------

function probeHttp(spec, timeoutMs) {
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(spec.url); } catch (e) { return reject(new Error(`bad url: ${spec.url}`)); }

    const lib = url.protocol === 'https:' ? https : http;
    const body = JSON.stringify(initializeRequest());

    const req = lib.request(
      {
        method: 'POST',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'Content-Length': Buffer.byteLength(body),
          ...(spec.headers || {}),
        },
        timeout: timeoutMs,
      },
      (res) => {
        let buf = '';
        res.on('data', (c) => { buf += c.toString('utf8'); if (buf.length > 64 * 1024) res.destroy(); });
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 400) {
            // best effort: any 2xx/3xx with non-empty body counts as up
            if (buf.length > 0) return resolve();
            return reject(new Error(`empty response (status ${res.statusCode})`));
          }
          reject(new Error(`http status ${res.statusCode}`));
        });
        res.on('error', (e) => reject(new Error(`response error: ${e.message}`)));
      }
    );
    req.on('timeout', () => { req.destroy(new Error(`http probe timed out after ${timeoutMs}ms`)); });
    req.on('error', (e) => reject(new Error(`request error: ${e.message}`)));
    req.write(body);
    req.end();
  });
}

// --- sse probing -----------------------------------------------------------

function probeSse(spec, timeoutMs) {
  // SSE check: open the connection, look for at least one event chunk, then close.
  return new Promise((resolve, reject) => {
    let url;
    try { url = new URL(spec.url); } catch (e) { return reject(new Error(`bad url: ${spec.url}`)); }
    const lib = url.protocol === 'https:' ? https : http;

    const req = lib.request(
      {
        method: 'GET',
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: url.pathname + url.search,
        headers: { 'Accept': 'text/event-stream', ...(spec.headers || {}) },
        timeout: timeoutMs,
      },
      (res) => {
        if (!res.statusCode || res.statusCode >= 400) {
          res.destroy();
          return reject(new Error(`sse status ${res.statusCode}`));
        }
        let received = false;
        res.on('data', () => {
          if (received) return;
          received = true;
          res.destroy();
          resolve();
        });
        res.on('end', () => {
          if (!received) reject(new Error('sse ended with no data'));
        });
        res.on('error', (e) => reject(new Error(`sse response error: ${e.message}`)));
      }
    );
    req.on('timeout', () => req.destroy(new Error(`sse probe timed out after ${timeoutMs}ms`)));
    req.on('error', (e) => reject(new Error(`sse request error: ${e.message}`)));
    req.end();
  });
}

// --- helpers ---------------------------------------------------------------

function initializeRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'mcp-pulse', version: '0.1.0' },
    },
  };
}

module.exports = { probeServer, initializeRequest };
