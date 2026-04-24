import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'node:path';
import * as os from 'node:os';
import { SecureSandbox } from '../src/sandbox';

test('isPathAllowed rejects paths outside allowedPaths', async () => {
  const sandbox = new SecureSandbox({ allowedPaths: ['/tmp/openhand-allowed'] });
  // Indirect probe through readFile (isPathAllowed is private).
  await assert.rejects(
    () => sandbox.readFile('/etc/passwd'),
    /Access denied/,
  );
});

test('isPathAllowed is boundary-safe (no prefix-match bypass)', async () => {
  // `/tmp/a-evil` must NOT match allowed `/tmp/a`.
  const sandbox = new SecureSandbox({ allowedPaths: ['/tmp/allowed-boundary'] });
  await assert.rejects(
    () => sandbox.readFile('/tmp/allowed-boundary-evil'),
    /Access denied/,
  );
});

test('isPathAllowed rejects paths with NUL bytes', async () => {
  const sandbox = new SecureSandbox({ allowedPaths: [os.tmpdir()] });
  await assert.rejects(
    () => sandbox.readFile(path.join(os.tmpdir(), 'evil\0file')),
    /Access denied/,
  );
});

test('execute() rejects commands outside the allowlist', async () => {
  const sandbox = new SecureSandbox({ allowedPaths: [os.tmpdir()] });
  const result = await sandbox.execute('rm', ['-rf', '/']);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /not in the allowed list/);
});

test('execute() refuses bash -c even if bash were allowlisted', async () => {
  const sandbox = new SecureSandbox({
    allowedPaths: [os.tmpdir()],
    allowedCommands: ['bash', 'echo'],
  });
  const result = await sandbox.execute('bash', ['-c', 'rm -rf /tmp/whatever']);
  assert.equal(result.success, false);
  assert.match(result.error ?? '', /not permitted/);
});

test('execute() runs an allowlisted command successfully', async () => {
  const sandbox = new SecureSandbox({
    allowedPaths: [os.tmpdir()],
    allowedCommands: ['echo'],
  });
  const result = await sandbox.execute('echo', ['hello', 'sandbox']);
  assert.equal(result.success, true);
  assert.match(result.output, /hello sandbox/);
});

test('execute() does not invoke a shell (no metacharacter expansion)', async () => {
  const sandbox = new SecureSandbox({
    allowedPaths: [os.tmpdir()],
    allowedCommands: ['echo'],
  });
  // If a shell were used, `$(whoami)` would be interpolated. With
  // `shell: false`, the token is passed through verbatim.
  const result = await sandbox.execute('echo', ['$(whoami)']);
  assert.equal(result.success, true);
  assert.match(result.output, /\$\(whoami\)/);
});

test('readFile / writeFile roundtrip inside allowedPaths', async () => {
  const dir = await import('node:fs/promises').then(fs =>
    fs.mkdtemp(path.join(os.tmpdir(), 'oh-test-')),
  );
  const sandbox = new SecureSandbox({ allowedPaths: [dir] });
  const file = path.join(dir, 'nested', 'hello.txt');
  await sandbox.writeFile(file, 'hi');
  const content = await sandbox.readFile(file);
  assert.equal(content, 'hi');
});

test('execution timeout kills the child', async () => {
  const sandbox = new SecureSandbox({
    allowedPaths: [os.tmpdir()],
    allowedCommands: ['sleep'],
    timeout: 200,
  });
  const start = Date.now();
  const result = await sandbox.execute('sleep', ['30']);
  const elapsed = Date.now() - start;
  assert.equal(result.success, false);
  assert.ok(elapsed < 5000, `should have timed out quickly, took ${elapsed}ms`);
});

test('getPolicy returns a frozen snapshot of the effective allow-lists', () => {
  const root = path.join(os.tmpdir(), 'oh-policy-probe');
  const sandbox = new SecureSandbox({
    allowedPaths: [root],
    allowedCommands: ['ls', 'echo'],
    timeout: 7_500,
    memoryLimit: 42,
  });
  const p = sandbox.getPolicy();

  assert.deepEqual([...p.allowedCommands], ['echo', 'ls']);
  assert.equal(p.allowedPaths.length, 1);
  assert.equal(p.timeoutMs, 7_500);
  assert.equal(p.memoryLimitMb, 42);
  assert.equal(p.networkEnabled, false);
  // Snapshot must not allow a caller to mutate allow-lists after the fact.
  assert.ok(Object.isFrozen(p));
  assert.ok(Object.isFrozen(p.allowedCommands));
  assert.ok(Object.isFrozen(p.allowedPaths));
});

test('getPolicy falls back to the default command allowlist', () => {
  const sandbox = new SecureSandbox({ allowedPaths: [os.tmpdir()] });
  const p = sandbox.getPolicy();
  assert.ok(p.allowedCommands.includes('ls'));
  assert.ok(p.allowedCommands.includes('cat'));
  // Must NOT include shells / code-eval binaries.
  assert.ok(!p.allowedCommands.includes('bash'));
  assert.ok(!p.allowedCommands.includes('node'));
});
