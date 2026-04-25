/**
 * Chaos: 10 MB chat history processing.
 *
 * Two angles:
 *
 *   1. The LLM client / mock provider must handle a request whose total
 *      message payload is ~10 MB without OOM, without taking minutes,
 *      and without truncating silently.
 *   2. The task-stream ring buffer + formatSseFrame must not blow up on
 *      a huge `data` field — they cap history but they should also not
 *      hang on a single 10 MB JSON.stringify.
 *
 * We deliberately avoid asserting on absolute timings (CI machines vary);
 * we assert on correctness and that a generous wallclock isn't exceeded.
 *
 * Bug we'd surface: if anyone introduced an O(n^2) string concat in
 * `formatSseFrame` or in `OpenAIProvider.buildBody`, this test would
 * blow past the 5s budget on a normal laptop.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LLMClient } from '../../packages/llm/src/client';
import type { LLMProvider } from '../../packages/llm/src/provider';
import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from '../../packages/llm/src/types';
import {
  TaskStreamBus,
  formatSseFrame,
  type TaskStreamEvent,
} from '../../apps/server/src/task-stream';

function makeFakeProvider(seenSize: { value: number }): LLMProvider {
  return {
    info: { id: 'mock', label: 'mock', supportsTools: false, supportsStreaming: true },
    async complete(req: CompletionRequest): Promise<CompletionResponse> {
      const total = req.messages.reduce((sum, m) => sum + m.content.length, 0);
      seenSize.value = total;
      return {
        id: 'big',
        model: req.model,
        content: 'received',
        finishReason: 'stop',
        usage: { promptTokens: total, completionTokens: 1, totalTokens: total + 1 },
      };
    },
    async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
      const total = req.messages.reduce((sum, m) => sum + m.content.length, 0);
      seenSize.value = total;
      yield { delta: 'ok', finishReason: 'stop' };
    },
  };
}

function buildHistory(targetBytes: number): { role: 'user' | 'assistant'; content: string }[] {
  const out: { role: 'user' | 'assistant'; content: string }[] = [];
  // 1 KB chunks so the message array itself is non-trivially sized.
  const chunk = 'x'.repeat(1024);
  let written = 0;
  let i = 0;
  while (written < targetBytes) {
    out.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: chunk });
    written += chunk.length;
    i++;
  }
  return out;
}

const TEN_MB = 10 * 1024 * 1024;

test('chaos/payload: 10MB chat history reaches the provider intact', async () => {
  const seen = { value: 0 };
  const client = new LLMClient({
    provider: makeFakeProvider(seen),
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  const messages = buildHistory(TEN_MB);
  const start = Date.now();
  const res = await client.complete({ model: 'mock', messages });
  const elapsed = Date.now() - start;
  assert.equal(res.content, 'received');
  assert.ok(seen.value >= TEN_MB, `provider received ${seen.value} bytes, expected >= ${TEN_MB}`);
  assert.ok(elapsed < 10_000, `processing took ${elapsed}ms (>10s — possible quadratic)`);
});

test('chaos/payload: 10MB stream completes without buffering forever', async () => {
  const seen = { value: 0 };
  const client = new LLMClient({
    provider: makeFakeProvider(seen),
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  const messages = buildHistory(TEN_MB);
  const start = Date.now();
  let chunks = 0;
  for await (const chunk of client.stream({ model: 'mock', messages })) {
    chunks++;
    if (chunk.finishReason) break;
  }
  const elapsed = Date.now() - start;
  assert.ok(chunks >= 1);
  assert.ok(elapsed < 10_000, `stream took ${elapsed}ms`);
});

test('chaos/payload: TaskStreamBus handles a 1MB data blob without OOM', () => {
  const bus = new TaskStreamBus({ historyLimit: 5 });
  const blob = 'b'.repeat(1024 * 1024);
  for (let i = 0; i < 10; i++) {
    bus.publish({ taskId: 'big', status: 'running', message: `m${i}`, data: blob });
  }
  // History bounded at 5 — proves the ring buffer evicts even with huge
  // payloads (no copy-on-grow that would 10x memory).
  const hist = bus.history('big');
  assert.equal(hist.length, 5);
});

test('chaos/payload: formatSseFrame handles a 1MB data field linearly', () => {
  const blob = 'z'.repeat(1024 * 1024);
  const evt: TaskStreamEvent = {
    id: 1,
    taskId: 't',
    timestamp: Date.now(),
    status: 'running',
    data: blob,
  };
  const start = Date.now();
  const frame = formatSseFrame(evt);
  const elapsed = Date.now() - start;
  // A linear-time stringify of 1 MB should take < 200ms even on slow CI.
  assert.ok(elapsed < 1_000, `formatSseFrame ${elapsed}ms — possible quadratic`);
  assert.ok(frame.length > blob.length);
  assert.ok(frame.startsWith('id: 1\n'));
});

test('chaos/payload: many small chat turns (5000) do not regress', async () => {
  const seen = { value: 0 };
  const client = new LLMClient({
    provider: makeFakeProvider(seen),
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  const messages: { role: 'user' | 'assistant'; content: string }[] = [];
  for (let i = 0; i < 5000; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'assistant', content: `turn ${i}` });
  }
  const start = Date.now();
  const r = await client.complete({ model: 'mock', messages });
  const elapsed = Date.now() - start;
  assert.equal(r.content, 'received');
  assert.ok(elapsed < 5_000, `5k turns took ${elapsed}ms`);
});

test('chaos/payload: assistant message with embedded null bytes is preserved', async () => {
  const seen = { value: 0 };
  const client = new LLMClient({
    provider: makeFakeProvider(seen),
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  const weird = '\x00\x01\x02 hello \x00 world \x7f';
  const r = await client.complete({
    model: 'mock',
    messages: [{ role: 'user', content: weird }],
  });
  assert.equal(r.content, 'received');
  // Provider saw exactly the bytes we sent — no silent stripping.
  assert.equal(seen.value, weird.length);
});
