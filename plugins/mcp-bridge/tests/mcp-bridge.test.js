'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const plugin = require('../index.js');

// Inline mock MCP server source. Identical wire shape to the package-level
// tests. We keep a copy here so the plugin tests stay self-contained — a
// user copying the plugin folder out of OpenHand should be able to run
// its tests without the @openhand/mcp workspace.
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
      send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '0.0.1' } } });
    } else if (m.method === 'notifications/initialized') {
      // notification, no reply
    } else if (m.method === 'tools/list') {
      send({ jsonrpc: '2.0', id: m.id, result: { tools: [
        { name: 'echo', description: 'echo back', inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
      ] } });
    } else if (m.method === 'tools/call') {
      const args = (m.params && m.params.arguments) || {};
      if (m.params.name === 'echo') {
        send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'echo:' + (args.text || '') }] } });
      } else {
        send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown tool' } });
      }
    }
  }
});
`;

function ctx() {
  return {
    taskId: 't', userId: 'u', sessionId: 's',
    permissions: ['mcp:invoke'], workingDirectory: '/tmp', env: {},
  };
}

test('plugin manifest exposes mcp_list_tools and mcp_call', () => {
  const names = plugin.tools.map((t) => t.name);
  assert.ok(names.includes('mcp_list_tools'));
  assert.ok(names.includes('mcp_call'));
});

test('mcp_list_tools requires configuration', async () => {
  await plugin._reset();
  const list = plugin.tools.find((t) => t.name === 'mcp_list_tools');
  await assert.rejects(list.execute({}, ctx()), /no config/);
});

test('configured plugin lists and calls tools end-to-end', async () => {
  await plugin._reset();
  plugin.configure({
    command: process.execPath,
    args: ['-e', MOCK_SERVER],
    timeoutMs: 5_000,
  });
  try {
    const list = plugin.tools.find((t) => t.name === 'mcp_list_tools');
    const listed = await list.execute({}, ctx());
    assert.equal(listed.tools.length, 1);
    assert.equal(listed.tools[0].name, 'echo');

    const call = plugin.tools.find((t) => t.name === 'mcp_call');
    const result = await call.execute({ tool: 'echo', arguments: { text: 'hi' } }, ctx());
    assert.equal(result.content[0].text, 'echo:hi');
  } finally {
    await plugin._reset();
  }
});

test('mcp_call propagates server error', async () => {
  await plugin._reset();
  plugin.configure({
    command: process.execPath,
    args: ['-e', MOCK_SERVER],
    timeoutMs: 5_000,
  });
  try {
    const call = plugin.tools.find((t) => t.name === 'mcp_call');
    await assert.rejects(
      call.execute({ tool: 'does_not_exist', arguments: {} }, ctx()),
      /unknown tool/,
    );
  } finally {
    await plugin._reset();
  }
});

test('plugin onDisable releases the child', async () => {
  await plugin._reset();
  plugin.configure({
    command: process.execPath,
    args: ['-e', MOCK_SERVER],
    timeoutMs: 5_000,
  });
  const list = plugin.tools.find((t) => t.name === 'mcp_list_tools');
  await list.execute({}, ctx());
  await plugin.onDisable(); // should not hang
  // After disable, calling again must spin up a fresh client.
  await plugin._reset();
  plugin.configure({
    command: process.execPath,
    args: ['-e', MOCK_SERVER],
    timeoutMs: 5_000,
  });
  await list.execute({}, ctx());
  await plugin._reset();
});

test('plugin source path matches plugins/mcp-bridge', () => {
  // Sanity: makes sure the test file is co-located with the plugin
  assert.ok(__dirname.endsWith(path.join('plugins', 'mcp-bridge', 'tests')));
});
