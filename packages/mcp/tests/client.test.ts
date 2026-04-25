import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MCPClient } from '../src/client';
import { bridgeMcpTools, schemaToParameters, flattenResult } from '../src/bridge';
import { MOCK_SERVER_SOURCE } from './mock-server';

function newClient(): MCPClient {
  return new MCPClient({
    command: process.execPath,
    args: ['-e', MOCK_SERVER_SOURCE],
    timeoutMs: 5_000,
  });
}

test('MCPClient handshakes and lists tools', async () => {
  const client = newClient();
  try {
    await client.start();
    const tools = await client.listTools();
    assert.equal(tools.length, 2);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['boom', 'echo']);
    const echo = tools.find((t) => t.name === 'echo')!;
    assert.equal(echo.description, 'Echo back the text argument.');
    assert.deepEqual(echo.inputSchema?.required, ['text']);
  } finally {
    await client.stop();
  }
});

test('MCPClient.callTool returns content array', async () => {
  const client = newClient();
  try {
    await client.start();
    const out = await client.callTool('echo', { text: 'hi' });
    assert.equal(out.content[0]?.text, 'echo:hi');
  } finally {
    await client.stop();
  }
});

test('MCPClient.callTool propagates JSON-RPC errors', async () => {
  const client = newClient();
  try {
    await client.start();
    await assert.rejects(client.callTool('boom', {}), /boom requested/);
  } finally {
    await client.stop();
  }
});

test('MCPClient times out a stuck request', async () => {
  // Mock server that NEVER replies — drain stdin, do nothing.
  const client = new MCPClient({
    command: process.execPath,
    args: ['-e', "process.stdin.on('data', function(){}); setInterval(function(){}, 1000);"],
    timeoutMs: 200,
  });
  try {
    // Initialize itself will time out — that's exactly the path we want
    // to assert: a non-cooperative server can't hang us forever.
    await assert.rejects(client.start(), /timed out/);
  } finally {
    await client.stop();
  }
});

test('MCPClient.start rejects when called twice', async () => {
  const client = newClient();
  try {
    await client.start();
    await assert.rejects(client.start(), /already started/);
  } finally {
    await client.stop();
  }
});

test('schemaToParameters: properties become ToolParameters with required flags', () => {
  const params = schemaToParameters({
    type: 'object',
    properties: { text: { type: 'string' }, n: { type: 'integer' } },
    required: ['text'],
  });
  const byName = Object.fromEntries(params.map((p) => [p.name, p]));
  assert.equal(byName.text!.required, true);
  assert.equal(byName.text!.type, 'string');
  assert.equal(byName.n!.type, 'number'); // integer collapses to number
  assert.equal(byName.n!.required, false);
});

test('schemaToParameters: missing schema falls back to {arguments:object}', () => {
  const params = schemaToParameters(undefined);
  assert.equal(params.length, 1);
  assert.equal(params[0]!.name, 'arguments');
  assert.equal(params[0]!.type, 'object');
});

test('flattenResult joins text content blocks', () => {
  const text = flattenResult({ content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] });
  assert.equal(text, 'a\nb');
});

test('bridgeMcpTools wraps each MCP tool as an OpenHand Tool', async () => {
  const client = newClient();
  try {
    await client.start();
    const tools = await bridgeMcpTools(client, { prefix: 'mcp_' });
    assert.equal(tools.size, 2);
    const echo = tools.get('mcp_echo');
    assert.ok(echo);
    assert.equal(echo!.permissions[0], 'mcp:invoke');
    assert.equal(echo!.sandboxRequired, false);

    const ctx = {
      taskId: 't', userId: 'u', sessionId: 's',
      permissions: ['mcp:invoke'], workingDirectory: '/tmp', env: {},
    };
    const result = (await echo!.execute({ text: 'world' }, ctx)) as { text: string };
    assert.equal(result.text, 'echo:world');
  } finally {
    await client.stop();
  }
});

test('bridged tool surfaces server error as a thrown Error', async () => {
  const client = newClient();
  try {
    await client.start();
    const tools = await bridgeMcpTools(client);
    const boom = tools.get('mcp_boom')!;
    const ctx = {
      taskId: 't', userId: 'u', sessionId: 's',
      permissions: ['mcp:invoke'], workingDirectory: '/tmp', env: {},
    };
    await assert.rejects(boom.execute({}, ctx), /boom requested/);
  } finally {
    await client.stop();
  }
});

test('MCPClient.stop after exit is a no-op', async () => {
  const client = newClient();
  await client.start();
  await client.stop();
  await client.stop(); // should not throw
});
