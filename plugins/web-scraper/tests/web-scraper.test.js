'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

// --- helpers -----------------------------------------------------------------

/**
 * Minimal fetch fake. Returns a Response-like object with a text() method
 * and a streaming body so `fetchBounded` exercises the byte-cap reader.
 */
function makeFetch({ status = 200, body = '', contentType = 'text/html', url = null } = {}) {
  return async (target) => {
    const enc = new TextEncoder().encode(body);
    let pulled = false;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'ERR',
      url: url ?? target,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? contentType : null) },
      body: {
        getReader() {
          return {
            async read() {
              if (pulled) return { value: undefined, done: true };
              pulled = true;
              return { value: enc, done: false };
            },
            async cancel() {},
          };
        },
      },
      async text() { return body; },
    };
  };
}

const SAMPLE_HTML = `<!doctype html>
<html><head><title>Example Domain</title></head>
<body>
  <header>nav</header>
  <main>
    <h1>About OpenHand</h1>
    <p>OpenHand is a small, plugin-first agent runtime.</p>
    <p>It supports OpenAI, Anthropic, and Ollama out of the box.</p>
    <script>console.log('should be stripped');</script>
  </main>
  <footer>copyright</footer>
</body></html>`;

// --- tests -------------------------------------------------------------------

test('plugin manifest exposes both tools with correct permissions', () => {
  const names = plugin.tools.map(t => t.name).sort();
  assert.deepEqual(names, ['scrape_extract', 'scrape_summary']);
  const summary = plugin.tools.find(t => t.name === 'scrape_summary');
  assert.deepEqual(summary.permissions.sort(), ['llm:chat', 'network:http']);
  const extract = plugin.tools.find(t => t.name === 'scrape_extract');
  assert.deepEqual(extract.permissions, ['network:http']);
});

test('assertSafeUrlFallback rejects non-http schemes', () => {
  assert.throws(() => plugin.assertSafeUrlFallback('file:///etc/passwd'), /Disallowed URL scheme/);
  assert.throws(() => plugin.assertSafeUrlFallback('data:text/plain,hi'), /Disallowed URL scheme/);
  assert.throws(() => plugin.assertSafeUrlFallback('gopher://x.example/'), /Disallowed URL scheme/);
});

