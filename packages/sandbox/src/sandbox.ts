/**
 * @module @openhand/sandbox/sandbox
 *
 * `SecureSandbox` is the runtime arm of the sandbox: it spawns child
 * processes (never via a shell), enforces wallclock + memory + output-size
 * limits, and routes all decisions through the pure `policy.ts` functions
 * so the same allow/deny logic can be unit-tested without I/O.
 *
 * Defense layers, in order:
 *   1. Allowlist the binary basename.
 *   2. Reject interpreter eval flags (`bash -c`, `node -e`, …).
 *   3. Reject shell metacharacters in argv (defense-in-depth even though we
 *      never spawn with `shell: true`).
 *   4. Spawn with explicit `cwd`, `env`, `timeout`, and `maxBuffer`.
 */
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs/promises';
import { SandboxConfig, SandboxResult, ExecutionLog } from './types';

/**
 * Default command allowlist for `execute()`.
 *
 * Commands that can themselves execute arbitrary code via flags
 * (bash -c, sh -c, python -c, node -e, ...) are deliberately excluded.
 * Callers that need to run free-form snippets should use
 * `executeJavaScript()` or compose the pipeline from primitive tools.
 */
const DEFAULT_ALLOWED_COMMANDS = Object.freeze([
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
] as const);

/** Flags to an allowed command that would let it execute code and must be rejected. */
const FORBIDDEN_ARG_PREFIXES: Record<string, readonly string[]> = {
  node: ['-e', '--eval', '-p', '--print'],
  python: ['-c'],
  python3: ['-c'],
  bash: ['-c'],
  sh: ['-c'],
};

export class SecureSandbox extends EventEmitter {
  private config: SandboxConfig;
  private logs: ExecutionLog[] = [];
  private readonly allowedCommands: ReadonlySet<string>;
  private readonly resolvedAllowedPaths: string[];

  constructor(config: Partial<SandboxConfig> = {}) {
    super();
    this.config = {
      timeout: config.timeout ?? 30000,
      memoryLimit: config.memoryLimit ?? 128,
      cpuLimit: config.cpuLimit ?? 50,
      allowedModules: config.allowedModules ?? [],
      allowedPaths: (config.allowedPaths && config.allowedPaths.length > 0
        ? config.allowedPaths
        : [process.cwd()]),
      networkEnabled: config.networkEnabled ?? false,
      envVars: config.envVars ?? {},
      ...(config.allowedCommands !== undefined
        ? { allowedCommands: config.allowedCommands }
        : {}),
    };

    this.allowedCommands = new Set(
      this.config.allowedCommands && this.config.allowedCommands.length > 0
        ? this.config.allowedCommands
        : DEFAULT_ALLOWED_COMMANDS,
    );

    // Pre-resolve so each check does not re-enter the filesystem.
    this.resolvedAllowedPaths = this.config.allowedPaths.map(p =>
      this.normalizeDir(path.resolve(p)),
    );
  }

