import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import * as os from 'os';
import {
  checkPath,
  checkCommand,
  DEFAULT_ALLOWED_COMMANDS,
} from '../src/policy';

const tmp = os.tmpdir();

test('DEFAULT_ALLOWED_COMMANDS excludes shells and eval interpreters', () => {
  const forbidden = ['bash', 'sh', 'zsh', 'node', 'python', 'python3', 'perl', 'ruby'];
  for (const cmd of forbidden) {
    assert.ok(
      !DEFAULT_ALLOWED_COMMANDS.includes(cmd),
      `default allowlist unexpectedly contains ${cmd}`,
    );
  }
});

test('checkPath: allows nested path inside a root', () => {
  const root = path.join(tmp, 'workspace');
  const d = checkPath(path.join(root, 'nested', 'file.txt'), {
    allowedPaths: [root],
    allowedCommands: [],
  });
  assert.equal(d.allow, true);
});

test('checkPath: allows the root itself', () => {
  const root = path.join(tmp, 'root-eq');
  const d = checkPath(root, { allowedPaths: [root], allowedCommands: [] });
  assert.equal(d.allow, true);
});

test('checkPath: rejects path outside any root', () => {
  const d = checkPath('/etc/passwd', {
    allowedPaths: [path.join(tmp, 'only-here')],
    allowedCommands: [],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'path_outside_roots');
});

test('checkPath: prefix-boundary attack is refused', () => {
  // `/tmp/a-evil` should NOT match root `/tmp/a`
  const root = path.join(tmp, 'boundary');
  const d = checkPath(`${root}-evil/x`, { allowedPaths: [root], allowedCommands: [] });
  assert.equal(d.allow, false);
});

test('checkPath: rejects paths with NUL', () => {
  const d = checkPath('/tmp/ok\0/x', { allowedPaths: ['/tmp'], allowedCommands: [] });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'path_nul_byte');
});

test('checkPath: rejects empty path', () => {
  const d = checkPath('', { allowedPaths: ['/tmp'], allowedCommands: [] });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'path_empty');
});

test('checkCommand: allows a simple echo', () => {
  const d = checkCommand('echo', ['hello', 'world'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, true);
});

test('checkCommand: refuses bash -c even when bash is allowlisted', () => {
  const d = checkCommand('bash', ['-c', 'rm -rf /'], {
    allowedPaths: [],
    allowedCommands: ['bash'],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'arg_interpreter_flag');
});

test('checkCommand: refuses node --eval', () => {
  const d = checkCommand('node', ['--eval', 'process.exit(1)'], {
    allowedPaths: [],
    allowedCommands: ['node'],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'arg_interpreter_flag');
});

test('checkCommand: refuses $(...) in args', () => {
  const d = checkCommand('echo', ['$(whoami)'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'arg_shell_metachars');
});

test('checkCommand: refuses semicolon chains in args', () => {
  const d = checkCommand('echo', ['hi; rm -rf /'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'arg_shell_metachars');
});

test('checkCommand: refuses pipe in args', () => {
  const d = checkCommand('echo', ['hi|cat'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
});

test('checkCommand: refuses redirect in args', () => {
  const d = checkCommand('echo', ['hi>out.txt'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
});

test('checkCommand: refuses backtick in args', () => {
  const d = checkCommand('echo', ['`whoami`'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
});

test('checkCommand: refuses command not in allowlist', () => {
  const d = checkCommand('rm', ['-rf', '/'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'command_not_allowed');
});

test('checkCommand: basename check defeats absolute-path bypass', () => {
  const d = checkCommand('/usr/bin/rm', ['-rf', '/'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
});

test('checkCommand: empty command is refused', () => {
  const d = checkCommand('', [], { allowedPaths: [], allowedCommands: ['echo'] });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'command_empty');
});

test('checkCommand: NUL byte in command is refused', () => {
  const d = checkCommand('echo\0', [], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
});

test('checkCommand: NUL byte in arg is refused', () => {
  const d = checkCommand('echo', ['ok\0bad'], {
    allowedPaths: [],
    allowedCommands: ['echo'],
  });
  assert.equal(d.allow, false);
  if (!d.allow) assert.equal(d.code, 'arg_nul_byte');
});
