/**
 * MCP integration demo.
 *
 * Spawns a tiny in-process MCP server (just `node -e ...` running the
 * mock script below), bridges its tools into the OpenHand tool surface
 * via `bridgeMcpTools()`, and prints the round-trip:
 *
 *   1. handshake (`initialize` + `notifications/initialized`)
 *   2. `tools/list`
 *   3. `tools/call` for each tool
 *   4. clean shutdown (`SIGTERM`, escalates to `SIGKILL` after 2 s)
 *
 * Run:
 *   npx tsx examples/mcp-demo.ts
 *
 * Replace MOCK_SERVER below (or `command` / `args`) with whatever real MCP
 * server you want to bridge — e.g. `mcp-server-filesystem`,
 * `mcp-server-git`, etc. The wire protocol is the same.
 *
 * No network. No API key. Hermetic.
 */
import { MCPClient, bridgeMcpTools } from '../packages/mcp/src';

const MOCK_SERVER = `
'use strict';
const stdin = process.stdin;
stdin.setEncoding('utf8');
let buf = '';
function send(o){ process.stdout.write(JSON.stringify(o) + '\\n'); }
stdin.on('data', function(chunk){
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch (_e) { continue; }
    if (m.method === 'initialize') {
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'demo', version: '0.1.0' } } });
    } else if (m.method === 'notifications/initialized') {
    } else if (m.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: m.id, result: { tools: [
        { name: 'reverse', description: 'Reverse a string.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
        { name: 'upper',   description: 'Uppercase a string.', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      ] } });
    } else if (m.method === 'tools/call') {
      const args = (m.params && m.params.arguments) || {};
      if (m.params.name === 'reverse') {
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(args.text || '').split('').reverse().join('') }] } });
      } else if (m.params.name === 'upper') {
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: String(args.text || '').toUpperCase() }] } });
      } else {
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown tool' } });
      }
    }
  }
});
`;

async function main(): Promise<void> {
  const client = new MCPClient({
    command: process.execPath,
    args: ['-e', MOCK_SERVER],
    timeoutMs: 5_000,
    onStderr: (line) => console.log('[mcp-server] ' + line),
  });

  console.log('[demo] starting MCP server...');
  await client.start();
  console.log('[demo] handshake OK');

  console.log('[demo] listing tools...');
  const descriptors = await client.listTools();
  for (const d of descriptors) {
    console.log(`  - ${d.name}: ${d.description}`);
  }

  console.log('[demo] bridging into OpenHand tools...');
  const bridged = await bridgeMcpTools(client, { prefix: 'mcp_' });
  console.log(`  bridged ${bridged.size} tool(s): ${[...bridged.keys()].join(', ')}`);

  const ctx = {
    taskId: 'demo', userId: 'local', sessionId: 'demo',
    permissions: ['mcp:invoke'], workingDirectory: process.cwd(), env: {},
  };

  console.log('[demo] calling mcp_reverse({text: "openhand"})');
  const r1 = (await bridged.get('mcp_reverse')!.execute({ text: 'openhand' }, ctx)) as { text: string };
  console.log('  ->', r1.text);

  console.log('[demo] calling mcp_upper({text: "hello"})');
  const r2 = (await bridged.get('mcp_upper')!.execute({ text: 'hello' }, ctx)) as { text: string };
  console.log('  ->', r2.text);

  console.log('[demo] shutting down child...');
  await client.stop();
  console.log('[demo] done');
}

main().catch((err) => {
  console.error('[error]', err);
  process.exit(1);
});
