import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAIProvider, LLMError } from '../src';
import type { CompletionRequest } from '../src';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function sseResponse(chunks: string[]): Response {
  const body = chunks.map(c => `data: ${c}\n\n`).join('') + 'data: [DONE]\n\n';
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

const baseRequest: CompletionRequest = {
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'hello' }],
};

test('OpenAIProvider.info advertises tools + streaming', () => {
  const p = new OpenAIProvider({ apiKey: 'test' });
  assert.equal(p.info.id, 'openai');
  assert.equal(p.info.supportsTools, true);
  assert.equal(p.info.supportsStreaming, true);
});

test('complete() parses a successful chat completion', async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      id: 'cmpl-1',
      model: 'gpt-4o-mini',
      choices: [
        {
          finish_reason: 'stop',
          message: { role: 'assistant', content: 'hi there' },
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
    });

  const p = new OpenAIProvider({ apiKey: 'test', fetchImpl });
  const res = await p.complete(baseRequest);
  assert.equal(res.content, 'hi there');
  assert.equal(res.finishReason, 'stop');
  assert.equal(res.usage?.totalTokens, 7);
  assert.equal(res.toolCalls, undefined);
});

test('complete() surfaces tool calls', async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      id: 'cmpl-2',
      model: 'gpt-4o-mini',
      choices: [
        {
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'call_1',
                type: 'function',
                function: { name: 'file_read', arguments: '{"path":"/tmp/x"}' },
              },
            ],
          },
        },
      ],
    });

  const p = new OpenAIProvider({ apiKey: 'test', fetchImpl });
  const res = await p.complete(baseRequest);
  assert.equal(res.finishReason, 'tool_calls');
  assert.equal(res.toolCalls?.length, 1);
  assert.equal(res.toolCalls?.[0]?.name, 'file_read');
  assert.equal(res.toolCalls?.[0]?.argumentsJson, '{"path":"/tmp/x"}');
  assert.equal(res.content, '');
});

test('complete() throws LLMError on HTTP 4xx', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('bad key', { status: 401 });
  const p = new OpenAIProvider({ apiKey: 'test', fetchImpl });
  await assert.rejects(() => p.complete(baseRequest), (err: unknown) => {
    assert.ok(err instanceof LLMError);
    assert.equal((err as LLMError).code, 'http_error');
    assert.equal((err as LLMError).status, 401);
    return true;
  });
});

test('complete() throws when provider returns no choices', async () => {
  const fetchImpl: typeof fetch = async () => jsonResponse({ id: 'x', choices: [] });
  const p = new OpenAIProvider({ apiKey: 'test', fetchImpl });
  await assert.rejects(() => p.complete(baseRequest), (err: unknown) => {
    assert.ok(err instanceof LLMError);
    assert.equal((err as LLMError).code, 'no_choice');
    return true;
  });
});

test('complete() sends authorization header and correct URL', async () => {
  let seenUrl = '';
  let seenAuth: string | null = null;
  const fetchImpl: typeof fetch = async (input, init) => {
    seenUrl = typeof input === 'string' ? input : (input as URL).toString();
    const headers = new Headers(init?.headers);
    seenAuth = headers.get('authorization');
    return jsonResponse({
      id: 'cmpl-3',
      choices: [{ finish_reason: 'stop', message: { content: 'ok' } }],
    });
  };
  const p = new OpenAIProvider({ apiKey: 'sk-test', baseUrl: 'https://example.test/v1/', fetchImpl });
  await p.complete(baseRequest);
  assert.equal(seenUrl, 'https://example.test/v1/chat/completions');
  assert.equal(seenAuth, 'Bearer sk-test');
});

test('stream() yields deltas and the terminal chunk carries finishReason', async () => {
  const fetchImpl: typeof fetch = async () =>
    sseResponse([
      JSON.stringify({ choices: [{ delta: { content: 'he' } }] }),
      JSON.stringify({ choices: [{ delta: { content: 'llo' } }] }),
      JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
    ]);
  const p = new OpenAIProvider({ apiKey: 'test', fetchImpl });
  const collected: string[] = [];
  let finish: string | undefined;
  for await (const chunk of p.stream(baseRequest)) {
    collected.push(chunk.delta);
    if (chunk.finishReason) finish = chunk.finishReason;
  }
  assert.equal(collected.join(''), 'hello');
  assert.equal(finish, 'stop');
});
