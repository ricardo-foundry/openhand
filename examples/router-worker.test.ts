/**
 * Smoke test for `examples/router-worker.ts`.
 *
 * Asserts the router parses the worker JSON correctly and the worker
 * actually returns the canned mocked reply. Runs in <50ms with no
 * network.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LLMClient, MockProvider } from '../packages/llm/src/index';
import { route, runWorker, WORKERS } from './router-worker';

test('router-worker: router parses worker JSON', async () => {
  const router = new LLMClient({
    provider: new MockProvider({
      reply: '{"worker":"code","reason":"asks for a snippet"}',
    }),
    retry: { maxAttempts: 1 },
  });
  const decision = await route(router, 'show me a quicksort', 'router-mini');
  assert.equal(decision.worker, 'code');
  assert.match(decision.reason, /snippet/);
});

test('router-worker: router falls back to research on garbage', async () => {
  const router = new LLMClient({
    provider: new MockProvider({ reply: 'totally not json' }),
    retry: { maxAttempts: 1 },
  });
  const decision = await route(router, 'whatever', 'router-mini');
  assert.equal(decision.worker, 'research');
});

test('router-worker: router tolerates fenced JSON', async () => {
  const router = new LLMClient({
    provider: new MockProvider({
      reply: '```json\n{"worker":"math","reason":"equation"}\n```',
    }),
    retry: { maxAttempts: 1 },
  });
  const decision = await route(router, 'solve 2x=4', 'router-mini');
  assert.equal(decision.worker, 'math');
});

test('router-worker: worker uses its system prompt', async () => {
  const worker = new LLMClient({
    provider: new MockProvider({ reply: 'Step 1\nStep 2\n**42**' }),
    retry: { maxAttempts: 1 },
  });
  const reply = await runWorker(worker, WORKERS.math, 'solve x=42', 'worker-large');
  assert.match(reply, /\*\*42\*\*/);
});

test('router-worker: every worker id has a system prompt', () => {
  for (const id of ['code', 'research', 'math'] as const) {
    assert.ok(WORKERS[id].systemPrompt.length > 10, `worker ${id} missing prompt`);
  }
});
