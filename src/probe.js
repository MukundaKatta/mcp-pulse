// MCP server probing.
//
// Each probe sends a JSON-RPC `initialize` request and waits for the
// server's response. We measure wall-clock latency and report whether
// the round trip succeeded. The function never throws: failures come
// back as { ok: false, error }.

import { spawn } from 'node:child_process';

const PROTOCOL_VERSION = '2025-03-26';
const CLIENT_INFO = { name: 'mcp-pulse', version: '0.1.0' };

export async function probeServer(server, { timeoutMs } = {}) {
  if (!server || typeof server !== 'object') {
    return { ok: false, latencyMs: 0, error: 'probeServer: server must be an object' };
  }
  const limit = typeof timeoutMs === 'number' && timeoutMs > 0
    ? timeoutMs
    : (typeof server.timeoutMs === 'number' && server.timeoutMs > 0 ? server.timeoutMs : 5000);

  if (server.transport === 'stdio') {
    return probeStdio(server, limit);
  }
  if (server.transport === 'http') {
    return probeHttp(server, limit);
  }
  return { ok: false, latencyMs: 0, error: `unknown transport: ${server.transport}` };
}

function buildInitRequest() {
  return {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: CLIENT_INFO,
    },
  };
}

function probeStdio(server, timeoutMs) {
  return new Promise((resolve) => {
    const start = performanceNow();
    let child;
    try {
      child = spawn(server.command, server.args || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (e) {
      return resolve({
        ok: false,
        latencyMs: 0,
        error: `spawn failed: ${e.message}`,
      });
    }

    let buffer = '';
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { child.kill('SIGTERM'); } catch (_e) { /* noop */ }
      // give it a moment, then SIGKILL if still alive
      setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_e) { /* noop */ }
      }, 250).unref();
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        latencyMs: Math.round(performanceNow() - start),
        error: `stdio probe timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);
    timer.unref?.();

    child.on('error', (e) => {
      finish({
        ok: false,
        latencyMs: Math.round(performanceNow() - start),
        error: `process error: ${e.message}`,
      });
    });

    child.on('exit', (code, signal) => {
      if (done) return;
      finish({
        ok: false,
        latencyMs: Math.round(performanceNow() - start),
        error: `process exited early (code=${code ?? 'null'} signal=${signal ?? 'null'})`,
      });
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
        try { msg = JSON.parse(line); } catch (_e) { continue; }
        if (msg && msg.id === 1 && msg.result) {
          finish({
            ok: true,
            latencyMs: Math.round(performanceNow() - start),
            error: null,
            capabilities: msg.result.capabilities ?? null,
          });
          return;
        }
        if (msg && msg.id === 1 && msg.error) {
          finish({
            ok: false,
            latencyMs: Math.round(performanceNow() - start),
            error: `initialize error: ${msg.error.message ?? 'unknown'}`,
          });
          return;
        }
      }
    });

    try {
      child.stdin.write(JSON.stringify(buildInitRequest()) + '\n');
    } catch (e) {
      finish({
        ok: false,
        latencyMs: Math.round(performanceNow() - start),
        error: `stdin write failed: ${e.message}`,
      });
    }
  });
}

async function probeHttp(server, timeoutMs) {
  const start = performanceNow();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  timer.unref?.();
  try {
    const res = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(buildInitRequest()),
      signal: ac.signal,
    });
    const latencyMs = Math.round(performanceNow() - start);
    if (!res.ok) {
      return { ok: false, latencyMs, error: `http status ${res.status}` };
    }
    let payload = null;
    try {
      payload = await res.json();
    } catch (_e) {
      // Non-JSON body still counts as a successful round trip;
      // some servers reply with SSE framing for `initialize`.
      return { ok: true, latencyMs, error: null, capabilities: null };
    }
    if (payload && payload.error) {
      return { ok: false, latencyMs, error: `initialize error: ${payload.error.message ?? 'unknown'}` };
    }
    return {
      ok: true,
      latencyMs,
      error: null,
      capabilities: payload?.result?.capabilities ?? null,
    };
  } catch (e) {
    const latencyMs = Math.round(performanceNow() - start);
    if (e?.name === 'AbortError') {
      return { ok: false, latencyMs, error: `http probe timed out after ${timeoutMs}ms` };
    }
    return { ok: false, latencyMs, error: `http error: ${e.message}` };
  } finally {
    clearTimeout(timer);
  }
}

function performanceNow() {
  // Node 20+ exposes globalThis.performance.now()
  return globalThis.performance?.now?.() ?? Date.now();
}
