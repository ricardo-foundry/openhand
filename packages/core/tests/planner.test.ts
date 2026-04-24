import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskPlanner } from '../src/planner';
import type { LLMConfig } from '../src/types';

const BASE_CONFIG: LLMConfig = {
  provider: 'custom',
  model: 'test-model',
  baseUrl: 'http://127.0.0.1:65535', // unused; we stub fetch below
};

// Swap global fetch for each test.
function stubFetch(impl: typeof fetch): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return () => {
    globalThis.fetch = original;
  };
}

test('planner falls back to direct_response when JSON parsing fails', async () => {
  const restore = stubFetch(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: 'this is not JSON at all' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  try {
    const planner = new TaskPlanner(BASE_CONFIG);
    const plan = await planner.plan('hi', {}, []);
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0]!.type, 'direct_response');
  } finally {
    restore();
  }
});

test('planner strips markdown code fences around JSON', async () => {
  const restore = stubFetch(async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content:
                '```json\n{"reasoning":"ok","tasks":[{"type":"file_read","params":{"path":"a"}}]}\n```',
            },
          },
        ],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  try {
    const planner = new TaskPlanner(BASE_CONFIG);
    const plan = await planner.plan('read a', {}, []);
    assert.equal(plan.tasks.length, 1);
    assert.equal(plan.tasks[0]!.type, 'file_read');
  } finally {
    restore();
  }
});

test('planner records provider token usage', async () => {
  const restore = stubFetch(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"reasoning":"r","tasks":[]}' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ),
  );
  try {
    const planner = new TaskPlanner(BASE_CONFIG);
    await planner.plan('hi', {}, []);
    const usage = planner.getUsage();
    assert.equal(usage.calls, 1);
    assert.equal(usage.promptTokens, 10);
    assert.equal(usage.completionTokens, 5);
  } finally {
    restore();
  }
});

test('planner retries on 5xx and eventually returns fallback', async () => {
  let calls = 0;
  const restore = stubFetch(async () => {
    calls++;
    return new Response('err', { status: 503, statusText: 'Service Unavailable' });
  });
  try {
    const planner = new TaskPlanner(BASE_CONFIG);
    const plan = await planner.plan('x', {}, [], { maxRetries: 2, timeoutMs: 500 });
    assert.equal(plan.tasks[0]!.type, 'direct_response');
    assert.equal(calls, 3); // original + 2 retries
  } finally {
    restore();
  }
});
