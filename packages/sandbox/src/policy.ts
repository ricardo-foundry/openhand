import * as path from 'path';

/**
 * Default sandbox policy — a pure, synchronous decision function over a
 * proposed action. Keeping this separate from `SecureSandbox` means it can
 * be unit-tested without spawning child processes or touching the FS.
 *
 * Two orthogonal concerns:
 *
 *   1. Is the *command* (or filesystem operation) permitted?
 *   2. Do the *arguments* contain anything that would smuggle in shell or
 *      interpreter behaviour we explicitly forbid?
 */

export interface PolicyConfig {
  /** Absolute, pre-normalised filesystem roots the sandbox may touch. */
  allowedPaths: readonly string[];
  /** Command basenames permitted to be spawned. */
  allowedCommands: readonly string[];
}

export type Decision =
  | { allow: true }
  | { allow: false; reason: string; code: PolicyDenyCode };

export type PolicyDenyCode =
  | 'path_outside_roots'
  | 'path_nul_byte'
  | 'path_empty'
  | 'command_not_allowed'
  | 'command_empty'
  | 'command_nul_byte'
  | 'arg_interpreter_flag'
  | 'arg_shell_metachars'
  | 'arg_nul_byte';

/** Arguments that let an allowlisted binary execute arbitrary code. */
const INTERPRETER_FLAGS: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  bash: ['-c'],
  sh: ['-c'],
  zsh: ['-c'],
  perl: ['-e'],
  ruby: ['-e'],
  awk: ['-e'],
};

/** Characters that would be expanded by a shell. We never spawn with shell=true, but we still refuse them for defense in depth. */
const SHELL_METACHAR = /[|&;<>`$()]/;

export function checkPath(filePath: string, config: PolicyConfig): Decision {
  if (typeof filePath !== 'string' || filePath.length === 0) {
    return { allow: false, reason: 'path is empty', code: 'path_empty' };
  }
  if (filePath.includes('\0')) {
    return { allow: false, reason: 'NUL byte in path', code: 'path_nul_byte' };
  }

  const resolved = normalizeDir(path.resolve(filePath));
  const hit = config.allowedPaths.some(root => {
    const normalizedRoot = normalizeDir(path.resolve(root));
    if (resolved === normalizedRoot) return true;
    const rel = path.relative(normalizedRoot, resolved);
    return rel.length > 0 && !rel.startsWith('..') && !path.isAbsolute(rel);
  });
  if (!hit) {
    return {
      allow: false,
      reason: `path "${filePath}" is not inside any allowed root`,
      code: 'path_outside_roots',
    };
  }
  return { allow: true };
}

export function checkCommand(
  command: string,
  args: readonly string[],
  config: PolicyConfig,
): Decision {
  if (typeof command !== 'string' || command.length === 0) {
    return { allow: false, reason: 'command is empty', code: 'command_empty' };
  }
  if (command.includes('\0')) {
    return { allow: false, reason: 'NUL byte in command', code: 'command_nul_byte' };
  }

  const base = path.basename(command);
  if (!config.allowedCommands.includes(base)) {
    return {
      allow: false,
      reason: `command "${base}" is not in the allowlist`,
      code: 'command_not_allowed',
    };
  }

  const forbidden = INTERPRETER_FLAGS[base];
  for (const arg of args) {
    if (typeof arg !== 'string') {
      return { allow: false, reason: 'arg is not a string', code: 'arg_nul_byte' };
    }
    if (arg.includes('\0')) {
      return { allow: false, reason: 'NUL byte in arg', code: 'arg_nul_byte' };
    }
    if (forbidden && forbidden.includes(arg)) {
      return {
        allow: false,
        reason: `"${arg}" is an interpreter eval flag and is refused`,
        code: 'arg_interpreter_flag',
      };
    }
    // `shell: false` means metachars can't escape, but we still refuse them
    // so callers don't accidentally ship bad contracts to their own tools.
    if (SHELL_METACHAR.test(arg)) {
      return {
        allow: false,
        reason: `shell metacharacter in arg "${arg}"`,
        code: 'arg_shell_metachars',
      };
    }
  }
  return { allow: true };
}

/**
 * Conservative default policy list, mirroring `SecureSandbox`'s built-in.
 * Commands that can execute arbitrary code (shells, interpreters with eval
 * flags) are deliberately absent.
 */
export const DEFAULT_ALLOWED_COMMANDS: readonly string[] = Object.freeze([
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'echo',
  'wc',
  'sort',
  'uniq',
  'grep',
  'find',
  'git',
]);

function normalizeDir(p: string): string {
  if (p.length > 1 && p.endsWith(path.sep)) return p.slice(0, -1);
  return p;
}
