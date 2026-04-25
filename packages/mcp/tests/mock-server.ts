// Source for the mock MCP server we spawn from the test suite.
//
// Exported as a string so the tests can do:
//   spawn('node', ['-e', MOCK_SERVER_SOURCE])
// without keeping a separate executable around. The script implements just
// enough of the MCP wire format for our adapter tests:
//   * `initialize`               -> returns serverInfo + capabilities
//   * `notifications/initialized` (notification, no reply)
//   * `tools/list`               -> two tools: `echo`, `boom`
//   * `tools/call` for `echo`    -> wraps the input back as content[0].text
//   * `tools/call` for `boom`    -> JSON-RPC error -32000
//   * unknown method             -> JSON-RPC error -32601
//
// Kept ASCII-only so it survives `node -e` quoting on every shell.

export const MOCK_SERVER_SOURCE = `
'use strict';
const stdin = process.stdin;
const stdout = process.stdout;
stdin.setEncoding('utf8');
let buf = '';
function send(obj){ stdout.write(JSON.stringify(obj) + '\\n'); }
function reply(id, result){ send({ jsonrpc: '2.0', id: id, result: result }); }
function fail(id, code, message){ send({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }); }
const TOOLS = [
  { name: 'echo', description: 'Echo back the text argument.',
    inputSchema: { type: 'object', properties: { text: { type: 'string', description: 'what to echo' } }, required: ['text'] } },
  { name: 'boom', description: 'Always errors.',
    inputSchema: { type: 'object', properties: {} } },
];
stdin.on('data', function(chunk){
  buf += chunk;
  let nl;
  while ((nl = buf.indexOf('\\n')) >= 0) {
    const line = buf.slice(0, nl).trim();
    buf = buf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch (e) { continue; }
    const id = msg.id;
    const method = msg.method;
    if (method === 'initialize') {
      reply(id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'mock', version: '0.0.1' } });
      continue;
    }
    if (method === 'notifications/initialized') { continue; }
    if (method === 'tools/list') { reply(id, { tools: TOOLS }); continue; }
    if (method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      if (name === 'echo') {
        reply(id, { content: [{ type: 'text', text: 'echo:' + String(args.text || '') }] });
      } else if (name === 'boom') {
        fail(id, -32000, 'boom requested');
      } else {
        fail(id, -32601, 'unknown tool: ' + name);
      }
      continue;
    }
    fail(id != null ? id : 0, -32601, 'unknown method: ' + method);
  }
});
stdin.on('end', function(){ process.exit(0); });
process.stderr.write('mock-mcp ready\\n');
`;
