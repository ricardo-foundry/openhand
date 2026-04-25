import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LineDecoder, encode, ERROR_CODES, JsonRpcRemoteError } from '../src/jsonrpc';

test('encode produces newline-terminated single line', () => {
  const out = encode({ jsonrpc: '2.0', id: 1, method: 'ping' });
  assert.equal(out.endsWith('\n'), true);
  assert.equal(out.split('\n').filter(Boolean).length, 1);
  const parsed = JSON.parse(out);
  assert.equal(parsed.method, 'ping');
});

test('LineDecoder buffers split lines and emits whole messages', () => {
  const dec = new LineDecoder();
  assert.deepEqual(dec.push('{"jsonrpc":"2.0","id":1,"resu'), []);
  const msgs = dec.push('lt":42}\n{"jsonrpc":"2.0","id":2,"result":7}\n');
  assert.equal(msgs.length, 2);
  assert.equal((msgs[0] as { result: number }).result, 42);
  assert.equal((msgs[1] as { result: number }).result, 7);
  assert.equal(dec.pending(), '');
});

test('LineDecoder surfaces parse errors as JsonRpcError frames (no throw)', () => {
  const dec = new LineDecoder();
  const msgs = dec.push('not json at all\n');
  assert.equal(msgs.length, 1);
  const m = msgs[0] as { error?: { code: number } };
  assert.equal(m.error?.code, ERROR_CODES.ParseError);
});

test('LineDecoder rejects non-2.0 framed JSON with InvalidRequest', () => {
  const dec = new LineDecoder();
  const msgs = dec.push('{"jsonrpc":"1.0","id":9,"result":true}\n');
  assert.equal(msgs.length, 1);
  const m = msgs[0] as { error?: { code: number } };
  assert.equal(m.error?.code, ERROR_CODES.InvalidRequest);
});

test('LineDecoder skips blank lines', () => {
  const dec = new LineDecoder();
  const msgs = dec.push('\n\n{"jsonrpc":"2.0","id":1,"result":1}\n\n');
  assert.equal(msgs.length, 1);
});

test('JsonRpcRemoteError carries code + data', () => {
  const e = new JsonRpcRemoteError(-32602, 'bad', { hint: 'x' });
  assert.equal(e.code, -32602);
  assert.equal(e.message, 'bad');
  assert.deepEqual(e.data, { hint: 'x' });
});
