import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderStatus } from '../src/commands/status';
import { DEFAULT_REPL_CONFIG } from '../src/repl';

const SANDBOX = {
  allowedCommands: ['ls', 'cat', 'git', 'npm'],
  allowedPaths: ['/home/me', '/tmp'],
  timeoutMs: 30_000,
  memoryLimitMb: 256,
};

test('renderStatus prints provider + sandbox + empty plugin list', () => {
  const out = renderStatus({
    config: DEFAULT_REPL_CONFIG,
    sandbox: SANDBOX,
    plugins: [],
  });
  assert.match(out, /^OpenHand — status/m);
  assert.match(out, /provider\s+openai/);
  assert.match(out, /model\s+gpt-4o-mini/);
  assert.match(out, /timeout\s+30000ms/);
  assert.match(out, /memory\s+256MB/);
  assert.match(out, /Plugins \(0\)/);
  assert.match(out, /\(none discovered\)/);
});

test('renderStatus reflects plugin count + enabled flags', () => {
  const out = renderStatus({
    config: DEFAULT_REPL_CONFIG,
    sandbox: SANDBOX,
    plugins: [
      { id: 'calculator', version: '1.0.0', enabled: true, toolCount: 1 },
      { id: 'rss-digest', version: '1.0.0', enabled: false, toolCount: 2, permissions: ['network:http'] },
    ],
  });
  assert.match(out, /Plugins \(2\)/);
  assert.match(out, /• calculator@1\.0\.0/);
  assert.match(out, /· rss-digest@1\.0\.0/);
  assert.match(out, /\[network:http\]/);
});

test('renderStatus indicates "api_key set" vs "not set"', () => {
  const withKey = renderStatus({
    config: { ...DEFAULT_REPL_CONFIG, llm: { ...DEFAULT_REPL_CONFIG.llm, apiKey: 'sk-xxx' } },
    sandbox: SANDBOX,
    plugins: [],
  });
  assert.match(withKey, /api_key\s+\(set\)/);

  const without = renderStatus({
    config: DEFAULT_REPL_CONFIG,
    sandbox: SANDBOX,
    plugins: [],
  });
  assert.match(without, /api_key\s+\(not set\)/);
});

test('renderStatus truncates long allow-lists with an ellipsis', () => {
  const out = renderStatus({
    config: DEFAULT_REPL_CONFIG,
    sandbox: {
      ...SANDBOX,
      allowedCommands: ['a', 'b', 'c', 'd', 'e'],
    },
    plugins: [],
  });
  assert.match(out, /commands\s+5 allowed \(a, b, c, …\)/);
});

test('renderStatus surfaces optional base_url + temperature + max_tokens', () => {
  const out = renderStatus({
    config: {
      ...DEFAULT_REPL_CONFIG,
      llm: {
        ...DEFAULT_REPL_CONFIG.llm,
        baseUrl: 'http://localhost:11434',
        temperature: 0.2,
        maxTokens: 1024,
      },
    },
    sandbox: SANDBOX,
    plugins: [],
  });
  assert.match(out, /base_url\s+http:\/\/localhost:11434/);
  assert.match(out, /temp\s+0\.2/);
  assert.match(out, /max_tokens\s+1024/);
});
