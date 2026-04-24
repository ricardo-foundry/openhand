/**
 * End-to-end: drive the REPL with fake stdin/stdout (no child_process needed —
 * `runRepl` is already decoupled from the process and accepts injectable
 * streams). We verify that /help + /exit produce the expected output and
 * that free-form lines flow through the injected `send()`.
 *
 * We intentionally exercise the `send` failure path too, because the REPL
 * promised to catch tool errors rather than propagating them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable, Writable } from 'node:stream';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import { runRepl } from '../../apps/cli/src/repl';

class MemoryOut extends Writable {
  chunks: string[] = [];
  override _write(chunk: Buffer | string, _enc: BufferEncoding, cb: (err?: Error | null) => void): void {
    this.chunks.push(chunk.toString());
    cb();
  }
  text(): string {
    return this.chunks.join('');
  }
}

function scriptedStdin(lines: string[]): Readable {
  // Readable.from yields each line as a chunk; readline handles newlines.
  return Readable.from(lines.map(l => l + '\n'));
}

test('REPL: /help prints command list and /exit terminates', { timeout: 10000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-e2e-repl-'));
  const cfgPath = path.join(dir, 'config.json');
  const out = new MemoryOut();
  const input = scriptedStdin(['/help', '/exit']);
  const sent: string[] = [];

  await runRepl({
    send: async (msg) => { sent.push(msg); },
    out,
    in: input as unknown as NodeJS.ReadStream,
    configPath: cfgPath,
  });

  const output = out.text();
  assert.match(output, /OpenHand REPL/);
  assert.match(output, /\/help/);
  assert.match(output, /\/exit/);
  assert.match(output, /bye/);
  assert.deepEqual(sent, []); // slash commands don't call send()
});

test('REPL: free-form line flows through send() and /save persists', { timeout: 10000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-e2e-repl-'));
  const cfgPath = path.join(dir, 'config.json');
  const out = new MemoryOut();
  const input = scriptedStdin(['hello world', '/model gpt-4o', '/save', '/exit']);
  const sent: string[] = [];

  await runRepl({
    send: async (msg) => { sent.push(msg); },
    out,
    in: input as unknown as NodeJS.ReadStream,
    configPath: cfgPath,
  });

  assert.deepEqual(sent, ['hello world']);
  const persisted = JSON.parse(await fs.readFile(cfgPath, 'utf-8'));
  assert.equal(persisted.llm.model, 'gpt-4o');
});

test('REPL: send() rejection is caught and reported, not propagated', { timeout: 10000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-e2e-repl-'));
  const cfgPath = path.join(dir, 'config.json');
  const out = new MemoryOut();
  const input = scriptedStdin(['boom', '/exit']);

  await runRepl({
    send: async () => { throw new Error('provider explode'); },
    out,
    in: input as unknown as NodeJS.ReadStream,
    configPath: cfgPath,
  });

  assert.match(out.text(), /provider explode/);
});
