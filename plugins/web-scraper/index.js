// OpenHand Web Scraper Plugin
//
// Fetch a public web page, extract its readable text using cheerio, and
// (optionally) ask the LLM to produce a structured summary.
//
// Why a dedicated plugin rather than just `browser_extract` from the tools
// package? Three reasons:
//   1. We own the SSRF check at the plugin boundary so a misconfigured
//      tools package never lets a private URL slip through.
//   2. We collapse "fetch + parse + summarise" into one tool the agent
//      can call without juggling intermediate state.
//   3. The summary step is provider-agnostic: pass any object with
//      `.complete({ model, messages }) -> { content }`. MockProvider works.
//
// Exposed tools:
//   - scrape_summary(url, focus?, model?)   — fetch + extract + LLM summary
//   - scrape_extract(url, selector?)        — fetch + extract only (no LLM)
//
// Defence in depth:
//   - `assertSafeUrl` blocks loopback, RFC1918, link-local, ::1, fc00::/7,
//     fe80::/10, file://, data://, gopher://, etc.
//   - 2 MiB hard cap on response body via streaming reader.
//   - 15-second AbortController timeout per request.
//   - We strip Cookie / Authorization / Host from caller-supplied headers.

'use strict';

const MAX_RESPONSE_BYTES = 2 * 1024 * 1024; // 2 MiB
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MODEL = 'gpt-4o-mini';
const MAX_TEXT_FOR_LLM = 12_000; // generous prompt budget without blowing context

// We resolve `@openhand/tools` lazily so the plugin's unit tests never
// touch the dist build. The fallback uses a copy of the same SSRF rules
// so behaviour is identical when `@openhand/tools` isn't installed (e.g.
// minimal `npm install --no-workspaces` checkouts).
function getAssertSafeUrl() {
  try {
    // Prefer the canonical implementation when available.
    const tools = require('@openhand/tools');
    if (tools && typeof tools.assertSafeUrl === 'function') {
      return tools.assertSafeUrl;
    }
  } catch {
    /* fall through */
  }
  return assertSafeUrlFallback;
}

/**
 * Local copy of the SSRF guard. Kept in sync with
 * `packages/tools/src/browser/index.ts`. Tested directly by `tests/`.
 */
function assertSafeUrlFallback(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`Disallowed URL scheme: ${url.protocol}`);
  }
  const host = url.hostname.toLowerCase();
  const DENY = new Set(['localhost', '0.0.0.0', 'metadata.google.internal', 'metadata.goog']);
  if (DENY.has(host)) throw new Error(`Blocked hostname: ${host}`);
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const [a, b] = ipv4.slice(1).map(Number);
    if (a === 10 || a === 127 || a === 0 || a === 255 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254)) {
      throw new Error(`Blocked private/loopback IPv4: ${host}`);
    }
  }
  if (host.startsWith('[') && host.endsWith(']')) {
    const v6 = host.slice(1, -1);
    if (v6 === '::1' || v6 === '::' || v6.startsWith('fe80:') || v6.startsWith('fc') || v6.startsWith('fd')) {
      throw new Error(`Blocked private/loopback IPv6: ${v6}`);
    }
  }
  return url;
}

/**
 * Sanitise caller-supplied headers. Drops anything that could let a tool
 * call exfiltrate creds or impersonate the host.
 */
