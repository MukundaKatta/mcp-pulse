'use strict';

/**
 * Decide an overall status label for a server given its latest probe and history.
 *
 * @param {{ok:boolean, latencyMs:number|null}} probe
 * @param {{p95:number|null, lastOk:string|null}} history
 * @param {{slowMs:number}} opts
 * @returns {'ok'|'slow'|'down'|'unknown'}
 */
function classify(probe, history, { slowMs = 1000 } = {}) {
  if (!probe || (probe.ok === false && probe.latencyMs === null && !history.lastOk)) {
    return 'unknown';
  }
  if (probe.ok === false) return 'down';
  const p95 = history.p95;
  if (p95 != null && p95 > slowMs) return 'slow';
  if (typeof probe.latencyMs === 'number' && probe.latencyMs > slowMs) return 'slow';
  return 'ok';
}

/**
 * Render a row list as a fixed-width text table.
 *
 * @param {Array<object>} rows
 * @returns {string}
 */
function renderTable(rows) {
  const headers = ['NAME', 'STATUS', 'LATENCY', 'P95', 'LAST OK', 'FAILS'];
  const data = rows.map((r) => [
    r.name,
    r.status,
    r.latencyMs == null ? '-' : `${r.latencyMs}ms`,
    r.p95 == null ? '-' : `${r.p95}ms`,
    r.lastOk ? humanAgo(r.lastOk) : 'never',
    String(r.failStreak || 0),
  ]);
  const all = [headers, ...data];
  const widths = headers.map((_, i) => Math.max(...all.map((row) => String(row[i]).length)));
  const lines = all.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  '));
  return lines.join('\n');
}

function humanAgo(iso) {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  if (Number.isNaN(diff) || diff < 0) return iso;
  if (diff < 5_000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return `${Math.floor(diff / 86_400_000)}d ago`;
}

module.exports = { classify, renderTable, humanAgo };
