import { Tool } from '@openhand/core';
import { SecureSandbox } from '@openhand/sandbox';

/**
 * Parse a simple argv array out of a command string.
 *
 * Supports: single tokens separated by whitespace, plus "..."-quoted
 * and '...'-quoted tokens that keep embedded spaces. Does NOT support
 * shell features (pipes, redirects, `$(...)`, backticks, variable
 * expansion, globbing). If the string contains any of those, it is
 * rejected so callers don't get a false sense that they "work".
 */
export function parseShellCommand(input: string): string[] {
  if (typeof input !== 'string') {
    throw new TypeError('command must be a string');
  }

  // Reject shell metacharacters — they would have zero effect (we don't
  // use a shell) and their presence almost always means the caller
  // expected shell behavior we are not going to provide.
  const FORBIDDEN = /[|&;<>`$()\\!*?~\[\]{}]/;
  if (FORBIDDEN.test(input)) {
    throw new Error(
      'shell metacharacters are not supported; pass argv as separate tokens',
    );
  }
  if (input.includes('\0')) {
    throw new Error('NUL byte in command');
  }

  const argv: string[] = [];
  let i = 0;
  while (i < input.length) {
    // Skip whitespace.
    while (i < input.length && /\s/.test(input[i]!)) i++;
    if (i >= input.length) break;

    let token = '';
    if (input[i] === '"' || input[i] === "'") {
      const quote = input[i]!;
      i++;
      while (i < input.length && input[i] !== quote) {
        token += input[i];
        i++;
      }
      if (i >= input.length) {
        throw new Error('Unterminated quoted string in command');
      }
      i++; // skip closing quote
    } else {
      while (i < input.length && !/\s/.test(input[i]!)) {
        token += input[i];
        i++;
      }
    }
    argv.push(token);
  }

  if (argv.length === 0) {
    throw new Error('empty command');
  }
  return argv;
}

export function createShellTools(sandbox: SecureSandbox): Tool[] {
  return [
    {
      name: 'shell_exec',
      description:
        'Run a single allowlisted binary with arguments (NO shell interpretation).',
      parameters: [
        {
          name: 'command',
          type: 'string',
          description:
            'Command line. Parsed as argv tokens; no pipes/redirects/substitution.',
          required: true,
        },
        {
          name: 'cwd',
          type: 'string',
          description: 'Working directory (must be inside sandbox allowedPaths).',
          required: false,
        },
        {
          name: 'timeout',
          type: 'number',
          description: 'Per-execution timeout in ms.',
          required: false,
          default: 30000,
        },
      ],
      permissions: ['shell:exec'],
      sandboxRequired: true,
      execute: async (params, context) => {
        const argv = parseShellCommand(String(params.command ?? ''));
        const [cmd, ...args] = argv;
        if (!cmd) {
          throw new Error('command is required');
        }
        const result = await sandbox.execute(cmd, args, {
          cwd: params.cwd,
          timeout: params.timeout,
          taskId: context.taskId,
        });

        return {
          success: result.success,
          stdout: result.output,
          stderr: result.error,
          exitCode: result.success ? 0 : 1,
          executionTime: result.executionTime,
        };
      },
    },
  ];
}