function sanitiseHeaders(input) {
  if (!input || typeof input !== 'object') return {};
  const out = {};
  const banned = new Set([
    'host', 'cookie', 'authorization', 'proxy-authorization', 'x-forwarded-for',
  ]);
  for (const [k, v] of Object.entries(input)) {
    if (typeof k !== 'string') continue;
    if (banned.has(k.toLowerCase())) continue;
    if (typeof v !== 'string') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Fetch a URL with a hard byte cap and timeout. Returns the body as text.
 * Exposed so tests can drive it with `fetch` overrides.
 */
async function fetchBounded(url, { headers = {}, fetchImpl, timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_RESPONSE_BYTES } = {}) {
  const f = fetchImpl || globalThis.fetch;
  if (typeof f !== 'function') throw new Error('No fetch() available; pass fetchImpl');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await f(url.toString(), {
      method: 'GET',
      headers: { 'user-agent': 'openhand-web-scraper/1.0', ...sanitiseHeaders(headers) },
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!res || typeof res.status !== 'number') {
      throw new Error('fetch returned a non-Response value');
    }
    // Streamed body when available.
    let text;
    if (res.body && typeof res.body.getReader === 'function') {
      text = await readBoundedStream(res.body.getReader(), maxBytes);
    } else if (typeof res.text === 'function') {
      const raw = await res.text();
      text = raw.length > maxBytes ? raw.slice(0, maxBytes) : raw;
    } else {
      text = '';
    }
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText || '',
      url: typeof res.url === 'string' ? res.url : url.toString(),
      contentType: typeof res.headers?.get === 'function' ? res.headers.get('content-type') || '' : '',
      text,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function readBoundedStream(reader, maxBytes) {
  let received = 0;
  const chunks = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    let chunk = value;
    const remaining = maxBytes - received;
    if (chunk.byteLength > remaining) {
      // Truncate the final chunk so the merged buffer never exceeds the cap.
      chunk = chunk.subarray(0, Math.max(0, remaining));
      received += chunk.byteLength;
      if (chunk.byteLength > 0) chunks.push(chunk);
      try { await reader.cancel(); } catch { /* ignore */ }
      break;
    }
    received += chunk.byteLength;
    chunks.push(chunk);
  }
  const merged = new Uint8Array(received);
  let offset = 0;
  for (const c of chunks) { merged.set(c, offset); offset += c.byteLength; }
  return new TextDecoder('utf-8', { fatal: false }).decode(merged);
}

/**
 * Reduce HTML to readable text. Uses cheerio when present for accuracy;
 * otherwise falls back to a regex strip — good enough for non-LLM consumers
 * and keeps the plugin runnable in environments without the dist build.
 */
function extractText(html, selector) {
  let cheerio;
  try { cheerio = require('cheerio'); } catch { /* fallback below */ }
  if (cheerio && typeof cheerio.load === 'function') {
    const $ = cheerio.load(html);
    if (selector) {
      const out = $(String(selector)).map((_, el) => $(el).text()).get();
      return { title: $('title').text().trim(), text: out.join('\n').trim(), via: 'cheerio+selector' };
    }
    $('script, style, noscript, iframe, nav, footer, header').remove();
    const title = $('title').text().trim();
    const text = $('body').text().replace(/\s+/g, ' ').trim();
    return { title, text, via: 'cheerio' };
  }
  // Fallback: strip tags + collapse whitespace.
  const titleMatch = html.match(/<title>([\s\S]*?)<\/title>/i);
  const stripped = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return { title: (titleMatch?.[1] || '').trim(), text: stripped, via: 'regex' };
}

/** Build the chat messages we send to the LLM for `scrape_summary`. */
function buildSummaryMessages(page, focus) {
  const focusLine = focus
    ? `Reader focus: ${focus}.`
    : 'Reader focus: factual summary, key claims, notable links.';
  // Keep the prompt strict so callers can JSON.parse the result.
  return [
    {
      role: 'system',
      content: [
        'You summarise web pages for an autonomous agent.',
        'Output JSON ONLY, no prose, no code fences.',
        'Schema:',
        '{',
        '  "title": string,',
        '  "summary": string,        // 3-6 sentences',
        '  "bullets": string[],      // 3-7 bullets',
        '  "entities": string[],     // people / orgs / products mentioned',
        '  "confidence": number      // 0..1; lower if the page was thin or noisy',
        '}',
      ].join('\n'),
    },
    {
      role: 'user',
      content: [
        focusLine,
        `URL: ${page.url}`,
        `Title: ${page.title || '(none)'}`,
        '',
        'Page text (truncated):',
        page.text.slice(0, MAX_TEXT_FOR_LLM),
      ].join('\n'),
    },
  ];
}

/** Tolerant JSON parser that copes with the usual LLM oversights. */
function parseSummary(raw) {
  if (!raw || typeof raw !== 'string') return fallbackSummary('empty LLM response');
  let s = raw.trim();
  if (s.startsWith('```')) s = s.replace(/^```[a-zA-Z]*\n?/, '').replace(/\n?```\s*$/, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);
  try {
    return normaliseSummary(JSON.parse(s));
  } catch {
    return fallbackSummary('non-JSON response');
  }
}

function normaliseSummary(r) {
  const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === 'string').slice(0, 12) : []);
  let conf = Number(r?.confidence);
  if (!Number.isFinite(conf)) conf = 0.5;
  conf = Math.max(0, Math.min(1, conf));
  return {
    title: typeof r?.title === 'string' ? r.title : '',
    summary: typeof r?.summary === 'string' ? r.summary : '',
    bullets: arr(r?.bullets),
    entities: arr(r?.entities),
    confidence: conf,
  };
}

function fallbackSummary(reason) {
  return { title: '', summary: `(no summary — ${reason})`, bullets: [], entities: [], confidence: 0 };
}

/** Full pipeline: fetch + extract + LLM summary. */
async function runSummary({ url, focus, llm, model, fetchImpl }) {
  const safe = getAssertSafeUrl()(url);
  const fetched = await fetchBounded(safe, { fetchImpl });
  if (!fetched.ok) throw new Error(`fetch failed: ${fetched.status} ${fetched.statusText}`);
  const page = { url: fetched.url, ...extractText(fetched.text) };
  if (!llm || typeof llm.complete !== 'function') {
    throw new TypeError('runSummary: llm.complete() is required');
  }
  const res = await llm.complete({
    model: model || DEFAULT_MODEL,
    messages: buildSummaryMessages(page, focus),
    temperature: 0.1,
    maxTokens: 600,
  });
  const summary = parseSummary(res && res.content);
  return { url: page.url, title: page.title || summary.title, summary, length: page.text.length };
}

module.exports = {
  name: 'web-scraper',
  version: '1.0.0',
  description: 'SSRF-guarded fetch + cheerio extract + LLM summary.',

  // Internals exposed for unit tests.
  assertSafeUrlFallback,
  sanitiseHeaders,
  fetchBounded,
  extractText,
  buildSummaryMessages,
  parseSummary,
  runSummary,

  tools: [
    {
      name: 'scrape_summary',
      description: 'Fetch a URL, extract readable text, and ask the LLM for a structured summary.',
      parameters: [
        { name: 'url',   type: 'string', description: 'Target URL', required: true },
        { name: 'focus', type: 'string', description: 'Reader focus hint', required: false },
        { name: 'model', type: 'string', description: 'LLM model id',     required: false },
      ],
      permissions: ['network:http', 'llm:chat'],
      sandboxRequired: false,
      async execute(params, context) {
        const llm = context && context.llm;
        if (!llm) throw new Error('scrape_summary requires context.llm');
        return await runSummary({
          url: params.url,
          focus: params.focus,
          model: params.model,
          llm,
        });
      },
    },
    {
      name: 'scrape_extract',
      description: 'Fetch a URL and return readable text. No LLM call.',
      parameters: [
        { name: 'url',      type: 'string', description: 'Target URL', required: true },
        { name: 'selector', type: 'string', description: 'Optional CSS selector', required: false },
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      async execute(params) {
        const safe = getAssertSafeUrl()(params.url);
        const fetched = await fetchBounded(safe);
        if (!fetched.ok) throw new Error(`fetch failed: ${fetched.status} ${fetched.statusText}`);
        const ex = extractText(fetched.text, params.selector);
        return { url: fetched.url, ...ex, length: ex.text.length };
      },
    },
  ],

  async onEnable() { /* stateless */ },
};