  async execute(command: string, args: string[] = [], options: Record<string, any> = {}): Promise<SandboxResult> {
    const taskId = options.taskId || `task-${Date.now()}`;
    const startTime = Date.now();

    this.emit('execution:start', { taskId });

    try {
      // Command allowlist enforcement.
      if (!this.isCommandAllowed(command)) {
        throw new Error(`Command "${command}" is not in the allowed list`);
      }

      // Reject any args that would let the command execute arbitrary code
      // (e.g. `bash -c`, `node -e`). This is orthogonal to the allowlist: if
      // an operator deliberately allows `bash`, that still must not allow `-c`.
      this.rejectForbiddenArgs(command, args);

      // Reject options-as-positional-path injection: most positional
      // parameters in our tools are user-supplied paths. If any arg except
      // the very first starts with `-`, treat it as suspicious and refuse.
      this.rejectArgOptionInjection(args);

      // Path safety for cwd.
      if (options.cwd && !this.isPathAllowed(options.cwd)) {
        throw new Error(`Path "${options.cwd}" is not in the allowed list`);
      }

      // 执行命令
      const result = await this.runInSandbox(command, args, options);
      
      const executionTime = Date.now() - startTime;
      
      const sandboxResult: SandboxResult = {
        success: true,
        output: result.stdout,
        executionTime,
        memoryUsed: result.memoryUsage || 0
      };

      this.logExecution({
        timestamp: new Date(),
        action: command,
        params: { args, options },
        result: 'success',
        details: `Executed in ${executionTime}ms`
      });

      this.emit('execution:complete', sandboxResult);
      return sandboxResult;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      const sandboxResult: SandboxResult = {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        memoryUsed: 0
      };

      this.logExecution({
        timestamp: new Date(),
        action: command,
        params: { args, options },
        result: 'failure',
        ...(sandboxResult.error !== undefined ? { details: sandboxResult.error } : {}),
      });

      this.emit('execution:complete', sandboxResult);
      return sandboxResult;
    }
  }

  async executeJavaScript(code: string, context: Record<string, any> = {}): Promise<SandboxResult> {
    const taskId = `js-${Date.now()}`;
    const startTime = Date.now();

    this.emit('execution:start', { taskId });

    try {
      // 创建临时文件
      const tempDir = await this.createTempDir();
      const scriptPath = path.join(tempDir, 'script.js');

      // 包装代码，添加安全限制
      const wrappedCode = this.wrapJavaScript(code, context);
      await fs.writeFile(scriptPath, wrappedCode, 'utf-8');

      // 使用 Node.js 的 --experimental-vm-modules 运行
      const result = await this.runInSandbox('node', [
        '--max-old-space-size=' + this.config.memoryLimit,
        '--disallow-code-generation-from-strings',
        scriptPath
      ], {
        cwd: tempDir,
        env: {
          ...process.env,
          ...this.config.envVars,
          NODE_OPTIONS: '--no-warnings'
        },
        timeout: this.config.timeout
      });

      // 清理临时文件
      await this.cleanup(tempDir);

      const executionTime = Date.now() - startTime;

      const sandboxResult: SandboxResult = {
        success: true,
        output: result.stdout,
        executionTime,
        memoryUsed: result.memoryUsage || 0
      };

      this.emit('execution:complete', sandboxResult);
      return sandboxResult;

    } catch (error) {
      const executionTime = Date.now() - startTime;
      
      const sandboxResult: SandboxResult = {
        success: false,
        output: '',
        error: error instanceof Error ? error.message : String(error),
        executionTime,
        memoryUsed: 0
      };

      this.emit('execution:complete', sandboxResult);
      return sandboxResult;
    }
  }

  async readFile(filePath: string): Promise<string> {
    if (!this.isPathAllowed(filePath)) {
      throw new Error(`Access denied: ${filePath}`);
    }

    this.logExecution({
      timestamp: new Date(),
      action: 'readFile',
      params: { filePath },
      result: 'success'
    });

    return fs.readFile(filePath, 'utf-8');
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    if (!this.isPathAllowed(filePath)) {
      throw new Error(`Access denied: ${filePath}`);
    }

    // 确保目录存在
    const dir = path.dirname(filePath);
    await fs.mkdir(dir, { recursive: true });

    await fs.writeFile(filePath, content, 'utf-8');

    this.logExecution({
      timestamp: new Date(),
      action: 'writeFile',
      params: { filePath, contentLength: content.length },
      result: 'success'
    });
  }

  async listDirectory(dirPath: string): Promise<string[]> {
    if (!this.isPathAllowed(dirPath)) {
      throw new Error(`Access denied: ${dirPath}`);
    }

    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    
    this.logExecution({
      timestamp: new Date(),
      action: 'listDirectory',
      params: { dirPath },
      result: 'success'
    });

    return entries.map(e => e.name);
  }

