/**
 * End-to-end: spawn the CLI binary itself (via `tsx`) and assert that every
 * non-interactive subcommand reaches a clean exit. This is the "smoke test
 * lane" — if `apps/cli/src/index.ts` can't even import without crashing, this
 * suite catches it before users ever see "Cannot find module 'inquirer'".
 *
 * History: Round 9 caught a regression where `commands/config.ts` eagerly
 * `import inquirer from 'inquirer'` at module load time. Because every CLI
 * subcommand transitively imports `commands/config.ts` through `index.ts`,
 * that single import broke `--help`, `--version`, `plugins list`, and
 * `status` — even though `config` was the only command that actually needed
 * inquirer. The fix was to drop inquirer in favour of a zero-dep readline
 * wizard, and *this* test exists so the next maintainer who adds an
 * "innocent" top-level dep gets the same loud failure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import * as path from 'node:path';

const REPO = path.resolve(__dirname, '..', '..');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
const CLI = path.join(REPO, 'apps', 'cli', 'src', 'index.ts');

interface RunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], stdin?: string, timeoutMs = 15_000): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`CLI run timed out after ${timeoutMs}ms; stderr: ${stderr.slice(0, 400)}`));
    }, timeoutMs);
    child.on('exit', code => {
      clearTimeout(killTimer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
    if (stdin !== undefined) {
      child.stdin.write(stdin);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

test('CLI: --help imports cleanly and prints command list', async () => {
  const r = await runCli(['--help']);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /Usage: openhand/);
  assert.match(r.stdout, /chat \[options\]/);
  assert.match(r.stdout, /plugins <sub>/);
  assert.match(r.stdout, /status/);
});

test('CLI: --version prints semver from package.json', async () => {
  const r = await runCli(['--version']);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /\b0\.\d+\.\d+\b/);
});

test('CLI: status reports provider + sandbox + plugins', async () => {
  const r = await runCli(['status']);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /OpenHand — status/);
  assert.match(r.stdout, /Provider/);
  assert.match(r.stdout, /Sandbox policy/);
  assert.match(r.stdout, /Plugins \(\d+\)/);
});

test('CLI: plugins list completes (no plugins is a valid state)', async () => {
  const r = await runCli(['plugins', 'list']);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  // "no plugins found" or a plugin listing — either is fine, just not a crash.
  assert.match(r.stdout, /plugin/);
});

test('CLI: chat REPL accepts /help and /exit from piped stdin', async () => {
  const r = await runCli(['chat'], '/help\n/exit\n');
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
  assert.equal(r.stderr, '');
  assert.match(r.stdout, /OpenHand REPL/);
  assert.match(r.stdout, /Available commands/);
  assert.match(r.stdout, /\/exit/);
  assert.match(r.stdout, /bye/);
});
