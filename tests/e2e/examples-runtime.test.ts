/**
 * End-to-end: actually execute every shipped example with `tsx` and assert
 * each one exits 0, writes the expected fingerprint to stdout, and emits no
 * stderr. The README and the landing page both promise "git clone, run, see
 * an agent reply" with no API key — this test enforces that promise.
 *
 * Each example runs with a hard 30s ceiling. The only one that intentionally
 * touches the network is `rss-digest-agent.ts`; if the network is down it
 * may print a warning to stderr — we tolerate the substring "ENOTFOUND" /
 * "fetch failed" but still require exit 0 (the example owns its fallback).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
}

function runExample(file: string, timeoutMs = 30_000): Promise<RunResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [path.join('examples', file)], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`example ${file} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('exit', code => {
      clearTimeout(killTimer);
      resolve({
        exitCode: code ?? -1,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });
  });
}

test('example: hello-world.ts → mock provider reply', async () => {
  const r = await runExample('hello-world.ts');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /\[provider\]/);
  assert.match(r.stdout, /Mock LLM/);
  assert.match(r.stdout, /\[done\]/);
});

test('example: agent-shell-loop.ts → multi-turn loop terminates', async () => {
  const r = await runExample('agent-shell-loop.ts');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /\[demo\] provider=/);
  assert.match(r.stdout, /loop finished after \d+ turns/);
});

test('example: shell-automation.ts → sandbox enforces allow/deny', async () => {
  const r = await runExample('shell-automation.ts');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /\[ok\].*ls \/tmp/);
  assert.match(r.stdout, /\[deny\].*rm -rf/);
  assert.match(r.stdout, /command_not_allowed|arg_shell_metachars|path_outside_roots/);
});

test('example: ollama-local.ts → falls back to mock when daemon absent', async () => {
  const r = await runExample('ollama-local.ts');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  // Either we see a real ollama reply (label includes "Ollama") or the
  // documented mock fallback. The example is allowed to do either.
  assert.match(r.stdout, /(Ollama|mock|Mock)/);
});

test('example: rss-digest-agent.ts → runs even when offline', async () => {
  const r = await runExample('rss-digest-agent.ts');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  // We don't assert stderr is empty here: the RSS endpoint is the only
  // example that hits the network, and a flaky test box is allowed to
  // surface a transient warning. The example must still exit 0 — that's
  // the contract.
  assert.match(r.stdout, /\[rss\] feed=/);
});
