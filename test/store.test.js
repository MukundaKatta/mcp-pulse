// Tests for RollingStore: ring-buffer behaviour and derived metrics.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RollingStore, percentile } from '../src/store.js';

test('RollingStore: records samples and reports uptime', () => {
  const store = new RollingStore({ window: 10 });
  for (let i = 0; i < 8; i++) {
    store.record('foo', { ok: true, latencyMs: 10 + i });
  }
  for (let i = 0; i < 2; i++) {
    store.record('foo', { ok: false, error: 'boom' });
  }
  const s = store.summary('foo');
  assert.equal(s.samples, 10);
  assert.equal(s.uptimePct, 80);
  assert.equal(s.lastOk, false);
  assert.equal(s.lastError, 'boom');
});

test('RollingStore: enforces window size by dropping oldest', () => {
  const store = new RollingStore({ window: 3 });
  store.record('bar', { ok: true, latencyMs: 1 });
  store.record('bar', { ok: true, latencyMs: 2 });
  store.record('bar', { ok: true, latencyMs: 3 });
  store.record('bar', { ok: false, error: 'late' });
  const samples = store.samples('bar');
  assert.equal(samples.length, 3);
  // oldest (latencyMs:1) should have been evicted
  assert.deepEqual(samples.map((s) => s.latencyMs), [2, 3, null]);
});

test('RollingStore: p50 and p95 reflect successful latencies only', () => {
  const store = new RollingStore({ window: 100 });
  // Successful samples: 10..100ms
  const lats = [];
  for (let i = 1; i <= 10; i++) {
    const v = i * 10;
    lats.push(v);
    store.record('baz', { ok: true, latencyMs: v });
  }
  // A failure shouldn't pollute latency percentiles.
  store.record('baz', { ok: false, error: 'x' });
  const s = store.summary('baz');
  assert.equal(s.samples, 11);
  assert.equal(s.p50, percentile(lats, 50));
  assert.equal(s.p95, percentile(lats, 95));
  // Sanity: p50 of 10..100 is 50, p95 is 100.
  assert.equal(s.p50, 50);
  assert.equal(s.p95, 100);
});

test('RollingStore: summary() returns null for unknown server', () => {
  const store = new RollingStore({ window: 5 });
  assert.equal(store.summary('missing'), null);
});

test('RollingStore: summaries() returns rows sorted by name', () => {
  const store = new RollingStore({ window: 5 });
  store.record('zeta', { ok: true, latencyMs: 5 });
  store.record('alpha', { ok: true, latencyMs: 5 });
  store.record('mu', { ok: true, latencyMs: 5 });
  const rows = store.summaries();
  assert.deepEqual(rows.map((r) => r.name), ['alpha', 'mu', 'zeta']);
});

test('percentile: handles edge cases', () => {
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([42], 50), 42);
  assert.equal(percentile([1, 2, 3, 4], 100), 4);
});

test('RollingStore: validates input', () => {
  const store = new RollingStore({ window: 5 });
  assert.throws(() => store.record('', { ok: true }), /name must be/);
  assert.throws(() => store.record('a', null), /sample must be/);
  assert.throws(() => new RollingStore({ window: 0 }), /window/);
});
