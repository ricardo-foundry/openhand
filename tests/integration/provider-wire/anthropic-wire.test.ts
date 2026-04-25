/**
 * Anthropic wire-format integration tests. We model the public Messages API:
 *   - x-api-key header (NOT Authorization: Bearer)
 *   - anthropic-version header
 *   - typed content blocks (text / tool_use / tool_result)
 *   - SSE event types: message_start, content_block_delta, message_delta,
 *     message_stop
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AnthropicProvider } from '../../../packages/llm/src/anthropic';
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

function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...extra },
  });
}

function sseResponse(events: Array<{ event: string; data: unknown }>): Response {
  let body = '';
  for (const e of events) {
    body += `event: ${e.event}\n`;
    body += `data: ${JSON.stringify(e.data)}\n\n`;
  }
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

// 1. successful completion → text + usage normalised
test('anthropic: text-only completion is parsed; system message is hoisted', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      id: 'msg_01abc',
      type: 'message',
      role: 'assistant',
      model: 'claude-3-5-sonnet-20240620',
      content: [{ type: 'text', text: 'Hello there.' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 12, output_tokens: 4 },
    }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk-ant', fetchImpl: fetch });
  const res = await provider.complete({
    model: 'claude-3-5-sonnet-20240620',
    messages: [
      { role: 'system', content: 'be concise' },
      { role: 'user', content: 'Hi' },
    ],
  });
  assert.equal(res.content, 'Hello there.');
  assert.equal(res.finishReason, 'stop');
  assert.deepEqual(res.usage, { promptTokens: 12, completionTokens: 4, totalTokens: 16 });

  // wire-shape assertions
  assert.equal(calls[0]!.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(calls[0]!.headers['x-api-key'], 'sk-ant');
  assert.equal(calls[0]!.headers['anthropic-version'], '2023-06-01');
  assert.equal(calls[0]!.body.system, 'be concise');
  assert.deepEqual(calls[0]!.body.messages, [
    { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
  ]);
  assert.equal(calls[0]!.body.max_tokens, 1024);
});

// 2. tool_use content block becomes a normalised ToolCall.
test('anthropic: tool_use block becomes ToolCall with json arguments', async () => {
  const { fetch } = recordingFetch([
    () => jsonResponse(200, {
      id: 'msg_tool',
      model: 'claude-3-5-sonnet-20240620',
      content: [
        { type: 'text', text: 'I will call the tool.' },
        { type: 'tool_use', id: 'tool_1', name: 'lookup', input: { q: 'cats' } },
      ],
      stop_reason: 'tool_use',
      usage: { input_tokens: 5, output_tokens: 3 },
    }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk-ant', fetchImpl: fetch });
  const res = await provider.complete({
    model: 'claude-3-5-sonnet-20240620',
    messages: [{ role: 'user', content: 'find cats' }],
    tools: [
      {
        name: 'lookup',
        description: 'search',
        parameters: { type: 'object', properties: { q: { type: 'string' } } },
      },
    ],
  });
  assert.equal(res.finishReason, 'tool_calls');
  assert.equal(res.content, 'I will call the tool.');
  assert.ok(res.toolCalls);
  assert.equal(res.toolCalls!.length, 1);
  assert.equal(res.toolCalls![0]!.name, 'lookup');
  assert.deepEqual(JSON.parse(res.toolCalls![0]!.argumentsJson), { q: 'cats' });
});

// 3. tools schema wired correctly (Anthropic uses `input_schema`, not `parameters`).
test('anthropic: tools[].input_schema is forwarded (NOT "parameters")', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      id: 'm', model: 'c', content: [{ type: 'text', text: 'k' }], stop_reason: 'end_turn',
    }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch });
  await provider.complete({
    model: 'claude-3',
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
  assert.equal(tools[0].name, 'do_thing');
  assert.deepEqual(tools[0].input_schema.required, ['x']);
  // Crucially the OpenAI-style `function` wrapper is NOT present.
  assert.equal(tools[0].function, undefined);
  assert.equal(tools[0].type, undefined);
});

// 4. SSE event sequence is reassembled into deltas + terminal usage.
test('anthropic: SSE events stitch text deltas and final usage', async () => {
  const { fetch } = recordingFetch([
    () => sseResponse([
      { event: 'message_start', data: { type: 'message_start', message: { id: 'm1', usage: { input_tokens: 8, output_tokens: 0 } } } },
      { event: 'content_block_start', data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi ' } } },
      { event: 'content_block_delta', data: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'there' } } },
      { event: 'content_block_stop', data: { type: 'content_block_stop', index: 0 } },
      { event: 'message_delta', data: { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } } },
      { event: 'message_stop', data: { type: 'message_stop' } },
    ]),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch });
  const out: string[] = [];
  let usage: any = null;
  let finishReason: string | undefined;
  for await (const c of provider.stream({
    model: 'claude-3', messages: [{ role: 'user', content: 'hi' }],
  })) {
    if (c.delta) out.push(c.delta);
    if (c.finishReason) { finishReason = c.finishReason; usage = c.usage; }
  }
  assert.equal(out.join(''), 'Hi there');
  assert.equal(finishReason, 'stop');
  assert.deepEqual(usage, { promptTokens: 8, completionTokens: 2, totalTokens: 10 });
});

// 5. 401 invalid key — non-retriable through default policy.
test('anthropic: 401 invalid_api_key fails fast', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(401, { type: 'error', error: { type: 'authentication_error', message: 'bad key' } }),
    () => jsonResponse(200, { content: [{ type: 'text', text: 'never' }], stop_reason: 'end_turn' }),
  ]);
  const client = new LLMClient({
    provider: new AnthropicProvider({ apiKey: 'wrong', fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  await assert.rejects(
    () => client.complete({ model: 'c', messages: [{ role: 'user', content: 'q' }] }),
    (err: unknown) => err instanceof LLMError && err.status === 401,
  );
  assert.equal(calls.length, 1);
});

// 6. Overloaded 529 path → retries to success.
test('anthropic: 529 overloaded retries via LLMClient', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(529, { type: 'error', error: { type: 'overloaded_error', message: 'overloaded' } }),
    () => jsonResponse(200, {
      id: 'm2', model: 'c',
      content: [{ type: 'text', text: 'recovered' }],
      stop_reason: 'end_turn',
    }),
  ]);
  const client = new LLMClient({
    provider: new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch }),
    retry: { maxAttempts: 3, initialDelayMs: 1, maxDelayMs: 1, sleep: async () => {} },
  });
  const res = await client.complete({
    model: 'c', messages: [{ role: 'user', content: 'q' }],
  });
  assert.equal(res.content, 'recovered');
  assert.equal(calls.length, 2);
});

// 7. context overflow on Anthropic = 400 invalid_request_error.
test('anthropic: 400 context overflow surfaces unmolested', async () => {
  const { fetch } = recordingFetch([
    () => jsonResponse(400, {
      type: 'error',
      error: { type: 'invalid_request_error', message: 'prompt is too long' },
    }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch });
  await assert.rejects(
    () => provider.complete({ model: 'c', messages: [{ role: 'user', content: 'huge' }] }),
    (err: unknown) =>
      err instanceof LLMError && err.status === 400 && /too long/i.test(err.message),
  );
});

// 8. multi-system message join — Anthropic only takes a single string.
test('anthropic: multiple system messages collapse to a single join', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, {
      content: [{ type: 'text', text: 'k' }],
      stop_reason: 'end_turn',
    }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch });
  await provider.complete({
    model: 'c',
    messages: [
      { role: 'system', content: 'persona A' },
      { role: 'system', content: 'rules B' },
      { role: 'user', content: 'go' },
    ],
  });
  assert.equal(calls[0]!.body.system, 'persona A\n\nrules B');
});

// 9. max_tokens default + override
test('anthropic: maxTokens override is forwarded; default is 1024', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, { content: [{ type: 'text', text: 'k' }], stop_reason: 'end_turn' }),
    () => jsonResponse(200, { content: [{ type: 'text', text: 'k' }], stop_reason: 'end_turn' }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch });
  await provider.complete({ model: 'c', messages: [{ role: 'user', content: 'q' }] });
  await provider.complete({ model: 'c', messages: [{ role: 'user', content: 'q' }], maxTokens: 256 });
  assert.equal(calls[0]!.body.max_tokens, 1024);
  assert.equal(calls[1]!.body.max_tokens, 256);
});

// 10. anthropic-version header is overrideable.
test('anthropic: apiVersion override is honoured on the wire', async () => {
  const { fetch, calls } = recordingFetch([
    () => jsonResponse(200, { content: [{ type: 'text', text: 'k' }], stop_reason: 'end_turn' }),
  ]);
  const provider = new AnthropicProvider({
    apiKey: 'sk', fetchImpl: fetch, apiVersion: '2024-10-01',
  });
  await provider.complete({ model: 'c', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(calls[0]!.headers['anthropic-version'], '2024-10-01');
});

// 11. Anthropic stop_reason: max_tokens → finishReason 'length'
test('anthropic: stop_reason=max_tokens maps to "length"', async () => {
  const { fetch } = recordingFetch([
    () => jsonResponse(200, {
      content: [{ type: 'text', text: 'cut off' }],
      stop_reason: 'max_tokens',
      usage: { input_tokens: 1, output_tokens: 100 },
    }),
  ]);
  const provider = new AnthropicProvider({ apiKey: 'sk', fetchImpl: fetch });
  const res = await provider.complete({ model: 'c', messages: [{ role: 'user', content: 'q' }] });
  assert.equal(res.finishReason, 'length');
});
