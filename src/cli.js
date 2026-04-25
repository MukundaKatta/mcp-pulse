#!/usr/bin/env node
'use strict';

const { checkOnce } = require('./index');
const { renderTable } = require('./render');

function parseArgs(argv) {
  const args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args.flags[key] = true;
      } else {
        args.flags[key] = next;
        i++;
      }
    } else {
      args._.push(a);
    }
  }
  return args;
}

function usage() {
  return [
    'mcp-pulse  -  monitor health of MCP servers',
    '',
    'Usage:',
    '  mcp-pulse check  [--config <path>] [--store <path>] [--slow <ms>] [--timeout <ms>] [--json]',
    '  mcp-pulse watch  [--interval <sec>] [other check options]',
    '  mcp-pulse help',
    '',
    'Options:',
    '  --config <path>   Custom config file (otherwise auto-discover)',
    '  --store  <path>   History file (default: ~/.mcp-pulse/history.jsonl)',
    '  --slow   <ms>     Latency threshold for "slow" status (default: 1000)',
    '  --timeout <ms>    Per-probe timeout (default: 5000)',
    '  --interval <sec>  Watch interval (default: 30)',
    '  --json            Print JSON instead of a table',
  ].join('\n');
}

async function runCheck(flags) {
  const opts = {
    configPath: flags.config || null,
    storePath: flags.store || null,
    slowMs: flags.slow ? Number(flags.slow) : 1000,
    timeoutMs: flags.timeout ? Number(flags.timeout) : 5000,
  };
  const rows = await checkOnce(opts);
  if (flags.json) {
    process.stdout.write(JSON.stringify(rows, null, 2) + '\n');
  } else {
    if (!rows.length) {
      console.error('no MCP servers found in any config. pass --config <path> or set up an MCP-compatible client first.');
      process.exitCode = 2;
      return;
    }
    process.stdout.write(renderTable(rows) + '\n');
  }
  if (rows.some((r) => r.status === 'down')) {
    process.exitCode = 1;
  }
}

async function runWatch(flags) {
  const interval = Math.max(2, Number(flags.interval || 30));
  let stopping = false;
  process.on('SIGINT', () => { stopping = true; console.log('\nstopping'); });

  while (!stopping) {
    process.stdout.write('c'); // clear screen
    process.stdout.write(`mcp-pulse watch  -  every ${interval}s  -  Ctrl+C to stop\n\n`);
    try {
      await runCheck(flags);
    } catch (e) {
      console.error('watch tick failed:', e.message);
    }
    if (stopping) break;
    await new Promise((r) => setTimeout(r, interval * 1000));
  }
}

async function main(argv) {
  const args = parseArgs(argv);
  const cmd = args._[0] || 'help';
  if (cmd === 'help' || args.flags.help) {
    console.log(usage());
    return;
  }
  if (cmd === 'check') return runCheck(args.flags);
  if (cmd === 'watch') return runWatch(args.flags);
  console.error(`unknown command: ${cmd}\n`);
  console.error(usage());
  process.exitCode = 64;
}

main(process.argv.slice(2)).catch((e) => {
  console.error('fatal:', e && e.stack ? e.stack : e);
  process.exitCode = 1;
});
