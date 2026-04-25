'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

// ---- Minimal fake LLM matching the host's `complete({ model, messages })` shape.
function fakeLLM({ content }) {
  return {
    calls: [],
    async complete(req) {
      this.calls.push(req);
      return { content };
    },
  };
}

test('plugin manifest exposes code_translate and code_scan_secrets tools', () => {
  assert.equal(plugin.name, 'code-translator');
  assert.equal(plugin.version, '1.0.0');
  const names = plugin.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['code_scan_secrets', 'code_translate']);
  // permission for the LLM tool is declared
  const translate = plugin.tools.find(t => t.name === 'code_translate');
  assert.deepEqual(translate.permissions, ['llm:complete']);
});

test('resolveLanguage normalises common aliases and rejects unknowns', () => {
  assert.equal(plugin.resolveLanguage('py'), 'python');
  assert.equal(plugin.resolveLanguage('JS'), 'javascript');
  assert.equal(plugin.resolveLanguage('Golang'), 'go');
  assert.equal(plugin.resolveLanguage('c#'), 'csharp');
  assert.throws(() => plugin.resolveLanguage('cobol'), /unsupported language/);
  assert.throws(() => plugin.resolveLanguage(''), /language is required/);
});

test('stripFence removes a single ``` wrapper but leaves clean text alone', () => {
  assert.equal(plugin.stripFence('```python\nprint(1)\n```'), 'print(1)');
  assert.equal(plugin.stripFence('```\nx = 1\n```'), 'x = 1');
  assert.equal(plugin.stripFence('print(1)'), 'print(1)');
  assert.equal(plugin.stripFence('  ```js\nfoo()\n```  '), 'foo()');
});

test('scanForSecrets flags OpenAI/AWS/GitHub/PEM patterns and includes line numbers', () => {
  const src = [
    'const safe = 1;',                                  // 1
    'const k = "sk-AAAA1111BBBB2222CCCC3333DDDD";',     // 2 — openai key
    'const aws = "AKIAIOSFODNN7EXAMPLE";',              // 3 — aws access key
    'const gh = "ghp_AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH";',// 4 — github
    '-----BEGIN RSA PRIVATE KEY-----',                  // 5 — pem
  ].join('\n');
  const findings = plugin.scanForSecrets(src);
  // We expect at least one finding per planted line. Allow extras (catch-alls).
  const kinds = new Set(findings.map(f => f.kind));
  const lines = new Set(findings.map(f => f.line));
  assert.ok(kinds.has('openai_api_key'));
  assert.ok(kinds.has('aws_access_key'));
  assert.ok(kinds.has('github_token'));
  assert.ok(kinds.has('private_key_pem'));
  for (const line of [2, 3, 4, 5]) assert.ok(lines.has(line), `expected line ${line} flagged`);
  // Snippets are redacted (no full key echoed).
  for (const f of findings) {
    assert.ok(!f.snippet.includes('AAAA1111BBBB2222'),
      `snippet should be redacted, got ${f.snippet}`);
  }
});

test('scanForSecrets matches API_KEY / SECRET / PASSWORD assignment forms', () => {
  const src = [
    'API_KEY = "abcdefghijklmnopqrstuv"',
    'CLIENT_SECRET: thisIsAlsoSecretValue123',
    'PASSWORD = "hunter2hunter"',
    'normal_var = "hello"',
  ].join('\n');
  const findings = plugin.scanForSecrets(src);
  const kinds = new Set(findings.map(f => f.kind));
  assert.ok(kinds.has('api_key_assignment'));
  assert.ok(kinds.has('secret_assignment'));
  assert.ok(kinds.has('password_assignment'));
  // The "normal_var" line should not show up.
  for (const f of findings) assert.notEqual(f.line, 4);
});

test('code_translate happy path: clean source → translated body, fence stripped', async () => {
  const tool = plugin.tools.find(t => t.name === 'code_translate');
  const llm = fakeLLM({ content: '```python\ndef add(a, b):\n    return a + b\n```' });
  const result = await tool.execute(
    { source: 'function add(a, b) { return a + b; }', target_lang: 'py', source_lang: 'js' },
    { llm },
  );
  assert.equal(result.target_lang, 'python');
  assert.equal(result.source_lang, 'javascript');
  assert.equal(result.translated, 'def add(a, b):\n    return a + b');
  assert.ok(result.bytes_in > 0);
  assert.ok(result.bytes_out > 0);
  // The system prompt should mention the resolved canonical language.
  assert.equal(llm.calls.length, 1);
  const sys = llm.calls[0].messages[0];
  assert.equal(sys.role, 'system');
  assert.match(sys.content, /to python/);
  assert.match(sys.content, /from javascript/);
});

test('code_translate refuses sources containing secrets and tags the error code', async () => {
  const tool = plugin.tools.find(t => t.name === 'code_translate');
  const llm = fakeLLM({ content: 'should never be called' });
  await assert.rejects(
    tool.execute(
      { source: 'const k = "sk-AAAA1111BBBB2222CCCC3333DDDD";', target_lang: 'python' },
      { llm },
    ),
    (err) => {
      assert.equal(err.code, 'SECRET_DETECTED');
      assert.ok(Array.isArray(err.findings) && err.findings.length > 0);
      assert.match(err.message, /refusing to translate/);
      return true;
    },
  );
  // Crucially, the LLM was NOT called — the secret never left the host.
  assert.equal(llm.calls.length, 0);
});

test('code_translate validates inputs (empty source, oversize, missing target, missing llm)', async () => {
  const tool = plugin.tools.find(t => t.name === 'code_translate');
  // empty source
  await assert.rejects(
    tool.execute({ source: '', target_lang: 'python' }, { llm: fakeLLM({ content: '' }) }),
    /source is required/,
  );
  // oversize source
  const big = 'a'.repeat(64 * 1024 + 1);
  await assert.rejects(
    tool.execute({ source: big, target_lang: 'python' }, { llm: fakeLLM({ content: '' }) }),
    /source too large/,
  );
  // missing target lang
  await assert.rejects(
    tool.execute({ source: 'x = 1' }, { llm: fakeLLM({ content: '' }) }),
    /language is required/,
  );
  // missing llm in context
  await assert.rejects(
    tool.execute({ source: 'x = 1', target_lang: 'python' }, {}),
    /LLM client not available/,
  );
});

test('code_scan_secrets tool returns { findings, clean } for both clean and dirty input', async () => {
  const tool = plugin.tools.find(t => t.name === 'code_scan_secrets');
  const clean = await tool.execute({ source: 'function add(a, b) { return a + b; }' }, {});
  assert.equal(clean.clean, true);
  assert.deepEqual(clean.findings, []);

  const dirty = await tool.execute(
    { source: 'API_KEY = "abcdefghijklmnopqrstuv"' },
    {},
  );
  assert.equal(dirty.clean, false);
  assert.ok(dirty.findings.length >= 1);
  assert.equal(dirty.findings[0].line, 1);
});
