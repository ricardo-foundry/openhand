/**
 * Micro-benchmark: LLMClient overhead when everything succeeds on the first
 * attempt (no retries, no rate-limit waits, no timeouts firing).
 *
 * The goal is to detect regressions in the hot path — e.g. if someone adds a
 * synchronous JSON.stringify of the whole request into `complete()`, ops/sec
 * would drop and this bench would surface it.
 *
 * We wrap each measurement in a `node:test` assertion so the file doubles as
 * a smoke test: CI fails fast if the wrapper crashes, and developers can see
 * rough numbers in the TAP output.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { LLMClient } from '../packages/llm/src/client';
import type { LLMProvider } from '../packages/llm/src/provider';
import type {
  CompletionRequest,
  CompletionResponse,
  StreamChunk,
} from '../packages/llm/src/types';

const FAKE_RESPONSE: CompletionResponse = {
  id: 'bench',
  model: 'bench-model',
  content: 'ok',
  finishReason: 'stop',
  usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 },
};

function makeMockProvider(): LLMProvider {
  return {
    info: {
      id: 'mock',
      label: 'Mock',
      supportsTools: false,
      supportsStreaming: true,
    },
    async complete(_req: CompletionRequest): Promise<CompletionResponse> {
      return FAKE_RESPONSE;
    },
    async *stream(_req: CompletionRequest): AsyncIterable<StreamChunk> {
      yield { delta: 'hi', finishReason: 'stop', usage: FAKE_RESPONSE.usage };
    },
  };
}

function fmt(ops: number, nsPerOp: number): string {
  return `${ops.toLocaleString()} ops/s (${nsPerOp.toFixed(0)} ns/op)`;
}

async function bench(
  label: string,
  iters: number,
  fn: () => Promise<void>,
): Promise<{ opsPerSec: number; nsPerOp: number }> {
  // Warm-up so V8 tier-ups don't skew the first numbers.
  for (let i = 0; i < Math.min(100, iters); i++) await fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) await fn();
  const elapsedMs = performance.now() - start;
  const opsPerSec = Math.round((iters / elapsedMs) * 1000);
  const nsPerOp = (elapsedMs * 1_000_000) / iters;
  // eslint-disable-next-line no-console
  console.log(`    ${label}: ${fmt(opsPerSec, nsPerOp)}`);
  return { opsPerSec, nsPerOp };
}

const REQ: CompletionRequest = {
  model: 'bench-model',
  messages: [{ role: 'user', content: 'hi' }],
};

test('LLMClient.complete passthrough has reasonable overhead', async () => {
  const client = new LLMClient({ provider: makeMockProvider() });
  const r = await bench('complete() idle', 2000, async () => {
    await client.complete(REQ);
  });
  // Guardrail: should be well under 100k ns/op (0.1ms) on any reasonable CI.
  assert.ok(r.nsPerOp < 500_000, `nsPerOp=${r.nsPerOp} is suspiciously high`);
});

test('LLMClient.complete with retry policy (no failures) adds minimal cost', async () => {
  const client = new LLMClient({
    provider: makeMockProvider(),
    retry: { maxAttempts: 3, initialDelayMs: 100, maxDelayMs: 1_000 },
  });
  const r = await bench('complete() + retry policy', 2000, async () => {
    await client.complete(REQ);
  });
  assert.ok(r.nsPerOp < 500_000);
});

test('LLMClient.stream passthrough', async () => {
  const client = new LLMClient({ provider: makeMockProvider() });
  const r = await bench('stream() idle', 1000, async () => {
    for await (const _ of client.stream(REQ)) { /* drain */ }
  });
  assert.ok(r.nsPerOp < 1_000_000);
});

test('LLMClient with rate limit (far under cap) does not block', async () => {
  const client = new LLMClient({
    provider: makeMockProvider(),
    rateLimit: { maxRequests: 10_000, windowMs: 1_000 },
  });
  const r = await bench('complete() + rate limit', 2000, async () => {
    await client.complete(REQ);
  });
  assert.ok(r.nsPerOp < 500_000);
});
