// OpenHand mcp-bridge plugin
//
// Launches a child MCP server and exposes a single `mcp_call` tool that
// dispatches to whichever underlying MCP tool the user asks for. This is the
// "explicit dispatch" mode — useful when the agent already knows which tools
// the server provides (e.g. via a previous `mcp_list_tools` call) but the
// caller doesn't want to register every MCP tool individually.
//
// For "register every tool as its own OpenHand tool" use
// `bridgeMcpTools(client)` from `@openhand/mcp` directly. That code lives in
// the package; this plugin is the convenient end-user entry point.
//
// We deliberately keep this plain CommonJS so it lines up with every other
// in-tree plugin (calculator/, weather/, …) and so the plugin loader doesn't
// have to handle ESM differently.

'use strict';

const { spawn } = require('node:child_process');

// Minimal embedded JSON-RPC client. Mirrors packages/mcp/src/client.ts but
// in a single file so the plugin has zero workspace import-cycle risk and so
// it survives being copied into a user's project verbatim.
function lineDecoder() {
  let buf = '';
  return function push(chunk) {
    buf += chunk;
    const out = [];
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line) continue;
      try {
        out.push(JSON.parse(line));
      } catch (_e) {
        // skip bad lines
      }
    }
    return out;
  };
}

class BridgeClient {
  constructor(opts) {
    this.command = opts.command;
    this.args = opts.args || [];
    this.timeoutMs = opts.timeoutMs || 30_000;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.decode = lineDecoder();
  }

  start() {
    return new Promise((resolve, reject) => {
      this.child = spawn(this.command, this.args, { stdio: ['pipe', 'pipe', 'pipe'] });
      this.child.stdout.setEncoding('utf8');
      this.child.stdout.on('data', (chunk) => {
        for (const msg of this.decode(chunk)) this.handle(msg);
      });
      this.child.on('error', reject);
      this.child.on('exit', () => {
        for (const [, p] of this.pending) {
          clearTimeout(p.timer);
          p.reject(new Error('mcp transport closed'));
        }
        this.pending.clear();
      });
      this.request('initialize', {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        clientInfo: { name: 'openhand-mcp-bridge', version: '1.0.0' },
      })
        .then(() => {
          this.notify('notifications/initialized', {});
          resolve();
        })
        .catch(reject);
    });
  }

  notify(method, params) {
    if (!this.child) return;
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  request(method, params) {
    return new Promise((resolve, reject) => {
      if (!this.child) return reject(new Error('mcp not started'));
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`mcp ${method} timed out`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
    });
  }

  handle(msg) {
    if (msg && msg.id != null && this.pending.has(msg.id)) {
      const p = this.pending.get(msg.id);
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) p.reject(new Error(`mcp[${msg.error.code}] ${msg.error.message}`));
      else p.resolve(msg.result);
    }
  }

  stop() {
    if (!this.child) return Promise.resolve();
    return new Promise((resolve) => {
      const child = this.child;
      const killer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch (_e) {}
      }, 2000);
      child.once('exit', () => { clearTimeout(killer); resolve(); });
      try { child.kill('SIGTERM'); } catch (_e) {}
    });
  }
}

// Singleton client lifecycle. The plugin loader instantiates the plugin
// once per session, so we lazily start the child on the first call and tear
// it down in `onDisable`.
let activeClient = null;
let activeConfig = null;

async function ensureClient(config) {
  if (activeClient) return activeClient;
  activeConfig = config;
  activeClient = new BridgeClient(config);
  await activeClient.start();
  return activeClient;
}

module.exports = {
  name: 'mcp-bridge',
  version: '1.0.0',
  description: 'Spawn an MCP server and forward tool calls to it.',

  // Exported for tests so they can inject a fake spawn target.
  _BridgeClient: BridgeClient,

  tools: [
    {
      name: 'mcp_list_tools',
      description: 'List the tools exposed by the configured MCP server.',
      parameters: [],
      permissions: ['mcp:invoke'],
      sandboxRequired: false,
      async execute(_params, ctx) {
        const config = (ctx && ctx.env && ctx.env.OPENHAND_MCP_CONFIG)
          ? JSON.parse(ctx.env.OPENHAND_MCP_CONFIG)
          : module.exports._defaultConfig;
        if (!config) throw new Error('mcp-bridge: no config (set OPENHAND_MCP_CONFIG or call configure()).');
        const client = await ensureClient(config);
        const result = await client.request('tools/list', {});
        return { tools: (result && result.tools) || [] };
      },
    },
    {
      name: 'mcp_call',
      description: 'Invoke a tool on the configured MCP server.',
      parameters: [
        { name: 'tool', type: 'string', description: 'MCP tool name', required: true },
        { name: 'arguments', type: 'object', description: 'Arguments to forward', required: false },
      ],
      permissions: ['mcp:invoke'],
      sandboxRequired: false,
      async execute(params, ctx) {
        const config = (ctx && ctx.env && ctx.env.OPENHAND_MCP_CONFIG)
          ? JSON.parse(ctx.env.OPENHAND_MCP_CONFIG)
          : module.exports._defaultConfig;
        if (!config) throw new Error('mcp-bridge: no config (set OPENHAND_MCP_CONFIG or call configure()).');
        const client = await ensureClient(config);
        const out = await client.request('tools/call', {
          name: params.tool,
          arguments: params.arguments || {},
        });
        return out;
      },
    },
  ],

  /** Set the spawn config for unit tests / programmatic callers. */
  configure(config) {
    module.exports._defaultConfig = config;
  },

  /** Reset for tests — kill any active child and clear config. */
  async _reset() {
    if (activeClient) {
      await activeClient.stop();
      activeClient = null;
      activeConfig = null;
    }
    module.exports._defaultConfig = null;
  },

  async onDisable() {
    if (activeClient) {
      await activeClient.stop();
      activeClient = null;
      activeConfig = null;
    }
  },

  _defaultConfig: null,
};
