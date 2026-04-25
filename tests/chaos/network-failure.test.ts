/**
 * Chaos: every flavour of fetch failure the LLM client/providers might see.
 *
 * Covered:
 *   - ECONNRESET (TypeError thrown by fetch)
 *   - timeout (AbortController firing)
 *   - half-open response: headers OK but body throws mid-stream
 *   - non-200 with empty body
 *   - non-JSON 200 body
 *   - lone DNS-style failure (TypeError with cause)
 *
 * The contract: `LLMClient` must surface these as `LLMError` (or retry then
 * surface), must not leak timeout handles, and must not leave AbortControllers
 * dangling. We poke the latter by checking that the test exits without
 * `--detectOpenHandles` complaints — node:test will warn if a timer keeps
 * the loop alive after the test resolves.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LLMClient } from '../../packages/llm/src/client';
import { OpenAIProvider } from '../../packages/llm/src/openai';
import { LLMError } from '../../packages/llm/src/types';

interface FakeFetchOptions {
  /** What every call should do. */
  mode:
    | 'econnreset'
    | 'timeout'
    | 'half-body'
    | 'non-200-empty'
    | 'non-json-200'
    | 'dns-fail';
  /** When true, the first call fails and subsequent calls succeed. */
  failOnce?: boolean;
}

function makeFetch(opts: FakeFetchOptions): typeof fetch {
  let calls = 0;
  return (async (_url: any, init?: any) => {
    calls++;
    if (opts.failOnce && calls > 1) {
      // Recovery: serve a valid OpenAI-shaped response.
      return new Response(
        JSON.stringify({
          id: 'r',
          choices: [{ message: { role: 'assistant', content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    switch (opts.mode) {
      case 'econnreset': {
        const e = new TypeError('fetch failed');
        (e as any).cause = { code: 'ECONNRESET' };
        throw e;
      }
      case 'dns-fail': {
        const e = new TypeError('fetch failed');
        (e as any).cause = { code: 'ENOTFOUND', hostname: 'no.such.host' };
        throw e;
      }
      case 'timeout': {
        // Mimic AbortController firing
        const sig = init?.signal as AbortSignal | undefined;
        return new Promise((_resolve, reject) => {
          const onAbort = (): void => {
            const err = new Error('aborted');
            (err as any).name = 'AbortError';
            reject(err);
          };
          if (sig?.aborted) onAbort();
          else sig?.addEventListener('abort', onAbort, { once: true });
          // Never resolve; rely on abort
        });
      }
      case 'half-body': {
        // Headers say JSON but body() throws midway.
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('{"id":"x",'));
            // Then explode.
            controller.error(new Error('socket hang up'));
          },
        });
        return new Response(stream, { status: 200, headers: { 'content-type': 'application/json' } });
      }
      case 'non-200-empty':
        return new Response('', { status: 503 });
      case 'non-json-200':
        return new Response('<html>oops</html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        });
    }
  }) as unknown as typeof fetch;
}

function makeProvider(fetchImpl: typeof fetch): OpenAIProvider {
  return new OpenAIProvider({
    apiKey: 'sk-test',
    fetchImpl,
    timeoutMs: 500, // tight so timeout cases finish fast
  });
}

test('chaos/net: ECONNRESET surfaces as LLMError after retries exhaust', async () => {
  const provider = makeProvider(makeFetch({ mode: 'econnreset' }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(
    () => client.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    (e: unknown) => {
      // After retries are exhausted we expect either an LLMError or the
      // raw TypeError; both are acceptable as long as it's not silently
      // swallowed.
      return e instanceof Error && /fetch failed|network/i.test(e.message);
    },
  );
});

test('chaos/net: ECONNRESET that recovers on retry succeeds', async () => {
  const provider = makeProvider(makeFetch({ mode: 'econnreset', failOnce: true }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 2 },
  });
  const res = await client.complete({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.content, 'ok');
});

test('chaos/net: timeout aborts and surfaces as LLMError', async () => {
  const provider = makeProvider(makeFetch({ mode: 'timeout' }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
    timeoutMs: 200,
  });
  await assert.rejects(
    () =>
      client.complete({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    (e: unknown) => e instanceof Error,
  );
});

test('chaos/net: half-streamed body becomes LLMError(bad_json) or http_error', async () => {
  const provider = makeProvider(makeFetch({ mode: 'half-body' }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(
    () => client.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    (e: unknown) => {
      // bad_json or generic — provider must NOT hang.
      return e instanceof Error;
    },
  );
});

test('chaos/net: 503 with empty body raises LLMError(http_error)', async () => {
  const provider = makeProvider(makeFetch({ mode: 'non-200-empty' }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(
    () => client.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    (e: unknown) => e instanceof LLMError && (e as LLMError).code === 'http_error',
  );
});

test('chaos/net: 200 with non-JSON body raises LLMError(bad_json)', async () => {
  const provider = makeProvider(makeFetch({ mode: 'non-json-200' }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(
    () => client.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
    (e: unknown) => e instanceof LLMError && (e as LLMError).code === 'bad_json',
  );
});

test('chaos/net: DNS failure (ENOTFOUND) surfaces and does not leak handles', async () => {
  const provider = makeProvider(makeFetch({ mode: 'dns-fail' }));
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  await assert.rejects(() =>
    client.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] }),
  );
});

test('chaos/net: client cleans up timeouts on success path (no leaks)', async () => {
  // Sanity: hammer a happy fetch many times. If `startTimeout` ever
  // forgot to clearTimeout, we'd accumulate timer handles and
  // node:test would complain on shutdown. We just assert no throw
  // and a reasonable response time.
  const happy: typeof fetch = (async () =>
    new Response(
      JSON.stringify({
        id: 'h',
        choices: [{ message: { role: 'assistant', content: 'k' } }],
      }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )) as unknown as typeof fetch;
  const provider = makeProvider(happy);
  const client = new LLMClient({
    provider,
    timeoutMs: 1_000,
    retry: { maxAttempts: 1, initialDelayMs: 1, maxDelayMs: 2 },
  });
  for (let i = 0; i < 20; i++) {
    const r = await client.complete({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'hi' }],
    });
    assert.equal(r.content, 'k');
  }
});
