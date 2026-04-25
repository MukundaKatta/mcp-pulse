'use strict';

const fs = require('fs').promises;
const path = require('path');
const os = require('os');

const DEFAULT_STORE = path.join(os.homedir(), '.mcp-health', 'history.jsonl');
const MAX_LATENCIES_KEPT = 50;

/**
 * Tiny JSONL-backed history store.
 *
 * Schema (one line per server):
 *   { name, lastOk, lastSeenStatus, failStreak, latencies: [ms,...] }
 *
 * Not thread-safe across processes; designed for one CLI process at a time.
 */
class Store {
  constructor(filePath = DEFAULT_STORE) {
    this.filePath = filePath;
    this.byName = new Map();
  }

  async load() {
    let raw;
    try {
      raw = await fs.readFile(this.filePath, 'utf8');
    } catch (e) {
      if (e.code === 'ENOENT') return;
      throw e;
    }
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const row = JSON.parse(trimmed);
        if (row && typeof row.name === 'string') {
          // last write wins on duplicate keys; we just keep the latest
          this.byName.set(row.name, normalizeRow(row));
        }
      } catch (_e) {
        // skip malformed lines
      }
    }
  }

  /**
   * Update history with a fresh probe outcome and return the updated record.
   */
  recordProbe(name, probe) {
    const prev = this.byName.get(name) || newRow(name);
    const next = { ...prev };
    if (probe.ok) {
      next.lastOk = nowIso();
      next.failStreak = 0;
      if (typeof probe.latencyMs === 'number') {
        next.latencies = [...next.latencies.slice(-(MAX_LATENCIES_KEPT - 1)), probe.latencyMs];
      }
    } else {
      next.failStreak = (prev.failStreak || 0) + 1;
    }
    next.lastSeenStatus = probe.ok ? 'ok' : 'down';
    next.lastError = probe.ok ? null : probe.error || 'unknown error';
    this.byName.set(name, next);
    return derived(next);
  }

  async save() {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const lines = Array.from(this.byName.values()).map((r) => JSON.stringify(r));
    await fs.writeFile(this.filePath, lines.join('\n') + (lines.length ? '\n' : ''), 'utf8');
  }
}

function newRow(name) {
  return {
    name,
    lastOk: null,
    lastSeenStatus: 'unknown',
    failStreak: 0,
    lastError: null,
    latencies: [],
  };
}

function normalizeRow(row) {
  return {
    ...newRow(row.name),
    ...row,
    latencies: Array.isArray(row.latencies) ? row.latencies.filter((n) => Number.isFinite(n)) : [],
  };
}

function derived(row) {
  const lats = row.latencies.slice().sort((a, b) => a - b);
  const p = (q) => (lats.length ? lats[Math.min(lats.length - 1, Math.floor(q * lats.length))] : null);
  return {
    lastOk: row.lastOk,
    failStreak: row.failStreak,
    p50: p(0.5),
    p95: p(0.95),
  };
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = { Store, DEFAULT_STORE };
