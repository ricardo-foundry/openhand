import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseShellCommand } from '../src/shell';

test('parseShellCommand splits simple tokens', () => {
  assert.deepEqual(parseShellCommand('echo hello world'), ['echo', 'hello', 'world']);
});

test('parseShellCommand keeps double-quoted spans intact', () => {
  assert.deepEqual(parseShellCommand('echo "hello world"'), ['echo', 'hello world']);
});

test('parseShellCommand keeps single-quoted spans intact', () => {
  assert.deepEqual(parseShellCommand("echo 'hi there'"), ['echo', 'hi there']);
});

test('parseShellCommand rejects pipes', () => {
  assert.throws(() => parseShellCommand('ls | grep foo'), /shell metacharacters/);
});

test('parseShellCommand rejects command substitution', () => {
  assert.throws(() => parseShellCommand('echo $(whoami)'), /shell metacharacters/);
});

test('parseShellCommand rejects backticks', () => {
  assert.throws(() => parseShellCommand('echo `whoami`'), /shell metacharacters/);
});

test('parseShellCommand rejects redirects', () => {
  assert.throws(() => parseShellCommand('cat /etc/passwd > /tmp/x'), /shell metacharacters/);
});

test('parseShellCommand rejects semicolon chains', () => {
  assert.throws(() => parseShellCommand('ls; rm -rf /'), /shell metacharacters/);
});

test('parseShellCommand rejects unterminated quotes', () => {
  assert.throws(() => parseShellCommand('echo "hello'), /Unterminated/);
});

test('parseShellCommand rejects empty input', () => {
  assert.throws(() => parseShellCommand(''), /empty command/);
});

test('parseShellCommand rejects NUL bytes', () => {
  assert.throws(() => parseShellCommand('echo a\0b'), /NUL byte/);
});
