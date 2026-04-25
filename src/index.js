// Public programmatic entrypoint. Re-exports the pieces library users
// might compose without the CLI: probe, store, config.

export { probeServer } from './probe.js';
export { RollingStore, percentile } from './store.js';
export { loadConfig, validateConfig } from './config.js';
export { renderTable, renderJson } from './report.js';
