'use strict';

// Programmatic watch loop. Calls checkOnce on an interval and prints
// only state changes (down -> ok, ok -> down). Useful as a building
// block for a Slack or webhook notifier.

const path = require('path');
const { checkOnce } = require('../src');

const CONFIG_PATH = path.join(__dirname, 'local-mcps.json');
const INTERVAL_MS = 30_000;

const lastStatus = new Map();

async function tick() {
  const rows = await checkOnce({
    configPath: CONFIG_PATH,
    storePath: path.join(__dirname, '..', '.tmp-watch-history.jsonl'),
    timeoutMs: 3000,
  });
  for (const r of rows) {
    const prev = lastStatus.get(r.name);
    if (prev !== r.status) {
      console.log(`[${new Date().toISOString()}] ${r.name}: ${prev || 'init'} -> ${r.status}`);
      lastStatus.set(r.name, r.status);
    }
  }
}

(async () => {
  console.log('mcp-pulse watch-loop demo - Ctrl+C to stop');
  await tick();
  setInterval(() => { tick().catch((e) => console.error('tick error:', e.message)); }, INTERVAL_MS);
})();
