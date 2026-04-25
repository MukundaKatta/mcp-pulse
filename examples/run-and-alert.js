'use strict';

// Run a one-shot health check, print a table, and exit non-zero if anything is down.
// Wire this into a cron job, a CI step, or a launchd timer.

const path = require('path');
const { checkOnce } = require('../src');
const { renderTable } = require('../src/render');

(async () => {
  const rows = await checkOnce({
    configPath: path.join(__dirname, 'local-mcps.json'),
    storePath: path.join(__dirname, '..', '.tmp-history.jsonl'),
    slowMs: 1000,
    timeoutMs: 3000,
  });
  console.log(renderTable(rows));

  const downCount = rows.filter((r) => r.status === 'down').length;
  if (downCount > 0) {
    console.error(`\n${downCount} server(s) DOWN`);
    process.exit(1);
  }
  console.log('\nall green');
})();
