import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LLMClient,
  InMemoryCostTracker,
  LLMError,
  type LLMProvider,
  type CompletionRequest,
  type CompletionResponse,
  type StreamChunk,
} from '../src';

const baseRequest: CompletionRequest = {
  model: 'm',
  messages: [{ role: 'user', content: 'hi' }],
};

function fakeProvider(impl: Partial<LLMProvider>): LLMProvider {
  return {
    info: { id: 'fake', label: 'fake', supportsTools: false, supportsStreaming: true },
    complete: impl.complete ?? (async () => ({ id: '', model: 'm', content: '', finishReason: 'stop' })),
    stream: impl.stream ?? (async function* () {
      yield { delta: 'ok', finishReason: 'stop' } satisfies StreamChunk;
    }),
  };
}

test('LLMClient retries on retriable errors and eventually succeeds', async () => {
  let attempts = 0;
  const provider = fakeProvider({
    complete: async () => {
      attempts++;
      if (attempts < 3) {
        throw new LLMError({ provider: 'fake', code: 'http_error', status: 503, message: 'oops' });
      }
      return { id: '1', model: 'm', content: 'won', finishReason: 'stop' } as CompletionResponse;
    },
  });

  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 5, initialDelayMs: 1, maxDelayMs: 2, sleep: async () => {} },
  });
  const res = await client.complete(baseRequest);
  assert.equal(attempts, 3);
  assert.equal(res.content, 'won');
});

test('LLMClient does NOT retry on HTTP 401 (auth errors)', async () => {
  let attempts = 0;
  const provider = fakeProvider({
    complete: async () => {
      attempts++;
      throw new LLMError({ provider: 'fake', code: 'http_error', status: 401, message: 'unauthorized' });
    },
  });
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 4, initialDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(() => client.complete(baseRequest));
  assert.equal(attempts, 1);
});

test('LLMClient stops retrying once maxAttempts is reached', async () => {
  let attempts = 0;
  const provider = fakeProvider({
    complete: async () => {
      attempts++;
      throw new LLMError({ provider: 'fake', code: 'http_error', status: 500, message: 'boom' });
    },
  });
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 2, initialDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(() => client.complete(baseRequest));
  assert.equal(attempts, 2);
});

test('LLMClient records usage into the cost tracker on complete', async () => {
  const tracker = new InMemoryCostTracker();
  const provider = fakeProvider({
    complete: async () => ({
      id: '1',
      model: 'm',
      content: 'ok',
      finishReason: 'stop',
      usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    }),
  });
  const client = new LLMClient({ provider, costTracker: tracker, retry: { maxAttempts: 1 } });
  await client.complete(baseRequest);
  await client.complete(baseRequest);
  assert.equal(tracker.promptTokens, 20);
  assert.equal(tracker.completionTokens, 10);
  assert.equal(tracker.totalTokens, 30);
});

test('LLMClient aggregates usage from the terminal stream chunk', async () => {
  const tracker = new InMemoryCostTracker();
  const provider = fakeProvider({
    stream: async function* () {
      yield { delta: 'he' };
      yield { delta: 'llo' };
      yield {
        delta: '',
        finishReason: 'stop',
        usage: { promptTokens: 1, completionTokens: 2, totalTokens: 3 },
      };
    },
  });
  const client = new LLMClient({ provider, costTracker: tracker });
  const parts: string[] = [];
  for await (const c of client.stream(baseRequest)) parts.push(c.delta);
  assert.equal(parts.join(''), 'hello');
  assert.equal(tracker.totalTokens, 3);
});

test('LLMClient rate limit enforces max 1 req and second waits for refill', async () => {
  let now = 0;
  const sleeps: number[] = [];
  const provider = fakeProvider({
    complete: async () => ({ id: '', model: 'm', content: 'ok', finishReason: 'stop' }),
  });
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1 },
    rateLimit: {
      maxRequests: 1,
      windowMs: 1000,
      now: () => now,
      sleep: async ms => {
        sleeps.push(ms);
        now += ms;
      },
    },
  });

  await client.complete(baseRequest);
  await client.complete(baseRequest);
  assert.ok(sleeps.length >= 1, 'second call should have waited at least once');
  assert.ok(sleeps[0]! >= 1);
});

test('LLMClient timeout cancels via AbortController', async () => {
  let received: AbortSignal | undefined;
  const provider = fakeProvider({
    complete: async req => {
      received = req.extra?.signal as AbortSignal | undefined;
      return { id: '', model: 'm', content: 'ok', finishReason: 'stop' };
    },
  });
  const client = new LLMClient({
    provider,
    timeoutMs: 10_000,
    retry: { maxAttempts: 1 },
  });
  await client.complete(baseRequest);
  assert.ok(received, 'provider should have received an AbortSignal');
  assert.equal(received?.aborted, false);
});

test('InMemoryCostTracker.reset zeroes everything', () => {
  const t = new InMemoryCostTracker();
  t.record({ promptTokens: 3, completionTokens: 4, totalTokens: 7 });
  t.reset();
  assert.equal(t.promptTokens, 0);
  assert.equal(t.completionTokens, 0);
  assert.equal(t.totalTokens, 0);
});