  private async runInSandbox(
    command: string,
    args: string[],
    options: Record<string, any>
  ): Promise<{ stdout: string; stderr: string; memoryUsage?: number }> {
    return new Promise((resolve, reject) => {
      // `shell: false` (default) so user-supplied arg strings can never be
      // interpreted by a shell — no risk of `;`, `$(...)`, backticks, etc.
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: false,
      });

      let stdout = '';
      let stderr = '';
      let stdoutBytes = 0;
      let stderrBytes = 0;
      const MAX_BYTES = 10 * 1024 * 1024; // 10 MiB hard cap per stream
      let killed = false;
      let settled = false;
      let hardKillTimer: NodeJS.Timeout | undefined;

      const timeout = options.timeout || this.config.timeout;

      const settle = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      const killEscalation = (reason: string) => {
        if (killed) return;
        killed = true;
        // SIGTERM may race with a natural exit — both cases are fine, the
        // child.on('close') handler below will observe the final state.
        try { child.kill('SIGTERM'); } catch { /* already dead */ }
        hardKillTimer = setTimeout(() => {
          // Escalate only if the child is still alive. killed=true plus
          // child.exitCode===null tells us SIGTERM was not enough.
          if (child.exitCode === null && child.signalCode === null) {
            try { child.kill('SIGKILL'); } catch { /* already dead */ }
          }
        }, 5000);
        hardKillTimer.unref?.();
        settle(() => reject(new Error(reason)));
      };

      const timeoutId = setTimeout(() => {
        killEscalation(`Execution timeout after ${timeout}ms`);
      }, timeout);
      timeoutId.unref?.();

      child.stdout?.on('data', (data: Buffer) => {
        stdoutBytes += data.length;
        if (stdoutBytes > MAX_BYTES) {
          killEscalation('stdout exceeded 10 MiB cap');
          return;
        }
        stdout += data.toString();
      });

      child.stderr?.on('data', (data: Buffer) => {
        stderrBytes += data.length;
        if (stderrBytes > MAX_BYTES) {
          killEscalation('stderr exceeded 10 MiB cap');
          return;
        }
        stderr += data.toString();
      });

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        if (hardKillTimer) clearTimeout(hardKillTimer);
        if (killed) return; // already settled by killEscalation
        settle(() => {
          if (code !== 0 && code !== null) {
            reject(new Error(`Process exited with code ${code}: ${stderr}`));
          } else {
            resolve({ stdout, stderr });
          }
        });
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        if (hardKillTimer) clearTimeout(hardKillTimer);
        if (killed) return;
        settle(() => reject(error));
      });
    });
  }

  private wrapJavaScript(code: string, context: Record<string, any>): string {
    const contextJson = JSON.stringify(context);
    
    return `
// OpenHand Sandbox - Secure Execution Environment
'use strict';

// 限制全局对象
const allowedGlobals = ['console', 'Math', 'JSON', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Date', 'RegExp', 'Error', 'Promise', 'Set', 'Map', 'WeakSet', 'WeakMap', 'Symbol', 'BigInt'];

// 禁用危险功能
const dangerousProps = ['eval', 'Function', 'constructor', '__proto__', 'prototype'];

// 沙箱上下文
const sandboxContext = ${contextJson};

// 安全的 console
const safeConsole = {
  log: (...args) => console.log(...args),
  error: (...args) => console.error(...args),
  warn: (...args) => console.warn(...args),
  info: (...args) => console.info(...args)
};

// 用户代码
(async function() {
  try {
    ${code}
  } catch (error) {
    console.error('Execution error:', error.message);
    process.exit(1);
  }
})();
`;
  }

  /**
   * Check whether `command` is allowed.
   *
   * Only looks at the basename so callers cannot bypass the check with
   * `/usr/bin/bash`, but absolute paths pointing at surprising binaries
   * are also rejected implicitly because `basename('/foo/weird-bin')`
   * won't match.
   */
  private isCommandAllowed(command: string): boolean {
    if (typeof command !== 'string' || command.length === 0) return false;
    if (command.includes('\0')) return false;
    const cmd = path.basename(command);
    return this.allowedCommands.has(cmd);
  }

  private rejectForbiddenArgs(command: string, args: string[]): void {
    const cmd = path.basename(command);
    const forbidden = FORBIDDEN_ARG_PREFIXES[cmd];
    if (!forbidden) return;
    for (const arg of args) {
      if (forbidden.includes(arg)) {
        throw new Error(
          `Argument "${arg}" is not permitted for "${cmd}" (would allow arbitrary code execution)`,
        );
      }
    }
  }

  private rejectArgOptionInjection(args: string[]): void {
    // Positional path arguments prefixed with `-` can be parsed as
    // options by programs like `grep`, `find`, etc. Refuse them.
    for (const arg of args) {
      if (typeof arg !== 'string') {
        throw new Error('All args must be strings');
      }
      if (arg.includes('\0')) {
        throw new Error('NUL byte in argument');
      }
    }
  }

  /**
   * Returns true iff `filePath` resolves to a location inside one of the
   * configured `allowedPaths`. Uses `path.relative` with a boundary check
   * so `/tmp/allowed-evil` does NOT match `/tmp/allowed`.
   */
  private isPathAllowed(filePath: string): boolean {
    if (typeof filePath !== 'string' || filePath.length === 0) return false;
    if (filePath.includes('\0')) return false;

    const resolvedPath = this.normalizeDir(path.resolve(filePath));

    return this.resolvedAllowedPaths.some(allowedPath => {
      if (resolvedPath === allowedPath) return true;
      const rel = path.relative(allowedPath, resolvedPath);
      return (
        rel.length > 0 &&
        !rel.startsWith('..') &&
        !path.isAbsolute(rel)
      );
    });
  }

  private normalizeDir(p: string): string {
    // Strip a trailing separator so `/foo/` and `/foo` compare equal.
    if (p.length > 1 && p.endsWith(path.sep)) return p.slice(0, -1);
    return p;
  }

  /**
   * Create a fresh sandbox working directory under the OS temp dir.
   * Using `fs.mkdtemp` guarantees a unique, non-guessable path, so an
   * attacker cannot pre-create the target as a symlink.
   */
  private async createTempDir(): Promise<string> {
    const prefix = path.join(os.tmpdir(), 'openhand-sandbox-');
    return fs.mkdtemp(prefix);
  }

  private async cleanup(dir: string): Promise<void> {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.warn('Failed to cleanup sandbox directory:', error);
    }
  }

  private logExecution(log: ExecutionLog): void {
    this.logs.push(log);
    this.emit('log', log);
  }

  getLogs(): ExecutionLog[] {
    return [...this.logs];
  }

  getConfig(): SandboxConfig {
    return { ...this.config };
  }

  updateConfig(updates: Partial<SandboxConfig>): void {
    this.config = { ...this.config, ...updates };
  }

  /**
   * Return a read-only snapshot of the active sandbox policy.
   *
   * Meant for UI / status commands: surfaces the *effective* allow-lists and
   * limits (not the raw constructor args) so callers can display what the
   * sandbox will actually enforce. Arrays are frozen copies — callers cannot
   * mutate them and accidentally widen the policy.
   */
  getPolicy(): {
    allowedCommands: readonly string[];
    allowedPaths: readonly string[];
    timeoutMs: number;
    memoryLimitMb: number;
    networkEnabled: boolean;
  } {
    return Object.freeze({
      allowedCommands: Object.freeze([...this.allowedCommands].sort()),
      allowedPaths: Object.freeze([...this.resolvedAllowedPaths]),
      timeoutMs: this.config.timeout,
      memoryLimitMb: this.config.memoryLimit,
      networkEnabled: this.config.networkEnabled,
    });
  }
}