'use strict';

const { probeServer } = require('./probe');
const { loadConfig } = require('./config');
const { Store } = require('./store');
const { renderTable, classify } = require('./render');

/**
 * Run a single health check pass over all servers in the loaded config.
 *
 * @param {object} opts
 * @param {string} [opts.configPath] - Path to a custom config file. If omitted, the default discovery is used.
 * @param {string} [opts.storePath]  - Path to the JSONL history file.
 * @param {number} [opts.slowMs]     - Latency threshold (ms) above which a server is "slow".
 * @param {number} [opts.timeoutMs]  - Per-probe timeout in ms.
 * @returns {Promise<Array>} List of result records.
 */
async function checkOnce({ configPath, storePath, slowMs = 1000, timeoutMs = 5000 } = {}) {
  const config = await loadConfig(configPath);
  const store = new Store(storePath);
  await store.load();

  const results = [];
  const names = Object.keys(config.servers);
  await Promise.all(
    names.map(async (name) => {
      const spec = config.servers[name];
      const probe = await probeServer(name, spec, { timeoutMs });
      const history = store.recordProbe(name, probe);
      results.push({
        name,
        transport: spec.transport,
        ...probe,
        ...history,
        status: classify(probe, history, { slowMs }),
      });
    })
  );
  await store.save();
  // sort by name so the table is stable across runs
  results.sort((a, b) => a.name.localeCompare(b.name));
  return results;
}

/**
 * Convenience: run a check and return a pretty-printed table string.
 */
async function checkAndRender(opts = {}) {
  const rows = await checkOnce(opts);
  return { rows, table: renderTable(rows) };
}

module.exports = {
  checkOnce,
  checkAndRender,
  // re-exports so library users can compose pieces themselves
  probeServer,
  loadConfig,
  Store,
  renderTable,
  classify,
};
