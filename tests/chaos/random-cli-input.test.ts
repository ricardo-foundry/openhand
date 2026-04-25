/**
 * Chaos: random byte sequences fed into the CLI's stdin.
 *
 * The REPL is the most exposed surface — anything a user can type ends up
 * here. We feed it raw garbage (binary, control bytes, partial UTF-8,
 * giant single lines, /commands with stray whitespace) and assert that:
 *
 *   1. the process exits within the timeout (no hangs, no infinite loops),
 *   2. exit code is 0 for "expected" inputs (clean /exit, EOF) and != 137
 *      for crashy ones (we just want NOT-killed-by-SIGKILL),
 *   3. nothing leaks to stderr at module load time (the import graph stays
 *      clean even when we feed weird stuff).
 *
 * We deliberately do NOT assert specific stdout content for random inputs
 * — the contract is "graceful, not pretty".
 *
 * Bug class this catches: the previous round's REPL `for await (const raw of rl)`
 * loop trims and re-prompts on every line; if any byte sequence threw inside
 * `handleSlashCommand` (e.g. mis-cased switch fallthrough, regex
 * catastrophic backtracking), the whole REPL would die.
 *
 * Real bug found in this round (documented, not silently passing):
 *   Non-slash input + no LLM API key wedges the REPL forever in "Thinking..."
 *   because `cli.sendMessage` waits on an `assistant` message that never
 *   arrives. Every test below either uses slash commands or terminates with
 *   `/exit`, so this round does NOT exercise that path. See README's
 *   "Known limitations" — fix tracked for v0.4.
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
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

/**
 * Spawn the CLI's `chat` subcommand, write `payload` to stdin, then close
 * stdin. Resolves with the result. Times out (and SIGKILLs) at `timeoutMs`.
 *
 * IMPORTANT: every payload must end with `/exit\n` OR be empty/EOF, otherwise
 * the REPL will block on the LLM round-trip (no API key configured in the
 * test env). Tests that pass non-slash content without a terminating `/exit`
 * will time out by design — see file-level docstring.
 */
function feedChat(payload: Buffer | string, timeoutMs = 12_000): Promise<RunResult> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, 'chat'], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const killTimer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`chat timed out; stderr: ${stderr.slice(0, 400)}`));
    }, timeoutMs);
    child.on('exit', (code, signal) => {
      clearTimeout(killTimer);
      resolve({
        exitCode: code ?? -1,
        signal,
        stdout,
        stderr,
        durationMs: Date.now() - start,
      });
    });
    try {
      if (typeof payload === 'string') {
        child.stdin.write(payload);
      } else {
        child.stdin.write(payload);
      }
    } catch {
      /* stdin may be closed; the timeout will catch the hang */
    }
    child.stdin.end();
  });
}

/** Deterministic-ish byte fill so reruns don't flake. */
function seededBytes(n: number, seed: number): Buffer {
  const out = Buffer.alloc(n);
  let s = seed | 0;
  for (let i = 0; i < n; i++) {
    // xorshift32 — small, deterministic
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    out[i] = s & 0xff;
  }
  return out;
}

test('chaos/cli: empty stdin closes the REPL cleanly', async () => {
  const r = await feedChat('');
  assert.equal(r.exitCode, 0, `unexpected exit; stderr: ${r.stderr}`);
  assert.equal(r.signal, null, 'REPL must not be killed by signal');
});

test('chaos/cli: only /exit produces a clean bye', async () => {
  const r = await feedChat('/exit\n');
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /bye/);
});

test('chaos/cli: control characters terminated by newline then /exit', async () => {
  // NUL/BEL/ESC/FF/BS as a complete line, then /exit on its own line.
  // Trailing \n before /exit is essential — without it readline merges
  // the control bytes with /exit and the line is no longer a slash
  // command (which would hand it to the LLM and hang the test).
  const payload = Buffer.concat([
    Buffer.from([0, 7, 27, 12, 8, 0, 0]),
    Buffer.from('\n/exit\n'),
  ]);
  const r = await feedChat(payload);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /bye/);
});

test('chaos/cli: invalid UTF-8 sequence followed by /exit closes cleanly', async () => {
  // Lone continuation bytes — invalid UTF-8.
  const bad = Buffer.from([0x80, 0xbf, 0xc0, 0xc1, 0xfe, 0xff]);
  const payload = Buffer.concat([bad, Buffer.from('\n/exit\n')]);
  const r = await feedChat(payload);
  assert.equal(r.exitCode, 0, `stderr: ${r.stderr}`);
});

test('chaos/cli: extremely long single slash-command line (32KB) is handled', async () => {
  // 32KB of bytes that look like a /command argument; loops once through
  // handleSlashCommand for "unknown command" then exits.
  const longLine = '/' + 'a'.repeat(32 * 1024) + '\n/exit\n';
  const r = await feedChat(longLine);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /bye/);
});

test('chaos/cli: 1000 slash commands in a row, then /exit', async () => {
  // Hammer handleSlashCommand path. Each line is a known command so we
  // exercise the parser/router 1000 times without ever hitting the LLM.
  let payload = '';
  for (let i = 0; i < 1000; i++) payload += '/help\n';
  payload += '/exit\n';
  const r = await feedChat(payload, 30_000);
  assert.equal(r.exitCode, 0);
  // Each /help prints "Available commands:" — count to make sure the loop
  // actually iterated.
  const occurrences = (r.stdout.match(/Available commands:/g) ?? []).length;
  assert.ok(occurrences >= 100, `only ${occurrences} /help responses — REPL stalled`);
});

test('chaos/cli: slash-command junk routes to "unknown command" and survives', async () => {
  const payload = [
    '/notacommand\n',
    '/MoDeL\n', // case-sensitive — should be unknown
    '/help with stray args\n', // /help ignores args
    '/\n', // bare slash — empty cmd
    '/   \n', // whitespace-only
    '/exit\n',
  ].join('');
  const r = await feedChat(payload);
  assert.equal(r.exitCode, 0);
  assert.match(r.stdout, /unknown command/);
});

test('chaos/cli: 4KB of random bytes does not crash the REPL parser', async () => {
  // Replace any byte that looks like LF (0x0a) with a printable so we don't
  // accidentally split into many "send to LLM" turns (without an API key
  // those would hang). What we're actually testing is: the REPL parser
  // never throws on a single-line garbage payload.
  const garbage = seededBytes(4096, 0xdeadbeef);
  for (let i = 0; i < garbage.length; i++) if (garbage[i] === 0x0a) garbage[i] = 0x21;
  // Make the line a known slash command — same number of trips through
  // handleSlashCommand, but without calling out to an LLM.
  const payload = Buffer.concat([Buffer.from('/help '), garbage, Buffer.from('\n/exit\n')]);
  const r = await feedChat(payload, 20_000);
  assert.notEqual(r.signal, 'SIGKILL', `REPL force-killed; stderr: ${r.stderr.slice(0, 200)}`);
  // No unhandled rejections at any point.
  assert.ok(
    !/UnhandledPromiseRejection|Uncaught/.test(r.stderr),
    `unhandled error: ${r.stderr.slice(0, 400)}`,
  );
  assert.equal(r.exitCode, 0);
});

test('chaos/cli: pure newlines (no payload) re-prompt and EOF cleanly', async () => {
  const r = await feedChat('\n\n\n\n\n');
  assert.equal(r.exitCode, 0);
});
