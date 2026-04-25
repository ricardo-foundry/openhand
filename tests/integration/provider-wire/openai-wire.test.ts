/**
 * OpenAI wire-format integration tests.
 *
 * We don't hit the network. Instead we wrap the provider in a custom `fetchImpl`
 * that records every outbound request and returns canned `Response` objects
 * that mirror what the public API actually emits — same headers, same SSE
 * frame layout, same JSON shape — so we exercise the full
 * request-build + response-parse path without any vendor SDK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAIProvider } from '../../../packages/llm/src/openai';
import { LLMClient } from '../../../packages/llm/src/client';
import { LLMError } from '../../../packages/llm/src/types';

interface CapturedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

/** Build a minimal `fetchImpl` that records calls and returns scripted responses. */
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
      try {
        body = JSON.parse(rawBody);
      } catch {
        body = rawBody;
      }
    }
    calls.push({ url, method: init?.method ?? 'GET', headers, body });
    const next = scripted[i++];
    if (!next) throw new Error('recordingFetch: no scripted response left');
    return await next();
  };
  return { fetch: fn, calls };
}

function jsonResponse(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extraHeaders },
  });
}

function sseResponse(frames: string[]): Response {
  // Real OpenAI ends with `data: [DONE]`. Each frame already includes `data: …\n\n`.
  const body = frames.join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// 1. Successful chat completion — assert wire format both directions.
test('openai: successful completion sends bearer + parses choice', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      id: 'chatcmpl-abc',
      object: 'chat.completion',
      created: 1_700_000_000,
      model: 'gpt-4o-mini',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'pong' },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 7, completion_tokens: 1, total_tokens: 8 },
    }),
  ]);
  const provider = new OpenAIProvider({ apiKey: 'sk-test', fetchImpl: fetch });
  const res = await provider.complete({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'ping' }],
  });

  assert.equal(res.id, 'chatcmpl-abc');
  assert.equal(res.content, 'pong');
  assert.equal(res.finishReason, 'stop');
  assert.deepEqual(res.usage, { promptTokens: 7, completionTokens: 1, totalTokens: 8 });

  // outbound shape
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(calls[0]!.method, 'POST');
  assert.equal(calls[0]!.headers['authorization'], 'Bearer sk-test');
  assert.equal(calls[0]!.headers['content-type'], 'application/json');
  assert.equal(calls[0]!.body.model, 'gpt-4o-mini');
  assert.equal(calls[0]!.body.stream, false);
  assert.deepEqual(calls[0]!.body.messages, [{ role: 'user', content: 'ping' }]);
});

// 2. 429 → retry → success on second attempt.
test('openai: 429 with Retry-After triggers backoff retry', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(429, { error: { message: 'rate limited' } }, { 'retry-after': '1' }),
    () => jsonResponse(200, {
      id: 'chatcmpl-2',
      model: 'gpt-4o-mini',
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
  ]);
  const client = new LLMClient({
    provider: new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  const res = await client.complete({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.equal(res.content, 'ok');
  assert.equal(calls.length, 2);
});

// 3. 5xx exhausts attempts → LLMError with status.
test('openai: 503 exhausts retries and surfaces LLMError', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(503, { error: { message: 'overloaded' } }),
    () => jsonResponse(503, { error: { message: 'overloaded' } }),
    () => jsonResponse(503, { error: { message: 'overloaded' } }),
  ]);
  const client = new LLMClient({
    provider: new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(
    () => client.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] }),
    (err: unknown) => err instanceof LLMError && err.status === 503,
  );
  assert.equal(calls.length, 3);
});

// 4. tool_calls JSON arguments are surfaced verbatim.
test('openai: tool_calls in choice.message are parsed', async () => {
  const toolCalls = [
    {
      id: 'call_123',
      type: 'function',
      function: {
        name: 'get_weather',
        arguments: '{"city":"SF","unit":"C"}',
      },
    },
  ];
  const { fetch } = recordingFetch([
    () => jsonResponse(200, {
      id: 'chatcmpl-tc',
      model: 'gpt-4o',
      choices: [
        {
          message: { role: 'assistant', content: '', tool_calls: toolCalls },
          finish_reason: 'tool_calls',
        },
      ],
    }),
  ]);
  const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch });
  const res = await provider.complete({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'weather sf' }],
    tools: [
      {
        name: 'get_weather',
        description: 'lookup',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    ],
  });
  assert.equal(res.finishReason, 'tool_calls');
  assert.ok(res.toolCalls);
  assert.equal(res.toolCalls!.length, 1);
  assert.equal(res.toolCalls![0]!.id, 'call_123');
  assert.equal(res.toolCalls![0]!.name, 'get_weather');
  assert.equal(res.toolCalls![0]!.argumentsJson, '{"city":"SF","unit":"C"}');
});

