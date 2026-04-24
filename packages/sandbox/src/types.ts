export interface SandboxConfig {
  /** Max wall-clock time (ms) for a single execution. */
  timeout: number;
  /** Memory cap (MB) applied to child Node processes via --max-old-space-size. */
  memoryLimit: number;
  /** Advisory CPU cap (percent). Not enforced on all platforms. */
  cpuLimit: number;
  allowedModules: string[];
  /** Filesystem roots the sandbox is allowed to read/write below. */
  allowedPaths: string[];
  /** Whether sandboxed code may initiate outbound network calls. */
  networkEnabled: boolean;
  /** Extra environment variables merged on top of process.env for children. */
  envVars: Record<string, string>;
  /**
   * Override the default command allowlist. When omitted or empty, a
   * conservative built-in allowlist is used that deliberately excludes
   * shells and code-eval interpreters (bash, sh, node -e, python -c, ...).
   */
  allowedCommands?: readonly string[];
}

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  executionTime: number;
  memoryUsed: number;
}

export interface ExecutionLog {
  timestamp: Date;
  action: string;
  params: Record<string, any>;
  result: 'success' | 'failure';
  details?: string;
}

export type SandboxEvent =
  | { type: 'execution:start'; data: { taskId: string } }
  | { type: 'execution:complete'; data: SandboxResult }
  | { type: 'violation'; data: { type: string; details: string } }
  | { type: 'log'; data: ExecutionLog };