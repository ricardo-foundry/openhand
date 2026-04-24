import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider } from '../src';
import type { CompletionRequest } from '../src';

const baseRequest: CompletionRequest = {
  model: 'mock',
  messages: [{ role: 'user', content: 'hi' }],
};

test('MockProvider.info advertises an offline provider', () => {
  const p = new MockProvider();
  assert.equal(p.info.id, 'mock');
  assert.equal(p.info.supportsTools, false);
  assert.equal(p.info.supportsStreaming, true);
  assert.match(p.info.label, /offline/i);
});

test('MockProvider.complete returns the canned reply and counts usage', async () => {
  const p = new MockProvider({ reply: 'canned answer' });
  const res = await p.complete(baseRequest);
  assert.equal(res.content, 'canned answer');
  assert.equal(res.finishReason, 'stop');
  assert.ok(res.usage);
  assert.ok(res.usage!.totalTokens > 0);
  assert.equal(p.calls, 1);
});

test('MockProvider.complete cycles through the replies queue', async () => {
  const p = new MockProvider({ replies: ['first', 'second', 'third'] });
  const a = await p.complete(baseRequest);
  const b = await p.complete(baseRequest);
  const c = await p.complete(baseRequest);
  const d = await p.complete(baseRequest); // wraps
  assert.equal(a.content, 'first');
  assert.equal(b.content, 'second');
  assert.equal(c.content, 'third');
  assert.equal(d.content, 'first');
});

test('MockProvider.complete prefers handler over replies', async () => {
  const seen: string[] = [];
  const p = new MockProvider({
    reply: 'ignored',
    handler: req => {
      const last = req.messages[req.messages.length - 1];
      seen.push(last?.content ?? '');
      return `echo: ${last?.content ?? ''}`;
    },
  });
  const res = await p.complete({
    ...baseRequest,
    messages: [{ role: 'user', content: 'ping' }],
  });
  assert.equal(res.content, 'echo: ping');
  assert.deepEqual(seen, ['ping']);
});

test('MockProvider.stream yields small deltas and a terminal usage chunk', async () => {
  const p = new MockProvider({ reply: 'abcdefgh', chunkSize: 3 });
  const deltas: string[] = [];
  let finish: string | undefined;
  for await (const chunk of p.stream(baseRequest)) {
    deltas.push(chunk.delta);
    if (chunk.finishReason) finish = chunk.finishReason;
  }
  // three 3-char chunks + terminal empty frame
  assert.deepEqual(deltas.filter(d => d !== ''), ['abc', 'def', 'gh']);
  assert.equal(finish, 'stop');
});
