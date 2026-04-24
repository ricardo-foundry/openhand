import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertSafeUrl } from '../src/browser';

test('assertSafeUrl allows ordinary https URL', () => {
  const url = assertSafeUrl('https://example.com/path?q=1');
  assert.equal(url.hostname, 'example.com');
});

test('assertSafeUrl rejects file:// scheme', () => {
  assert.throws(() => assertSafeUrl('file:///etc/passwd'), /Disallowed URL scheme/);
});

test('assertSafeUrl rejects data: URL', () => {
  assert.throws(() => assertSafeUrl('data:text/plain,hello'), /Disallowed URL scheme/);
});

test('assertSafeUrl rejects localhost', () => {
  assert.throws(() => assertSafeUrl('http://localhost/admin'), /Blocked hostname/);
});

test('assertSafeUrl rejects loopback IPv4', () => {
  assert.throws(() => assertSafeUrl('http://127.0.0.1/'), /private\/loopback/);
});

test('assertSafeUrl rejects AWS metadata endpoint (169.254.169.254)', () => {
  assert.throws(() => assertSafeUrl('http://169.254.169.254/latest/meta-data/'), /private\/loopback/);
});

test('assertSafeUrl rejects RFC1918 10/8', () => {
  assert.throws(() => assertSafeUrl('http://10.0.0.5/'), /private\/loopback/);
});

test('assertSafeUrl rejects RFC1918 192.168/16', () => {
  assert.throws(() => assertSafeUrl('http://192.168.1.1/admin'), /private\/loopback/);
});

test('assertSafeUrl rejects RFC1918 172.16/12', () => {
  assert.throws(() => assertSafeUrl('http://172.20.0.1/'), /private\/loopback/);
});

test('assertSafeUrl rejects GCE metadata hostname', () => {
  assert.throws(
    () => assertSafeUrl('http://metadata.google.internal/'),
    /Blocked hostname/,
  );
});

test('assertSafeUrl rejects IPv6 loopback ::1', () => {
  assert.throws(() => assertSafeUrl('http://[::1]/'), /private\/loopback/);
});