test('assertSafeUrlFallback rejects loopback and RFC1918', () => {
  assert.throws(() => plugin.assertSafeUrlFallback('http://localhost/'), /Blocked hostname/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://127.0.0.1/'), /Blocked private\/loopback/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://10.0.0.5/'), /Blocked private\/loopback/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://172.16.0.1/'), /Blocked private\/loopback/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://192.168.1.1/'), /Blocked private\/loopback/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://169.254.169.254/'), /Blocked private\/loopback/);
});

test('assertSafeUrlFallback rejects IPv6 loopback / link-local / ULA', () => {
  assert.throws(() => plugin.assertSafeUrlFallback('http://[::1]/'), /Blocked private\/loopback IPv6/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://[fe80::1]/'), /Blocked private\/loopback IPv6/);
  assert.throws(() => plugin.assertSafeUrlFallback('http://[fc00::1]/'), /Blocked private\/loopback IPv6/);
});

test('assertSafeUrlFallback accepts public URLs', () => {
  const u = plugin.assertSafeUrlFallback('https://example.com/path?x=1');
  assert.equal(u.hostname, 'example.com');
  assert.equal(u.protocol, 'https:');
});

test('sanitiseHeaders strips Cookie / Authorization / Host', () => {
  const out = plugin.sanitiseHeaders({
    Cookie: 'sid=abc',
    cookie: 'sid=abc',
    Authorization: 'Bearer x',
    'X-Forwarded-For': '1.2.3.4',
    Host: 'evil',
    Accept: 'text/html',
    nonString: 42,
  });
  assert.deepEqual(Object.keys(out).sort(), ['Accept']);
  assert.equal(out.Accept, 'text/html');
});

test('extractText strips scripts/style/nav/footer and exposes title', () => {
  const out = plugin.extractText(SAMPLE_HTML);
  assert.equal(out.title, 'Example Domain');
  assert.match(out.text, /About OpenHand/);
  assert.match(out.text, /plugin-first/);
  assert.doesNotMatch(out.text, /should be stripped/);
  assert.doesNotMatch(out.text, /copyright/);
});

test('extractText supports a CSS selector', () => {
  const out = plugin.extractText(SAMPLE_HTML, 'h1');
  assert.match(out.text, /About OpenHand/);
  assert.match(out.via, /selector/);
});

test('fetchBounded honours the byte cap and timeout', async () => {
  const big = 'x'.repeat(50_000);
  const f = makeFetch({ body: big });
  const out = await plugin.fetchBounded(new URL('https://example.com/'), {
    fetchImpl: f,
    maxBytes: 1024,
  });
  assert.ok(out.text.length <= 1024 + 8); // +allowance for incomplete UTF-8 boundary
  assert.equal(out.status, 200);
});

test('fetchBounded surfaces non-2xx status', async () => {
  const f = makeFetch({ status: 503, body: 'down' });
  const out = await plugin.fetchBounded(new URL('https://example.com/'), { fetchImpl: f });
  assert.equal(out.ok, false);
  assert.equal(out.status, 503);
});

test('buildSummaryMessages embeds focus, URL, and truncated text', () => {
  const msgs = plugin.buildSummaryMessages(
    { url: 'https://example.com/', title: 'T', text: 'BODY' },
    'security implications',
  );
  assert.equal(msgs.length, 2);
  assert.equal(msgs[0].role, 'system');
  assert.match(msgs[0].content, /JSON ONLY/);
  assert.match(msgs[1].content, /security implications/);
  assert.match(msgs[1].content, /https:\/\/example\.com\//);
  assert.match(msgs[1].content, /BODY/);
});

test('parseSummary tolerates fences, prose, and bad JSON', () => {
  const fenced = '```json\n{"title":"T","summary":"S","bullets":["a"],"entities":[],"confidence":0.9}\n```';
  const r1 = plugin.parseSummary(fenced);
  assert.equal(r1.title, 'T');
  assert.equal(r1.confidence, 0.9);
  assert.deepEqual(r1.bullets, ['a']);

  const prose = 'Sure! {"summary":"x","bullets":"not-an-array","confidence":99}';
  const r2 = plugin.parseSummary(prose);
  assert.deepEqual(r2.bullets, []);          // wrong type -> []
  assert.equal(r2.confidence, 1);            // clamped to 1

  const garbage = plugin.parseSummary('not json');
  assert.equal(garbage.confidence, 0);
  assert.match(garbage.summary, /non-JSON/);
});

test('runSummary drives a fake LLM end-to-end with a mocked fetch', async () => {
  const fakeLlm = {
    calls: 0,
    async complete(req) {
      this.calls++;
      assert.equal(req.model, 'mock-1');
      assert.equal(req.messages.length, 2);
      return {
        content: JSON.stringify({
          title: 'About OpenHand',
          summary: 'OpenHand is a plugin-first agent runtime.',
          bullets: ['plugin-first', 'sandboxed'],
          entities: ['OpenHand', 'OpenAI', 'Anthropic', 'Ollama'],
          confidence: 0.8,
        }),
      };
    },
  };
  const out = await plugin.runSummary({
    url: 'https://example.com/about',
    focus: 'product positioning',
    model: 'mock-1',
    llm: fakeLlm,
    fetchImpl: makeFetch({ body: SAMPLE_HTML }),
  });
  assert.equal(fakeLlm.calls, 1);
  assert.equal(out.summary.title, 'About OpenHand');
  assert.equal(out.summary.bullets.length, 2);
  assert.ok(out.length > 0);
  assert.match(out.url, /^https:\/\/example\.com\//);
});

test('runSummary refuses private URLs at the boundary', async () => {
  await assert.rejects(
    () => plugin.runSummary({
      url: 'http://127.0.0.1:8080/admin',
      llm: { complete: async () => ({ content: '{}' }) },
      fetchImpl: makeFetch({ body: '' }),
    }),
    /Blocked private\/loopback/,
  );
});

test('scrape_extract tool: fetch + extract round-trip', async () => {
  // Inject a fake fetch via globalThis since the tool uses plugin.fetchBounded
  // which defaults to globalThis.fetch.
  const original = globalThis.fetch;
  globalThis.fetch = makeFetch({ body: SAMPLE_HTML });
  try {
    const tool = plugin.tools.find(t => t.name === 'scrape_extract');
    const out = await tool.execute({ url: 'https://example.com/' });
    assert.match(out.text, /About OpenHand/);
    assert.equal(out.title, 'Example Domain');
    assert.ok(out.length > 0);
  } finally {
    globalThis.fetch = original;
  }
});

test('scrape_summary tool errors clearly when context.llm is missing', async () => {
  const tool = plugin.tools.find(t => t.name === 'scrape_summary');
  await assert.rejects(
    () => tool.execute({ url: 'https://example.com/' }, {}),
    /requires context\.llm/,
  );
});

// ---------------------------------------------------------------------------
// Higher-fidelity smoke: the plugin is normally invoked from an agent that
// hands it the canonical `@openhand/llm` MockProvider via context.llm. This
// test mirrors that path end-to-end without a network call:
//
//   `scrape_summary` tool  →  plugin.runSummary  →  fetchBounded (fake fetch
//   returning real example.com-style HTML)  →  extractText  →  LLMClient
//   over MockProvider  →  parseSummary  →  structured result.
//
// If anything in that chain regresses (export shape, prompt format, Mock
// stream hookup, JSON parser), this test fails before the wider e2e grid.
// ---------------------------------------------------------------------------
test('scrape_summary tool: real MockProvider summarises example.com', async () => {
  const { LLMClient, MockProvider } = require('@openhand/llm');

  // Pre-baked structured response — what a well-behaved frontier model
  // would emit for the schema we declare in `buildSummaryMessages`.
  const mock = new MockProvider({
    reply: JSON.stringify({
      title: 'Example Domain',
      summary:
        'Example.com is the IETF reserved domain reused as a stable demo target. ' +
        'OpenHand uses it as the canonical fixture for scraper smoke tests so the ' +
        'pipeline is deterministic and offline.',
      bullets: ['IETF reserved', 'Stable demo target', 'Used in OpenHand smoke tests'],
      entities: ['IETF', 'OpenHand'],
      confidence: 0.9,
    }),
    label: 'mock-summariser',
  });
  const client = new LLMClient({ provider: mock, retry: { maxAttempts: 1 } });

  // The plugin tool expects a context whose `llm` quacks like LLMClient.
  const tool = plugin.tools.find(t => t.name === 'scrape_summary');
  const original = globalThis.fetch;
  globalThis.fetch = makeFetch({
    body: SAMPLE_HTML,
    url: 'https://example.com/',
  });
  let out;
  try {
    out = await tool.execute(
      { url: 'https://example.com/', focus: 'what it is, why we test against it', model: 'mock-1' },
      { llm: client },
    );
  } finally {
    globalThis.fetch = original;
  }

  // The full chain ran:
  assert.equal(mock.calls, 1, 'MockProvider.complete should fire exactly once');
  assert.equal(out.url, 'https://example.com/');
  assert.equal(out.summary.title, 'Example Domain');
  assert.match(out.summary.summary, /reserved domain/);
  assert.ok(out.summary.bullets.length >= 3);
  assert.ok(out.summary.entities.includes('OpenHand'));
  assert.ok(out.summary.confidence > 0.5);
  assert.ok(out.length > 0);

  // And the LLMClient saw the usage record (proves the cost-tracker path).
  assert.ok(client.costTracker.totalTokens > 0);
});
