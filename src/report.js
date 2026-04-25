// Render summary rows as either a plain ANSI table or JSON.
//
// The table is hand-laid out: column widths are computed from the data
// so we never depend on external table libraries.

const STATUS_OK = '●'; // filled circle
const STATUS_BAD = '✗'; // ballot X

const COLUMNS = [
  { key: 'name', label: 'name' },
  { key: 'status', label: 'status' },
  { key: 'uptime', label: 'uptime%' },
  { key: 'p50', label: 'p50ms' },
  { key: 'p95', label: 'p95ms' },
  { key: 'lastError', label: 'last_error' },
];

export function renderTable(summaries) {
  const rows = (summaries ?? []).map(toRow);
  const widths = COLUMNS.map((c) => c.label.length);
  for (const row of rows) {
    for (let i = 0; i < COLUMNS.length; i++) {
      const cell = row[COLUMNS[i].key] ?? '';
      if (cell.length > widths[i]) widths[i] = cell.length;
    }
  }

  const fmtRow = (row) =>
    COLUMNS.map((c, i) => String(row[c.key] ?? '').padEnd(widths[i])).join('  ');

  const header = COLUMNS.map((c, i) => c.label.padEnd(widths[i])).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');

  const body = rows.map(fmtRow).join('\n');
  return [header, sep, body].filter(Boolean).join('\n');
}

export function renderJson(summaries) {
  return JSON.stringify(summaries ?? [], null, 2);
}

function toRow(s) {
  return {
    name: s.name,
    status: s.lastOk ? STATUS_OK : STATUS_BAD,
    uptime: typeof s.uptimePct === 'number' ? s.uptimePct.toFixed(1) : '-',
    p50: s.p50 == null ? '-' : String(Math.round(s.p50)),
    p95: s.p95 == null ? '-' : String(Math.round(s.p95)),
    lastError: s.lastError ? truncate(s.lastError, 60) : '',
  };
}

function truncate(str, max) {
  if (str.length <= max) return str;
  return str.slice(0, max - 1) + '…';
}
