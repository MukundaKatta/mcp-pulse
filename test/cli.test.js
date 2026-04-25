// Smoke test for the CLI: runs `node src/cli.js --help` and asserts the
// output advertises the expected subcommands.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'src', 'cli.js');

function runCli(args, { timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`cli timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref?.();
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (e) => { clearTimeout(timer); reject(e); });
    child.on('exit', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

test('cli: --help exits 0 and lists watch + check subcommands', async () => {
  const { code, stdout } = await runCli(['--help']);
  assert.equal(code, 0);
  assert.match(stdout, /watch/);
  assert.match(stdout, /check/);
});

test('cli: --version exits 0 and prints a version string', async () => {
  const { code, stdout } = await runCli(['--version']);
  assert.equal(code, 0);
  assert.match(stdout, /^\d+\.\d+\.\d+/);
});

test('cli: unknown subcommand exits non-zero', async () => {
  const { code, stderr } = await runCli(['nonsense']);
  assert.notEqual(code, 0);
  assert.match(stderr, /unknown command/);
});

test('cli: check without config path exits non-zero', async () => {
  const { code, stderr } = await runCli(['check']);
  assert.notEqual(code, 0);
  assert.match(stderr, /missing <config\.json>/);
});
