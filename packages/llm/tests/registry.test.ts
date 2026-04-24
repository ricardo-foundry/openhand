import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveProvider,
  KNOWN_PROVIDERS,
  OpenAIProvider,
  AnthropicProvider,
  OllamaProvider,
} from '../src';

test('KNOWN_PROVIDERS lists all three first-class providers', () => {
  assert.deepEqual([...KNOWN_PROVIDERS].sort(), ['anthropic', 'ollama', 'openai']);
});

test('resolveProvider defaults to openai when env is empty', () => {
  const p = resolveProvider({ env: {} });
  assert.ok(p instanceof OpenAIProvider);
  assert.equal(p.info.id, 'openai');
});

test('resolveProvider picks anthropic from LLM_PROVIDER=anthropic', () => {
  const p = resolveProvider({ env: { LLM_PROVIDER: 'anthropic', ANTHROPIC_API_KEY: 'x' } });
  assert.ok(p instanceof AnthropicProvider);
});

test('resolveProvider accepts `claude` as an alias for anthropic', () => {
  const p = resolveProvider({ env: { LLM_PROVIDER: 'claude' } });
  assert.ok(p instanceof AnthropicProvider);
});

test('resolveProvider picks ollama from LLM_PROVIDER=ollama', () => {
  const p = resolveProvider({ env: { LLM_PROVIDER: 'ollama' } });
  assert.ok(p instanceof OllamaProvider);
});

test('resolveProvider honors explicit `provider` option over env', () => {
  const p = resolveProvider({
    provider: 'ollama',
    env: { LLM_PROVIDER: 'openai' },
  });
  assert.ok(p instanceof OllamaProvider);
});

test('resolveProvider threads fetchImpl through to the built provider', async () => {
  let called = 0;
  const fetchImpl: typeof fetch = async () => {
    called++;
    return new Response(
      JSON.stringify({
        id: 'x',
        choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    );
  };
  const p = resolveProvider({
    provider: 'openai',
    env: { OPENAI_API_KEY: 'test' },
    fetchImpl,
  });
  await p.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(called, 1);
});
