# 08 — MCP integration (~10 min)

**Goal:** spawn any
[Model Context Protocol](https://modelcontextprotocol.io/) server, bridge
its tools into OpenHand, and call them from your agent loop.

OpenHand ships a stand-alone adapter at `@openhand/mcp` (workspace
`packages/mcp`). It is **~300 lines of TypeScript**, has zero runtime
dependencies, and does not import `@modelcontextprotocol/sdk` — MCP is a
JSON-RPC wire protocol, not a framework, so we implement only the slice
the agent actually needs:

| Capability     | Supported in v0.8 |
| -------------- | :---------------: |
| `initialize` handshake          | yes |
| `tools/list`                    | yes |
| `tools/call`                    | yes |
| Server-initiated requests       | no  |
| `resources/*`, `prompts/*`      | no  |
| `sampling/createMessage`        | no  |
| Stdio transport (line-delimited JSON) | yes |
| HTTP/SSE transport              | no  |

If you need any of the "no" rows, the surface is small enough that you
can extend `MCPClient` in your own code without forking core.

## 30-second tour

```ts
import { MCPClient, bridgeMcpTools } from '@openhand/mcp';

const client = new MCPClient({
  command: 'npx',
  args: ['-y', '@modelcontextprotocol/server-filesystem', '/tmp'],
  // optional: cwd, env, timeoutMs (default 30s), onStderr
});

await client.start();                      // spawn + handshake
const descriptors = await client.listTools();
console.log('available:', descriptors.map(t => t.name));

// Bridge every MCP tool into a Map<string, Tool> compatible with
// @openhand/core. Names get a configurable prefix (default 'mcp_').
const tools = await bridgeMcpTools(client, { prefix: 'mcp_' });
const out = await tools.get('mcp_read_file')!.execute(
  { path: '/tmp/hello.txt' },
  ctx,
);
console.log(out.text);

await client.stop();                       // SIGTERM → SIGKILL after 2s
```

That's the whole API. Three calls (`start`, `listTools` / `callTool` or
`bridgeMcpTools`, `stop`).

## Patterns

### Pattern A — one tool per MCP tool (recommended)

`bridgeMcpTools(client)` returns a `Map<string, Tool>` you can merge into
`createTools()` output. Each MCP tool becomes its own
[`Tool`](../packages/core/src/types.ts) with parameters derived from the
server-supplied JSON Schema. The agent's planner sees them as first-class
tools — no special-case dispatch.

```ts
import { createTools } from '@openhand/tools';
import { MCPClient, bridgeMcpTools } from '@openhand/mcp';

const baseTools = createTools();
const mcp = new MCPClient({ command: 'mcp-server-git', args: ['/repo'] });
await mcp.start();
for (const [name, tool] of await bridgeMcpTools(mcp, { prefix: 'git_mcp_' })) {
  baseTools.set(name, tool);
}
```

### Pattern B — single dispatcher tool (`plugins/mcp-bridge/`)

If you want **one** MCP server selectable at runtime (e.g. operator
chooses `filesystem` vs `git` per session), use the in-tree
[`mcp-bridge` plugin](../plugins/mcp-bridge/). It registers two tools:

* `mcp_list_tools` — enumerates the configured server
* `mcp_call(tool, arguments)` — explicit dispatch

```js
const plugin = require('@openhand/plugin-mcp-bridge');
plugin.configure({ command: 'npx', args: ['-y', '@modelcontextprotocol/server-everything'] });
```

This pattern keeps the agent's tool list short — useful if the MCP
server exposes 50+ tools and you don't want to flood the planner with
schemas.

## How it works

`packages/mcp/src/jsonrpc.ts` implements the JSON-RPC 2.0 framing
(line-delimited JSON over stdio) — `encode()` + a streaming
`LineDecoder`. Bad lines surface as synthetic `JsonRpcError` frames with
`id: null` so a buggy server can't crash the client event loop.

`packages/mcp/src/client.ts` owns the child process:

* spawns with `child_process.spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] })`
* writes JSON-RPC requests to `stdin`, reads framed messages from `stdout`
* enforces a per-request timeout (default 30s) so a non-cooperative
  server times out instead of hanging the agent
* fails all pending requests on `exit` with `JsonRpcRemoteError(TransportClosed)`
* `stop()` sends `SIGTERM`, escalates to `SIGKILL` after 2s

`packages/mcp/src/bridge.ts` does the schema → `ToolParameter[]`
translation (`integer` collapses to `number`; missing/non-`object`
schemas degrade to a single freeform `arguments: object` parameter so
you never silently lose a tool).

## Testing without a real MCP server

The package's own test suite (`packages/mcp/tests/client.test.ts`)
spawns a 40-line mock server using
`spawn(process.execPath, ['-e', MOCK_SERVER_SOURCE])`. No external
binaries, no separate fixture file — it survives `npm test` on a fresh
checkout. Use the same trick in your own integration tests:

```ts
import { spawn } from 'node:child_process';
const MOCK = `
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (line) => {
    const msg = JSON.parse(line.trim());
    if (msg.method === 'initialize') {
      process.stdout.write(JSON.stringify({
        jsonrpc: '2.0', id: msg.id,
        result: { protocolVersion: '2024-11-05', capabilities: { tools: {} } }
      }) + '\\n');
    }
    // ... handle tools/list, tools/call ...
  });
`;
const child = spawn('node', ['-e', MOCK]);
```

That's exactly what `packages/mcp/tests/mock-server.ts` does, and it's
how all 23 MCP tests stay hermetic.

## Caveats

* **No `resources/*` or `prompts/*` yet.** v0.8 covers tools only.
* **Stdio transport only.** HTTP+SSE servers need a separate transport
  layer; the JSON-RPC layer (`jsonrpc.ts`) is reusable.
* **Server-initiated requests are ignored.** They surface on
  `client.on('server-message', …)` so you can log, but reverse RPC is
  out of scope for the bridge.
* **Permissions are advisory.** Bridged tools all carry `mcp:invoke`
  by default — the *MCP server* is the real authorization boundary.
  Pair with `openhand audit` to keep an eye on aggregate scope.

## Next

* Run `npx tsx examples/mcp-demo.ts` for a complete spawn → list →
  call → shutdown loop, fully hermetic.
* Wire a real server: try `@modelcontextprotocol/server-filesystem` or
  `@modelcontextprotocol/server-git` from npm; they speak the exact
  same protocol our mock does.
