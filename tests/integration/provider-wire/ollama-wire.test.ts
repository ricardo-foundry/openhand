/**
 * Ollama wire-format integration tests.
 *
 * Ollama's `/api/chat` is *not* SSE — it streams newline-delimited JSON.
 * Each line is a complete JSON object; the last one carries `done: true`
 * along with `prompt_eval_count` / `eval_count` and `done_reason`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OllamaProvider } from '../../../packages/llm/src/ollama';
import { LLMClient } from '../../../packages/llm/src/client';
import { LLMError } from '../../../packages/llm/src/types';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

function recordingFetch(scripted: Array<() => Response | Promise<Response>>): {
  fetch: typeof fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  let i = 0;
  const fn: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const headers: Record<string, string> = {};
    const rawHeaders = (init?.headers ?? {}) as Record<string, string>;
    for (const [k, v] of Object.entries(rawHeaders)) headers[k.toLowerCase()] = v;
    const rawBody = init?.body;
    let body: any = undefined;
    if (typeof rawBody === 'string') {
      try { body = JSON.parse(rawBody); } catch { body = rawBody; }
    }
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    const next = scripted[i++];
    if (!next) throw new Error('recordingFetch: no scripted response left');
    return await next();
  };
  return { fetch: fn, calls };
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ndjsonResponse(objs: unknown[]): Response {
  const body = objs.map(o => JSON.stringify(o)).join('\n') + '\n';
  return new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } });
}

// 1. Single-shot completion with native usage fields.
test('ollama: single-shot complete parses prompt_eval_count + eval_count', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      model: 'qwen2.5:0.5b',
      created_at: '2026-04-25T10:00:00Z',
      message: { role: 'assistant', content: 'Hello.' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 5,
      eval_count: 2,
    }),
  ]);
  const provider = new OllamaProvider({ fetchImpl: fetch });
  const res = await provider.complete({
    model: 'qwen2.5:0.5b',
    messages: [{ role: 'user', content: 'hi' }],
  });

  assert.equal(res.content, 'Hello.');
  assert.equal(res.finishReason, 'stop');
  assert.deepEqual(res.usage, { promptTokens: 5, completionTokens: 2, totalTokens: 7 });

  // wire shape — Ollama hits /api/chat, no auth header
  assert.equal(calls[0]!.url, 'http://localhost:11434/api/chat');
  assert.equal(calls[0]!.headers['authorization'], undefined);
  assert.equal(calls[0]!.body.model, 'qwen2.5:0.5b');
  assert.equal(calls[0]!.body.stream, false);
});

// 2. NDJSON stream — tokens arrive line-by-line.
test('ollama: ndjson stream stitches per-line message.content', async () => {
  const { fetch } = recordingFetch([
    () => ndjsonResponse([
      { model: 'q', created_at: 't', message: { role: 'assistant', content: 'Sure' }, done: false },
      { model: 'q', created_at: 't', message: { role: 'assistant', content: ', ' }, done: false },
      { model: 'q', created_at: 't', message: { role: 'assistant', content: 'I can.' }, done: false },
      {
        model: 'q', created_at: 't', message: { role: 'assistant', content: '' },
        done: true, done_reason: 'stop',
        prompt_eval_count: 4, eval_count: 6,
      },
    ]),
  ]);
  const provider = new OllamaProvider({ fetchImpl: fetch });
  const out: string[] = [];
  let usage: any = null;
  let finishReason: string | undefined;
  for await (const c of provider.stream({
    model: 'q', messages: [{ role: 'user', content: 'go' }],
  })) {
    if (c.delta) out.push(c.delta);
    if (c.finishReason) { finishReason = c.finishReason; usage = c.usage; }
  }
  assert.equal(out.join(''), 'Sure, I can.');
  assert.equal(finishReason, 'stop');
  assert.deepEqual(usage, { promptTokens: 4, completionTokens: 6, totalTokens: 10 });
});

// 3. Tool calls in Ollama come back under message.tool_calls[].function.{name,arguments}.
test('ollama: tool_calls decoded with object arguments stringified', async () => {
  const { fetch } = recordingFetch([
    () => jsonResponse(200, {
      model: 'llama3.1', created_at: 't',
      message: {
        role: 'assistant', content: '',
        tool_calls: [{ function: { name: 'lookup', arguments: { q: 'x' } } }],
      },
      done: true, done_reason: 'stop',
    }),
  ]);
  const provider = new OllamaProvider({ fetchImpl: fetch });
  const res = await provider.complete({
    model: 'llama3.1',
    messages: [{ role: 'user', content: 'find' }],
    tools: [
      { name: 'lookup', description: 'd', parameters: { type: 'object' } },
    ],
  });
  assert.equal(res.finishReason, 'tool_calls');
  assert.equal(res.toolCalls?.[0]?.name, 'lookup');
  assert.deepEqual(JSON.parse(res.toolCalls![0]!.argumentsJson), { q: 'x' });
});

// 4. options block carries temperature + num_predict + stop.
test('ollama: temperature/maxTokens/stop are nested under options', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      model: 'q', created_at: 't',
      message: { role: 'assistant', content: 'k' },
      done: true, done_reason: 'stop',
    }),
  ]);
  const provider = new OllamaProvider({ fetchImpl: fetch });
  await provider.complete({
    model: 'q',
    messages: [{ role: 'user', content: 'q' }],
    temperature: 0.3,
    maxTokens: 64,
    stop: ['\n\n'],
  });
  assert.deepEqual(calls[0]!.body.options, {
    temperature: 0.3,
    num_predict: 64,
    stop: ['\n\n'],
  });
});

// 5. 404 model_not_found → LLMError 404, default policy retries (5xx-only).
test('ollama: 404 model_not_found does NOT retry', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(404, { error: 'model "ghost" not found' }),
    () => jsonResponse(200, {
      model: 'q', created_at: 't',
      message: { role: 'assistant', content: 'never' }, done: true,
    }),
  ]);
  const client = new LLMClient({
    provider: new OllamaProvider({ fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(
    () => client.complete({ model: 'ghost', messages: [{ role: 'user', content: 'q' }] }),
    (err: unknown) => err instanceof LLMError && err.status === 404,
  );
  assert.equal(calls.length, 1);
});

// 6. 502 transient retry succeeds.
test('ollama: 502 retries to success on next attempt', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(502, { error: 'bad gateway' }),
    () => jsonResponse(200, {
      model: 'q', created_at: 't',
      message: { role: 'assistant', content: 'finally' },
      done: true, done_reason: 'stop',
    }),
  ]);
  const client = new LLMClient({
    provider: new OllamaProvider({ fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  const res = await client.complete({ model: 'q', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(res.content, 'finally');
  assert.equal(calls.length, 2);
});

// 7. baseUrl override (remote ollama host).
test('ollama: baseUrl override hits remote host without trailing slash', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      model: 'q', created_at: 't',
      message: { role: 'assistant', content: 'k' },
      done: true, done_reason: 'stop',
    }),
  ]);
  const provider = new OllamaProvider({
    baseUrl: 'http://gpu-box.lan:11434/',
    fetchImpl: fetch,
  });
  await provider.complete({ model: 'q', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(calls[0]!.url, 'http://gpu-box.lan:11434/api/chat');
});

// 8. Garbage line in stream is skipped, not fatal.
test('ollama: malformed ndjson line is skipped, not fatal', async () => {
  const body =
    JSON.stringify({ model: 'q', message: { role: 'assistant', content: 'a' }, done: false }) +
    '\nNOT-JSON\n' +
    JSON.stringify({
      model: 'q', message: { role: 'assistant', content: 'b' },
      done: true, done_reason: 'stop',
      prompt_eval_count: 1, eval_count: 2,
    }) + '\n';
  const { fetch } = recordingFetch([
    () => new Response(body, { status: 200, headers: { 'content-type': 'application/x-ndjson' } }),
  ]);
  const provider = new OllamaProvider({ fetchImpl: fetch });
  const out: string[] = [];
  for await (const c of provider.stream({
    model: 'q', messages: [{ role: 'user', content: 'q' }],
  })) {
    if (c.delta) out.push(c.delta);
  }
  assert.equal(out.join(''), 'ab');
});

// 9. context length overflow on Ollama: 500 with deepseek-style "context window" message.
test('ollama: 500 with context-window message → LLMError 500, retries by default', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(500, { error: 'context window exceeded' }),
    () => jsonResponse(500, { error: 'context window exceeded' }),
  ]);
  const client = new LLMClient({
    provider: new OllamaProvider({ fetchImpl: fetch }),
    retry: { maxAttempts: 2, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(
    () => client.complete({ model: 'q', messages: [{ role: 'user', content: 'huge' }] }),
    (err: unknown) =>
      err instanceof LLMError && err.status === 500 && /context window/i.test(err.message),
  );
  assert.equal(calls.length, 2);
});

// 10. extra headers (e.g. through a private gateway) are forwarded.
test('ollama: custom headers (gateway auth) are forwarded', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      model: 'q', created_at: 't',
      message: { role: 'assistant', content: 'k' },
      done: true, done_reason: 'stop',
    }),
  ]);
  const provider = new OllamaProvider({
    fetchImpl: fetch,
    headers: { 'X-Gateway-Token': 'gw-secret' },
  });
  await provider.complete({ model: 'q', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(calls[0]!.headers['x-gateway-token'], 'gw-secret');
});

// 11. done=true with done_reason="length" maps to finishReason "length".
test('ollama: done_reason=length maps to "length"', async () => {
  const { fetch } = recordingFetch([
    () => jsonResponse(200, {
      model: 'q', created_at: 't',
      message: { role: 'assistant', content: 'truncated' },
      done: true, done_reason: 'length',
    }),
  ]);
  const provider = new OllamaProvider({ fetchImpl: fetch });
  const res = await provider.complete({ model: 'q', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(res.finishReason, 'length');
});
