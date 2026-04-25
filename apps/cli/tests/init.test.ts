/**
 * Tests for `openhand init`. We never spawn a TTY: the runner takes a
 * `prompt` dependency we feed scripted answers to, and a `write` sink we
 * accumulate output into.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { runInit, parseProviderChoice, PROVIDERS } from '../src/commands/init';

async function tmpDir(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'openhand-init-'));
}

function scriptedPrompt(answers: string[]): (q: string) => Promise<string> {
  let i = 0;
  return async (_q: string) => {
    const a = answers[i++];
    if (a === undefined) throw new Error(`prompt: ran out of scripted answers at #${i}`);
    return a;
  };
}

test('runInit --yes writes a mock-provider config to .openhand/config.json', async () => {
  const dir = await tmpDir();
  const out: string[] = [];
  const code = await runInit(
    { yes: true, cwd: dir },
    {
      configPath: path.join(dir, '.openhand', 'config.json'),
      write: s => out.push(s),
    },
  );
  assert.equal(code, 0);
  const written = JSON.parse(
    await fs.readFile(path.join(dir, '.openhand', 'config.json'), 'utf-8'),
  );
  assert.equal(written.schema, 1);
  assert.equal(written.llm.provider, 'mock');
  assert.equal(written.agent.sandboxEnabled, true);
  assert.ok(Array.isArray(written.agent.requireApprovalFor));
  assert.match(out.join(''), /wrote .*config\.json/);
});

test('runInit refuses to clobber existing config without --force', async () => {
  const dir = await tmpDir();
  const cfgPath = path.join(dir, '.openhand', 'config.json');
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await fs.writeFile(cfgPath, '{"existing":true}\n');

  const out: string[] = [];
  const code = await runInit(
    { yes: true, cwd: dir },
    { configPath: cfgPath, write: s => out.push(s) },
  );
  assert.equal(code, 2);
  assert.match(out.join(''), /already exists/);
  // Original content untouched.
  const text = await fs.readFile(cfgPath, 'utf-8');
  assert.match(text, /"existing":true/);
});

test('runInit --force overwrites existing config', async () => {
  const dir = await tmpDir();
  const cfgPath = path.join(dir, '.openhand', 'config.json');
  await fs.mkdir(path.dirname(cfgPath), { recursive: true });
  await fs.writeFile(cfgPath, '{"existing":true}\n');

  const code = await runInit(
    { yes: true, force: true, cwd: dir },
    { configPath: cfgPath, write: () => {} },
  );
  assert.equal(code, 0);
  const written = JSON.parse(await fs.readFile(cfgPath, 'utf-8'));
  assert.equal(written.llm.provider, 'mock');
});

test('runInit interactive: pick OpenAI by number, custom model, custom key+url', async () => {
  const dir = await tmpDir();
  const out: string[] = [];
  const code = await runInit(
    { cwd: dir },
    {
      configPath: path.join(dir, '.openhand', 'config.json'),
      write: s => out.push(s),
      prompt: scriptedPrompt([
        '1',                  // provider 1 => openai
        'gpt-4o-2024',        // model
        'sk-test-123',        // API key
        '',                   // baseUrl: accept default
      ]),
    },
  );
  assert.equal(code, 0);
  const w = JSON.parse(
    await fs.readFile(path.join(dir, '.openhand', 'config.json'), 'utf-8'),
  );
  assert.equal(w.llm.provider, 'openai');
  assert.equal(w.llm.model, 'gpt-4o-2024');
  assert.equal(w.llm.apiKey, 'sk-test-123');
  assert.equal(w.llm.baseUrl, undefined); // default URL not persisted
});

test('runInit interactive: pick Anthropic by name, override model', async () => {
  const dir = await tmpDir();
  const code = await runInit(
    { cwd: dir },
    {
      configPath: path.join(dir, '.openhand', 'config.json'),
      write: () => {},
      prompt: scriptedPrompt([
        'anthropic',                     // provider by name
        'claude-3-7-sonnet-latest',      // model override
        '',                              // skip API key
      ]),
    },
  );
  assert.equal(code, 0);
  const w = JSON.parse(
    await fs.readFile(path.join(dir, '.openhand', 'config.json'), 'utf-8'),
  );
  assert.equal(w.llm.provider, 'anthropic');
  assert.equal(w.llm.model, 'claude-3-7-sonnet-latest');
  assert.equal(w.llm.apiKey, undefined);
});

test('runInit interactive: pick Ollama, set custom baseUrl', async () => {
  const dir = await tmpDir();
  const code = await runInit(
    { cwd: dir },
    {
      configPath: path.join(dir, '.openhand', 'config.json'),
      write: () => {},
      prompt: scriptedPrompt([
        '3',                             // ollama
        '',                              // accept default model
        'http://gpu.lan:11434',          // custom baseUrl
      ]),
    },
  );
  assert.equal(code, 0);
  const w = JSON.parse(
    await fs.readFile(path.join(dir, '.openhand', 'config.json'), 'utf-8'),
  );
  assert.equal(w.llm.provider, 'ollama');
  assert.equal(w.llm.model, 'qwen2.5:0.5b');
  assert.equal(w.llm.baseUrl, 'http://gpu.lan:11434');
  assert.equal(w.llm.apiKey, undefined);
});

test('runInit interactive: garbage provider input falls back to mock default', async () => {
  const dir = await tmpDir();
  const code = await runInit(
    { cwd: dir },
    {
      configPath: path.join(dir, '.openhand', 'config.json'),
      write: () => {},
      prompt: scriptedPrompt([
        'banana',  // invalid → falls back to default 'mock'
        '',        // accept default model
      ]),
    },
  );
  assert.equal(code, 0);
  const w = JSON.parse(
    await fs.readFile(path.join(dir, '.openhand', 'config.json'), 'utf-8'),
  );
  assert.equal(w.llm.provider, 'mock');
  assert.equal(w.llm.model, 'mock');
});

test('parseProviderChoice: numbers and names map; everything else returns null', () => {
  assert.equal(parseProviderChoice('1'), 'openai');
  assert.equal(parseProviderChoice('2'), 'anthropic');
  assert.equal(parseProviderChoice('3'), 'ollama');
  assert.equal(parseProviderChoice('4'), 'mock');
  assert.equal(parseProviderChoice('Anthropic'), 'anthropic');
  assert.equal(parseProviderChoice(''), null);
  assert.equal(parseProviderChoice('99'), null);
  assert.equal(parseProviderChoice('foo'), null);
  // Sanity: PROVIDERS list is the four we expect.
  assert.deepEqual([...PROVIDERS], ['openai', 'anthropic', 'ollama', 'mock']);
});

test('runInit: written file is valid JSON with createdAt ISO timestamp', async () => {
  const dir = await tmpDir();
  await runInit(
    { yes: true, cwd: dir },
    { configPath: path.join(dir, '.openhand', 'config.json'), write: () => {} },
  );
  const w = JSON.parse(
    await fs.readFile(path.join(dir, '.openhand', 'config.json'), 'utf-8'),
  );
  assert.match(w.createdAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
});
