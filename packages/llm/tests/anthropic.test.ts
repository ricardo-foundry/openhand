import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AnthropicProvider, LLMError } from '../src';
import type { CompletionRequest } from '../src';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

const baseRequest: CompletionRequest = {
  model: 'claude-3-5-sonnet-latest',
  messages: [
    { role: 'system', content: 'you are terse' },
    { role: 'user', content: 'hello' },
  ],
};

test('AnthropicProvider.info advertises tools + streaming', () => {
  const p = new AnthropicProvider({ apiKey: 'test' });
  assert.equal(p.info.id, 'anthropic');
  assert.equal(p.info.supportsTools, true);
});

test('complete() parses text content and usage', async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      id: 'msg-1',
      model: 'claude-3-5-sonnet-latest',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'hi there' }],
      usage: { input_tokens: 12, output_tokens: 3 },
    });

  const p = new AnthropicProvider({ apiKey: 'test', fetchImpl });
  const res = await p.complete(baseRequest);
  assert.equal(res.content, 'hi there');
  assert.equal(res.finishReason, 'stop');
  assert.equal(res.usage?.promptTokens, 12);
  assert.equal(res.usage?.totalTokens, 15);
});

test('complete() hoists system message into top-level `system` field', async () => {
  let sentBody: any = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    sentBody = JSON.parse(String(init?.body ?? '{}'));
    return jsonResponse({
      id: 'msg-2',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'ok' }],
    });
  };

  const p = new AnthropicProvider({ apiKey: 'test', fetchImpl });
  await p.complete(baseRequest);

  assert.equal(sentBody.system, 'you are terse');
  assert.equal(sentBody.messages.length, 1);
  assert.equal(sentBody.messages[0].role, 'user');
  assert.ok(typeof sentBody.max_tokens === 'number');
});

test('complete() surfaces tool_use blocks as toolCalls', async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      id: 'msg-3',
      stop_reason: 'tool_use',
      content: [
        { type: 'text', text: 'calling tool' },
        { type: 'tool_use', id: 'tu_1', name: 'file_read', input: { path: '/tmp/x' } },
      ],
    });

  const p = new AnthropicProvider({ apiKey: 'test', fetchImpl });
  const res = await p.complete(baseRequest);
  assert.equal(res.finishReason, 'tool_calls');
  assert.equal(res.toolCalls?.length, 1);
  assert.equal(res.toolCalls?.[0]?.name, 'file_read');
  assert.equal(res.toolCalls?.[0]?.argumentsJson, JSON.stringify({ path: '/tmp/x' }));
});

test('complete() sends x-api-key and anthropic-version headers', async () => {
  let seenUrl = '';
  let seenApiKey: string | null = null;
  let seenVersion: string | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = typeof input === 'string' ? input : (input as URL).toString();
    const headers = new Headers(init?.headers);
    seenApiKey = headers.get('x-api-key');
    seenVersion = headers.get('anthropic-version');
    return jsonResponse({ id: 'x', stop_reason: 'end_turn', content: [] });
  };

  const p = new AnthropicProvider({ apiKey: 'sk-ant-test', fetchImpl });
  await p.complete(baseRequest);
  assert.match(seenUrl, /\/messages$/);
  assert.equal(seenApiKey, 'sk-ant-test');
  assert.equal(seenVersion, '2023-06-01');
});

test('complete() throws LLMError on HTTP 429', async () => {
  const fetchImpl: typeof fetch = async () => new Response('slow down', { status: 429 });
  const p = new AnthropicProvider({ apiKey: 'test', fetchImpl });
  await assert.rejects(
    () => p.complete(baseRequest),
    (err: unknown) => {
      assert.ok(err instanceof LLMError);
      assert.equal((err as LLMError).code, 'http_error');
      assert.equal((err as LLMError).status, 429);
      return true;
    },
  );
});