// 5. SSE deltas concatenate into the full body.
test('openai: SSE stream stitches deltas into final text', async () => {
  const frames = [
    'data: {"choices":[{"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"world"}, "finish_reason":null}]}\n\n',
    'data: {"choices":[{"delta":{}, "finish_reason":"stop"}], "usage":{"prompt_tokens":3,"completion_tokens":5,"total_tokens":8}}\n\n',
  ];
  const { fetch, calls } = recordingFetch([() => sseResponse(frames)]);
  const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch });
  const out: string[] = [];
  let finalUsage: any = null;
  for await (const chunk of provider.stream({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: 'hi' }],
  })) {
    out.push(chunk.delta);
    if (chunk.finishReason) finalUsage = chunk.usage;
  }
  assert.equal(out.join(''), 'Hello world');
  assert.deepEqual(finalUsage, { promptTokens: 3, completionTokens: 5, totalTokens: 8 });
  assert.equal(calls[0]!.body.stream, true);
});

// 6. Non-JSON body in error path → LLMError with code http_error.
test('openai: HTML error body still becomes LLMError', async () => {
  const { fetch } = recordingFetch([
    () => new Response('<html>nginx 502</html>', {
      status: 502,
      headers: { 'content-type': 'text/html' },
    }),
  ]);
  const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch });
  await assert.rejects(
    () => provider.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'x' }] }),
    (err: unknown) =>
      err instanceof LLMError && err.status === 502 && err.code === 'http_error',
  );
});

// 7. Custom org/header passes through.
test('openai: extra headers + organization are forwarded', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      choices: [{ message: { role: 'assistant', content: 'k' }, finish_reason: 'stop' }],
    }),
  ]);
  const provider = new OpenAIProvider({
    apiKey: 'sk',
    fetchImpl: fetch,
    headers: { 'OpenAI-Organization': 'org-abc', 'X-Trace': 'trace-1' },
  });
  await provider.complete({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(calls[0]!.headers['openai-organization'], 'org-abc');
  assert.equal(calls[0]!.headers['x-trace'], 'trace-1');
});

// 8. Context-overflow style 400 error surfaces verbatim.
test('openai: 400 context_length_exceeded does not retry', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(400, {
      error: {
        message: "context length exceeded",
        type: 'invalid_request_error',
        code: 'context_length_exceeded',
      },
    }),
    () => jsonResponse(200, { choices: [] }),
  ]);
  const client = new LLMClient({
    provider: new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(
    () => client.complete({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'huge' }],
    }),
    (err: unknown) => err instanceof LLMError && err.status === 400,
  );
  // 400 is non-retriable per defaultShouldRetry.
  assert.equal(calls.length, 1);
});

// 9. Provider passes baseUrl override correctly (Azure / vLLM scenario).
test('openai: baseUrl override hits custom endpoint without trailing slash', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
  ]);
  const provider = new OpenAIProvider({
    apiKey: 'sk',
    baseUrl: 'http://localhost:8000/v1/',
    fetchImpl: fetch,
  });
  await provider.complete({ model: 'qwen', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(calls[0]!.url, 'http://localhost:8000/v1/chat/completions');
});

// 10. Tool schema is forwarded as `function` typed list.
test('openai: tool schema is wrapped under {type:"function", function:{...}}', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      choices: [{ message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
    }),
  ]);
  const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch });
  await provider.complete({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: 'go' }],
    tools: [
      {
        name: 'do_thing',
        description: 'desc',
        parameters: { type: 'object', properties: { x: { type: 'string' } }, required: ['x'] },
      },
    ],
  });
  const tools = calls[0]!.body.tools;
  assert.ok(Array.isArray(tools));
  assert.equal(tools[0].type, 'function');
  assert.equal(tools[0].function.name, 'do_thing');
  assert.equal(tools[0].function.description, 'desc');
  assert.deepEqual(tools[0].function.parameters.required, ['x']);
});

// 11. Empty `choices` array maps to LLMError.
test('openai: empty choices yields no_choice LLMError', async () => {
  const { fetch } = recordingFetch([() => jsonResponse(200, { choices: [] })]);
  const provider = new OpenAIProvider({ apiKey: 'sk', fetchImpl: fetch });
  await assert.rejects(
    () => provider.complete({ model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] }),
    (err: unknown) => err instanceof LLMError && err.code === 'no_choice',
  );
});
