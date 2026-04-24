import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OllamaProvider, LLMError } from '../src';
import type { CompletionRequest } from '../src';

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function ndjsonResponse(objs: unknown[]): Response {
  const body = objs.map(o => JSON.stringify(o)).join('\n');
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/x-ndjson' },
  });
}

const baseRequest: CompletionRequest = {
  model: 'llama3',
  messages: [{ role: 'user', content: 'hello' }],
};

test('OllamaProvider.info is local-labeled', () => {
  const p = new OllamaProvider();
  assert.equal(p.info.id, 'ollama');
  assert.match(p.info.label, /local/i);
});

test('complete() parses `/api/chat` response and maps usage', async () => {
  let seenUrl = '';
  const fetchImpl: typeof fetch = async input => {
    seenUrl = typeof input === 'string' ? input : (input as URL).toString();
    return jsonResponse({
      model: 'llama3',
      created_at: '2024-01-01T00:00:00Z',
      message: { role: 'assistant', content: 'hi from local' },
      done: true,
      done_reason: 'stop',
      prompt_eval_count: 4,
      eval_count: 5,
    });
  };

  const p = new OllamaProvider({ fetchImpl });
  const res = await p.complete(baseRequest);
  assert.match(seenUrl, /\/api\/chat$/);
  assert.equal(res.content, 'hi from local');
  assert.equal(res.finishReason, 'stop');
  assert.equal(res.usage?.promptTokens, 4);
  assert.equal(res.usage?.completionTokens, 5);
  assert.equal(res.usage?.totalTokens, 9);
});

test('complete() surfaces Ollama tool calls', async () => {
  const fetchImpl: typeof fetch = async () =>
    jsonResponse({
      model: 'llama3',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [
          { function: { name: 'file_read', arguments: { path: '/tmp/x' } } },
        ],
      },
      done: true,
      done_reason: 'stop',
    });

  const p = new OllamaProvider({ fetchImpl });
  const res = await p.complete(baseRequest);
  assert.equal(res.finishReason, 'tool_calls');
  assert.equal(res.toolCalls?.length, 1);
  assert.equal(res.toolCalls?.[0]?.name, 'file_read');
});

test('complete() throws LLMError when model is unknown', async () => {
  const fetchImpl: typeof fetch = async () =>
    new Response('model "mistery" not found', { status: 404 });
  const p = new OllamaProvider({ fetchImpl });
  await assert.rejects(
    () => p.complete(baseRequest),
    (err: unknown) => {
      assert.ok(err instanceof LLMError);
      assert.equal((err as LLMError).status, 404);
      assert.equal((err as LLMError).provider, 'ollama');
      return true;
    },
  );
});

test('stream() yields deltas from ndjson chunks and terminal usage', async () => {
  const fetchImpl: typeof fetch = async () =>
    ndjsonResponse([
      { message: { role: 'assistant', content: 'he' }, done: false },
      { message: { role: 'assistant', content: 'llo' }, done: false },
      {
        message: { role: 'assistant', content: '' },
        done: true,
        done_reason: 'stop',
        prompt_eval_count: 2,
        eval_count: 3,
      },
    ]);
  const p = new OllamaProvider({ fetchImpl });

  const collected: string[] = [];
  let finishReason: string | undefined;
  let totalTokens = 0;
  for await (const chunk of p.stream(baseRequest)) {
    collected.push(chunk.delta);
    if (chunk.finishReason) finishReason = chunk.finishReason;
    if (chunk.usage) totalTokens = chunk.usage.totalTokens;
  }
  assert.equal(collected.join(''), 'hello');
  assert.equal(finishReason, 'stop');
  assert.equal(totalTokens, 5);
});

test('complete() routes maxTokens into options.num_predict', async () => {
  let sentBody: any = null;
  const fetchImpl: typeof fetch = async (_input, init) => {
    sentBody = JSON.parse(String(init?.body ?? '{}'));
    return jsonResponse({
      model: 'llama3',
      message: { role: 'assistant', content: 'ok' },
      done: true,
      done_reason: 'stop',
    });
  };

  const p = new OllamaProvider({ fetchImpl });
  await p.complete({ ...baseRequest, maxTokens: 64, temperature: 0.2 });
  assert.equal(sentBody.options.num_predict, 64);
  assert.equal(sentBody.options.temperature, 0.2);
});
