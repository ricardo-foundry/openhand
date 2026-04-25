// MCPClient — spawn-and-talk wrapper around an MCP server child process.
//
// The contract is intentionally narrow: we only implement the three calls
// OpenHand actually needs to bridge an MCP server's tools into the agent
// runtime:
//
//   * `initialize` — handshake with capabilities + protocol version
//   * `tools/list` — enumerate available tools
//   * `tools/call` — invoke a tool by name with JSON arguments
//
// Anything else (resources, prompts, sampling) is out of scope for v0.8 and
// can be added later without breaking this surface.
//
// We deliberately do NOT depend on `@modelcontextprotocol/sdk`. The whole
// point of OpenHand's adapter layer is to keep the dependency footprint
// flat — MCP is a wire protocol, not a framework, and ~300 lines of TS is
// enough to cover the client side.

import { spawn, ChildProcess, SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import {
  encode,
  LineDecoder,
  JsonRpcId,
  JsonRpcMessage,
  JsonRpcRemoteError,
  ERROR_CODES,
} from './jsonrpc';

/** What the server tells us in `tools/list`. */
export interface MCPToolDescriptor {
  name: string;
  description?: string;
  /** JSON Schema for input. We pass it through untouched. */
  inputSchema?: { type?: string; properties?: Record<string, unknown>; required?: string[] };
}

/** Result of a `tools/call`. MCP wraps payloads in a content array. */
export interface MCPToolCallResult {
  content: Array<{ type: string; text?: string; [k: string]: unknown }>;
  isError?: boolean;
}

export interface MCPClientOptions {
  /** Command to spawn (e.g. `'node'`, `'python'`, `'/usr/local/bin/mcp-fs'`). */
  command: string;
  /** Args passed to the command. */
  args?: string[];
  /** Working directory for the child. */
  cwd?: string;
  /** Extra env. Merged on top of `process.env`. */
  env?: Record<string, string>;
  /** Per-call timeout in ms. Default 30s. */
  timeoutMs?: number;
  /** Optional stderr sink (line-buffered). Default: drop. */
  onStderr?: (line: string) => void;
  /** Protocol version we advertise during initialize. Default '2024-11-05'. */
  protocolVersion?: string;
  /** Client info to send during initialize. */
  clientInfo?: { name: string; version: string };
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: NodeJS.Timeout;
  method: string;
}

/**
 * Spawn an MCP server, perform the JSON-RPC handshake, and expose
 * `listTools` / `callTool`. Emits `'exit'` and `'error'` for lifecycle.
 *
 * Lifecycle:
 *   const client = new MCPClient({ command: 'node', args: ['server.js'] });
 *   await client.start();          // spawn + initialize
 *   const tools = await client.listTools();
 *   const out = await client.callTool('echo', { text: 'hi' });
 *   await client.stop();           // SIGTERM, then SIGKILL after 2s
 */
export class MCPClient extends EventEmitter {
  private readonly opts: Required<Omit<MCPClientOptions, 'cwd' | 'env' | 'onStderr'>> &
    Pick<MCPClientOptions, 'cwd' | 'env' | 'onStderr'>;
  private child: ChildProcess | null = null;
  private decoder = new LineDecoder();
  private stderrBuf = '';
  private pending = new Map<JsonRpcId, PendingCall>();
  private nextId = 1;
  private started = false;
  private stopped = false;

  constructor(options: MCPClientOptions) {
    super();
    this.opts = {
      command: options.command,
      args: options.args ?? [],
      timeoutMs: options.timeoutMs ?? 30_000,
      protocolVersion: options.protocolVersion ?? '2024-11-05',
      clientInfo: options.clientInfo ?? { name: 'openhand', version: '0.8.0' },
      ...(options.cwd !== undefined ? { cwd: options.cwd } : {}),
      ...(options.env !== undefined ? { env: options.env } : {}),
      ...(options.onStderr !== undefined ? { onStderr: options.onStderr } : {}),
    };
  }

  /** Spawn the child and complete the MCP `initialize` handshake. */
  async start(): Promise<void> {
    if (this.started) throw new Error('MCPClient.start: already started');
    this.started = true;

    const spawnOpts: SpawnOptions = {
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(this.opts.cwd !== undefined ? { cwd: this.opts.cwd } : {}),
      env: this.opts.env ? { ...process.env, ...this.opts.env } : process.env,
    };
    const child = spawn(this.opts.command, this.opts.args, spawnOpts);
    this.child = child;

    if (!child.stdout || !child.stdin || !child.stderr) {
      throw new Error('MCPClient.start: child process is missing stdio pipes');
    }

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      const messages = this.decoder.push(chunk);
      for (const msg of messages) this.handleMessage(msg);
    });

    child.stderr.on('data', (chunk: string) => {
      this.stderrBuf += chunk;
      let nl: number;
      while ((nl = this.stderrBuf.indexOf('\n')) >= 0) {
        const line = this.stderrBuf.slice(0, nl);
        this.stderrBuf = this.stderrBuf.slice(nl + 1);
        if (this.opts.onStderr) this.opts.onStderr(line);
      }
    });

    child.on('error', (err) => {
      this.failAll(err);
      this.emit('error', err);
    });

    child.on('exit', (code, signal) => {
      this.failAll(
        new JsonRpcRemoteError(
          ERROR_CODES.TransportClosed,
          `MCP server exited (code=${code}, signal=${signal})`,
        ),
      );
      this.emit('exit', { code, signal });
    });

    // Handshake. Per spec: client sends `initialize`, server replies, client
    // sends `notifications/initialized`. We expose only the success path.
    await this.request('initialize', {
      protocolVersion: this.opts.protocolVersion,
      capabilities: { tools: {} },
      clientInfo: this.opts.clientInfo,
    });
    this.notify('notifications/initialized', {});
  }

  /** Enumerate tools exposed by the server. */
  async listTools(): Promise<MCPToolDescriptor[]> {
    const res = (await this.request('tools/list', {})) as { tools?: MCPToolDescriptor[] };
    return res?.tools ?? [];
  }

  /** Invoke a tool. Throws JsonRpcRemoteError on protocol errors. */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<MCPToolCallResult> {
    const res = (await this.request('tools/call', { name, arguments: args })) as MCPToolCallResult;
    if (!res || !Array.isArray(res.content)) {
      // Defensive: a server that returns a non-conforming shape gets
      // normalized so downstream code can rely on `.content` being an array.
      return { content: [{ type: 'text', text: JSON.stringify(res) }] };
    }
    return res;
  }

  /** Terminate the child cleanly (SIGTERM, then SIGKILL after 2s). */
  async stop(): Promise<void> {
    if (!this.child || this.stopped) return;
    this.stopped = true;
    const child = this.child;
    return new Promise<void>((resolve) => {
      const onExit = () => {
        this.failAll(new Error('MCPClient stopped'));
        resolve();
      };
      child.once('exit', onExit);
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore — already gone
      }
      const killer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }, 2000);
      child.once('exit', () => clearTimeout(killer));
    });
  }

  // ─────────────── internals ───────────────

  private request(method: string, params: unknown): Promise<unknown> {
    if (!this.child || this.stopped) {
      return Promise.reject(
        new JsonRpcRemoteError(ERROR_CODES.TransportClosed, 'MCP transport not started'),
      );
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new JsonRpcRemoteError(ERROR_CODES.Timeout, `MCP request '${method}' timed out`));
      }, this.opts.timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this.child!.stdin!.write(encode({ jsonrpc: '2.0', id, method, params: params as object }));
      } catch (err) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(err as Error);
      }
    });
  }

  private notify(method: string, params: unknown): void {
    if (!this.child) return;
    try {
      this.child.stdin!.write(encode({ jsonrpc: '2.0', method, params: params as object }));
    } catch {
      // Notifications are fire-and-forget; the next request will surface
      // the broken transport.
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if ('id' in msg && msg.id !== null && this.pending.has(msg.id as JsonRpcId)) {
      const pending = this.pending.get(msg.id as JsonRpcId)!;
      this.pending.delete(msg.id as JsonRpcId);
      clearTimeout(pending.timer);
      if ('error' in msg && msg.error) {
        pending.reject(new JsonRpcRemoteError(msg.error.code, msg.error.message, msg.error.data));
      } else if ('result' in msg) {
        pending.resolve(msg.result);
      } else {
        pending.reject(
          new JsonRpcRemoteError(ERROR_CODES.InternalError, 'response missing both result and error'),
        );
      }
      return;
    }
    // Server-initiated request or notification. We don't implement reverse
    // RPC in v0.8, so log via emit and drop. (No exception — a misbehaving
    // server should NOT crash the client event loop.)
    this.emit('server-message', msg);
  }

  private failAll(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }
}
