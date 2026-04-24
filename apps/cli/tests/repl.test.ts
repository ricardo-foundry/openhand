import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
  handleSlashCommand,
  loadConfig,
  saveConfig,
  DEFAULT_REPL_CONFIG,
  Spinner,
  SLASH_COMMANDS,
} from '../src/repl';

test('SLASH_COMMANDS exposes every documented command', () => {
  assert.deepEqual(
    [...SLASH_COMMANDS].sort(),
    ['/exit', '/help', '/model', '/reset', '/save'].sort(),
  );
});

test('/help returns the command listing', () => {
  const r = handleSlashCommand('/help', DEFAULT_REPL_CONFIG);
  assert.match(r.message ?? '', /\/help/);
  assert.match(r.message ?? '', /\/exit/);
  assert.equal(r.exit, undefined);
});

test('/model without arg reports current model', () => {
  const r = handleSlashCommand('/model', DEFAULT_REPL_CONFIG);
  assert.match(r.message ?? '', /openai\/gpt-4o-mini/);
});

test('/model <name> only changes the model name', () => {
  const r = handleSlashCommand('/model gpt-4o', DEFAULT_REPL_CONFIG);
  assert.match(r.message ?? '', /gpt-4o/);
  assert.equal(r.config?.llm?.model, 'gpt-4o');
  assert.equal(r.config?.llm?.provider, 'openai');
});

test('/model provider:model switches both', () => {
  const r = handleSlashCommand('/model anthropic:claude-3-5-sonnet-latest', DEFAULT_REPL_CONFIG);
  assert.equal(r.config?.llm?.provider, 'anthropic');
  assert.equal(r.config?.llm?.model, 'claude-3-5-sonnet-latest');
});

test('/model rejects unknown providers', () => {
  const r = handleSlashCommand('/model bogus:x', DEFAULT_REPL_CONFIG);
  assert.match(r.message ?? '', /unknown provider/);
  assert.equal(r.config, undefined);
});

test('/reset clears history', () => {
  const r = handleSlashCommand('/reset', { ...DEFAULT_REPL_CONFIG, history: ['a', 'b'] });
  assert.deepEqual(r.config?.history, []);
});

test('/exit signals termination', () => {
  const r = handleSlashCommand('/exit', DEFAULT_REPL_CONFIG);
  assert.equal(r.exit, true);
});

test('/unknown reports a friendly error', () => {
  const r = handleSlashCommand('/definitelynotacommand', DEFAULT_REPL_CONFIG);
  assert.match(r.message ?? '', /unknown command/);
});

test('loadConfig returns defaults when file is missing', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-repl-'));
  const cfg = await loadConfig(path.join(dir, 'config.json'));
  assert.equal(cfg.llm.provider, 'openai');
  assert.equal(cfg.llm.model, 'gpt-4o-mini');
});

test('saveConfig -> loadConfig round-trip', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-repl-'));
  const target = path.join(dir, 'config.json');
  const written = await saveConfig(
    { ...DEFAULT_REPL_CONFIG, llm: { ...DEFAULT_REPL_CONFIG.llm, model: 'gpt-4o' } },
    target,
  );
  assert.equal(written, target);
  const cfg = await loadConfig(target);
  assert.equal(cfg.llm.model, 'gpt-4o');
});

test('Spinner writes CR-prefixed frames and wipes on stop', () => {
  const chunks: string[] = [];
  const out = { write: (s: string) => { chunks.push(s); } };
  const sp = new Spinner(out);
  sp.start('working');
  sp.stop();
  const joined = chunks.join('');
  assert.match(joined, /working/);
  assert.match(joined, /\r /); // wiped with spaces
});
