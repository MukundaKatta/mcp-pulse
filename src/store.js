// Rolling per-server sample store.
//
// Each server gets a fixed-size ring buffer of recent probe samples.
// The store computes derived metrics on demand: uptime%, p50, p95, and
// the last error message. Pure in-memory; no I/O.

export class RollingStore {
  constructor({ window = 100 } = {}) {
    if (!Number.isInteger(window) || window <= 0) {
      throw new Error('RollingStore: window must be a positive integer');
    }
    this.window = window;
    this.byName = new Map();
  }

  record(name, sample) {
    if (typeof name !== 'string' || !name.length) {
      throw new Error('RollingStore.record: name must be a non-empty string');
    }
    if (!sample || typeof sample !== 'object') {
      throw new Error('RollingStore.record: sample must be an object');
    }
    let buf = this.byName.get(name);
    if (!buf) {
      buf = [];
      this.byName.set(name, buf);
    }
    const entry = {
      ts: typeof sample.ts === 'number' ? sample.ts : Date.now(),
      ok: !!sample.ok,
      latencyMs: Number.isFinite(sample.latencyMs) ? sample.latencyMs : null,
      error: sample.error ?? null,
    };
    buf.push(entry);
    if (buf.length > this.window) {
      // Drop oldest samples to stay within the window.
      buf.splice(0, buf.length - this.window);
    }
  }

  // Return the raw samples for `name` (a copy so callers can't mutate state).
  samples(name) {
    const buf = this.byName.get(name);
    return buf ? buf.slice() : [];
  }

  // Compute derived metrics for one server.
  // Returns null if there are no samples yet.
  summary(name) {
    const buf = this.byName.get(name);
    if (!buf || buf.length === 0) return null;

    const total = buf.length;
    let okCount = 0;
    const okLatencies = [];
    let lastError = null;

    for (const s of buf) {
      if (s.ok) {
        okCount++;
        if (typeof s.latencyMs === 'number') okLatencies.push(s.latencyMs);
      } else if (s.error) {
        lastError = s.error;
      }
    }

    const uptimePct = (okCount / total) * 100;
    const p50 = percentile(okLatencies, 50);
    const p95 = percentile(okLatencies, 95);

    return {
      name,
      samples: total,
      uptimePct,
      p50,
      p95,
      lastOk: buf[buf.length - 1].ok,
      lastError,
    };
  }

  // Convenience: summaries for every known server.
  summaries() {
    return [...this.byName.keys()]
      .map((n) => this.summary(n))
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}

// Standard nearest-rank percentile. Returns null if input is empty.
export function percentile(values, q) {
  if (!Array.isArray(values) || values.length === 0) return null;
  if (!Number.isFinite(q) || q < 0 || q > 100) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  if (q === 0) return sorted[0];
  const idx = Math.ceil((q / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
}
