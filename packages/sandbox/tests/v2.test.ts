import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wrapWithCpuLimit,
  wrapWithMemoryLimit,
  createNetGuardedFetch,
  NetworkBlockedError,
  NET_ENV_VAR,
  NET_ENV_VALUE_NONE,
} from '../src/v2';

// --- wrapWithCpuLimit -------------------------------------------------

test('wrapWithCpuLimit: rejects non-positive ms and leaves spawn untouched', () => {
  const a = wrapWithCpuLimit('ls', ['-l'], 0);
  assert.equal(a.applied, false);
  assert.equal(a.command, 'ls');
  assert.deepEqual(a.args, ['-l']);

  const b = wrapWithCpuLimit('ls', [], -5);
  assert.equal(b.applied, false);

  const c = wrapWithCpuLimit('ls', [], NaN);
  assert.equal(c.applied, false);
});

test('wrapWithCpuLimit: when timeout(1) is on PATH, prefixes the spawn', () => {
  const out = wrapWithCpuLimit('ls', ['-la', '/tmp'], 5000);
  // We don't assert which binary; on macOS without coreutils there may
  // be no `timeout`, so we just check the contract holds either way.
  if (out.applied) {
    assert.ok(out.command.endsWith('timeout') || out.command.endsWith('gtimeout'));
    assert.ok(out.args.includes('5'));
    assert.ok(out.args.includes('ls'));
    assert.ok(out.args.includes('-la'));
    assert.ok(out.args.includes('/tmp'));
    // --kill-after must be present so a SIGTERM-ignoring child still gets SIGKILL.
    assert.ok(out.args.some(a => a.startsWith('--kill-after=')));
  } else {
    // Fallback path keeps the original spawn pair intact.
    assert.equal(out.command, 'ls');
    assert.deepEqual(out.args, ['-la', '/tmp']);
  }
});

test('wrapWithCpuLimit: rounds up sub-second values to 1s', () => {
  const out = wrapWithCpuLimit('ls', [], 100); // 100ms → ceil to 1s
  if (out.applied) {
    // The seconds arg should be exactly '1', and never '0' (0 would
    // mean "no timeout" to GNU coreutils).
    assert.ok(out.args.includes('1'));
    assert.ok(!out.args.includes('0'));
  }
});

// --- wrapWithMemoryLimit ----------------------------------------------

test('wrapWithMemoryLimit: rejects non-positive megabytes', () => {
  const a = wrapWithMemoryLimit('node', ['x.js'], 0);
  assert.equal(a.applied, false);
  assert.equal(a.command, 'node');
});

test('wrapWithMemoryLimit: applies via prlimit OR sh -c ulimit OR no-op', () => {
  const out = wrapWithMemoryLimit('node', ['script.js'], 256);
  if (out.applied) {
    if (out.command.endsWith('prlimit')) {
      assert.ok(out.args.some(a => a.startsWith('--as=')), 'prlimit should set --as=<bytes>');
      assert.ok(out.args.includes('node'));
      assert.ok(out.args.includes('script.js'));
    } else {
      // sh -c path
      assert.ok(out.command.endsWith('sh'));
      assert.equal(out.args[0], '-c');
      assert.match(out.args[1] ?? '', /ulimit -v \d+/);
      // The literal command and args follow as positionals.
      assert.equal(out.args[2], 'node');
      assert.equal(out.args[3], 'script.js');
    }
  } else {
    // No prlimit, no sh, no-op — original spawn preserved.
    assert.equal(out.command, 'node');
    assert.deepEqual(out.args, ['script.js']);
  }
});

test('wrapWithMemoryLimit: positional args are NEVER fed through shell parsing', () => {
  // A cunning user passes a path containing `;`. Whichever wrapper
  // path we land on, that string must reach the binary verbatim.
  const evil = '/tmp/oh; rm -rf /';
  const out = wrapWithMemoryLimit('cat', [evil], 64);
  // The literal evil string should appear once, unmodified, in args.
  assert.ok(out.args.includes(evil), 'evil arg must round-trip verbatim');
  // The shell wrapper string (if any) must NOT contain the evil substring —
  // it lives in the positional args instead.
  if (out.applied && out.command.endsWith('sh')) {
    assert.equal(out.args[0], '-c');
    assert.ok(!(out.args[1] ?? '').includes(evil), 'evil arg must not be inlined into the shell command');
  }
});

// --- createNetGuardedFetch --------------------------------------------

test('createNetGuardedFetch: NET=none rejects every call without invoking real fetch', async () => {
  let realCalled = 0;
  const fetchImpl: typeof fetch = async () => {
    realCalled++;
    return new Response('should not happen', { status: 200 });
  };
  const f = createNetGuardedFetch({ env: { NET: 'none' }, fetchImpl });
  await assert.rejects(
    () => f('https://example.com'),
    (err: unknown) => err instanceof NetworkBlockedError && err.url === 'https://example.com',
  );
  assert.equal(realCalled, 0);
});

test('createNetGuardedFetch: passthrough when NET is unset', async () => {
  let realCalled = 0;
  const fetchImpl: typeof fetch = async () => {
    realCalled++;
    return new Response('ok', { status: 200 });
  };
  const f = createNetGuardedFetch({ env: {}, fetchImpl });
  const res = await f('https://example.com');
  assert.equal(realCalled, 1);
  assert.equal(res.status, 200);
});

test('createNetGuardedFetch: passthrough when NET is set to anything other than "none"', async () => {
  let realCalled = 0;
  const fetchImpl: typeof fetch = async () => {
    realCalled++;
    return new Response('ok', { status: 200 });
  };
  // NET=full / NET=true / NET=1 should all NOT block — the contract is
  // strict equality with `none`.
  for (const value of ['full', 'true', '1', 'NONE', 'off']) {
    realCalled = 0;
    const f = createNetGuardedFetch({ env: { NET: value }, fetchImpl });
    const res = await f('https://example.com');
    assert.equal(realCalled, 1, `expected passthrough for NET=${value}`);
    assert.equal(res.status, 200);
  }
});

test('createNetGuardedFetch: handles URL and Request inputs', async () => {
  const f = createNetGuardedFetch({ env: { NET: 'none' } });
  await assert.rejects(
    () => f(new URL('https://api.example.com/path')),
    (err: unknown) =>
      err instanceof NetworkBlockedError && err.url === 'https://api.example.com/path',
  );
  await assert.rejects(
    () => f(new Request('https://api.example.com/x')),
    (err: unknown) =>
      err instanceof NetworkBlockedError && err.url.includes('https://api.example.com/x'),
  );
});

test('NET env constants are exported and unchanged', () => {
  assert.equal(NET_ENV_VAR, 'NET');
  assert.equal(NET_ENV_VALUE_NONE, 'none');
});
