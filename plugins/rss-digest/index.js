// OpenHand RSS Digest Plugin
//
// Fetches an RSS 2.0 / Atom feed with the built-in `fetch`, parses it with a
// tiny regex-based reader (no `xml2js`, no `fast-xml-parser`, no runtime
// deps), and writes a Markdown digest to `~/.openhand/digests/`.
//
// Why regex and not a real XML parser? Because the surface we accept is
// narrow — we only pull a handful of leaf tags (title, link, pubDate,
// description, summary, updated, id, guid). A real parser would pull in
// kilobytes of JS and a dozen edge cases we don't need. We *do* strip
// CDATA, decode the five HTML entities, and fail closed on oversized
// documents.
//
// Exposed tools:
//   - rss_fetch(url, limit?)       — parse and return items (pure)
//   - rss_digest(url, out?, title?) — fetch + render + persist (IO)

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const MAX_BYTES = 4 * 1024 * 1024; // 4 MiB — well above any sane feed.
const DEFAULT_LIMIT = 20;

function decodeEntities(s) {
  if (!s) return '';
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function stripCdata(s) {
  if (!s) return '';
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(s) {
  if (!s) return '';
  return s.replace(/<[^>]*>/g, '');
}

function clean(s, maxLen) {
  const out = decodeEntities(stripTags(stripCdata(s ?? ''))).trim();
  if (maxLen && out.length > maxLen) return out.slice(0, maxLen - 1) + '…';
  return out;
}

/**
 * Extract items from an RSS 2.0 or Atom feed string.
 * Fails closed on non-strings and on oversized inputs.
 */
function parseFeed(xml, limit) {
  if (typeof xml !== 'string') {
    throw new TypeError('feed must be a string');
  }
  if (xml.length > MAX_BYTES) {
    throw new Error(`feed too large (${xml.length} > ${MAX_BYTES} bytes)`);
  }
  const cap = Number.isFinite(limit) && limit > 0 ? Math.min(limit, 200) : DEFAULT_LIMIT;

  // Channel / feed-level title (best effort — used only when caller omits one).
  let feedTitle = '';
  const headBlock = xml.slice(0, Math.min(xml.length, 4096));
  const mTitle = headBlock.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  if (mTitle) feedTitle = clean(mTitle[1], 200);

  const items = [];
  const itemRe = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = itemRe.exec(xml)) && items.length < cap) {
    const block = m[2] || '';
    const get = tag => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const v = block.match(r);
      return v ? clean(v[1], 1024) : '';
    };
    // Atom <link href="…" /> variant.
    let link = get('link');
    if (!link) {
      const atomLink = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i);
      if (atomLink) link = atomLink[1];
    }
    items.push({
      title: get('title') || '(untitled)',
      link,
      pubDate: get('pubDate') || get('updated') || get('published') || '',
      summary: (get('description') || get('summary') || '').slice(0, 500),
      guid: get('guid') || get('id') || link,
    });
  }

  return { feedTitle, items };
}

/**
 * Render a digest as Markdown. Pure — no IO, no time reads.
 * `now` is injected so tests don't drift.
 */
function renderMarkdown({ feedTitle, url, items, title, now }) {
  const displayTitle = title || feedTitle || 'RSS Digest';
  const stamp = (now instanceof Date ? now : new Date()).toISOString();
  const lines = [];
  lines.push(`# ${displayTitle}`);
  lines.push('');
  lines.push(`- Source: ${url}`);
  lines.push(`- Generated: ${stamp}`);
  lines.push(`- Items: ${items.length}`);
  lines.push('');
  if (items.length === 0) {
    lines.push('_(no items)_');
  } else {
    for (const it of items) {
      lines.push(`## ${it.title}`);
      if (it.link) lines.push(`[${it.link}](${it.link})`);
      if (it.pubDate) lines.push(`*${it.pubDate}*`);
      if (it.summary) {
        lines.push('');
        lines.push(it.summary);
      }
      lines.push('');
    }
  }
  return lines.join('\n');
}

function digestsDir() {
  const base = process.env.OPENHAND_HOME
    ? resolveTilde(process.env.OPENHAND_HOME)
    : path.join(os.homedir(), '.openhand');
  return path.join(base, 'digests');
}

function resolveTilde(p) {
  if (!p) return p;
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

function safeFilename(url, now) {
  // Derive host from a URL without requiring valid network URLs in tests.
  let host = 'feed';
  try {
    const u = new URL(url);
    host = u.hostname || 'feed';
  } catch {
    host = String(url || 'feed').replace(/[^a-z0-9.-]/gi, '-').slice(0, 40) || 'feed';
  }
  const stamp = (now instanceof Date ? now : new Date())
    .toISOString()
    .replace(/[:T]/g, '-')
    .slice(0, 19);
  return `${stamp}-${host}.md`;
}

async function defaultFetch(url) {
  const res = await fetch(url, {
    headers: { 'user-agent': 'openhand-rss-digest/1.0' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`fetch ${url} failed: ${res.status}`);
  return await res.text();
}

/**
 * End-to-end: fetch → parse → render → write. IO is injectable so tests
 * stay hermetic. Returns the absolute path written.
 */
async function writeDigest({
  url,
  outDir,
  title,
  limit,
  fetchImpl,
  writeFile,
  mkdir,
  now,
}) {
  if (!url || typeof url !== 'string') {
    throw new TypeError('url is required');
  }
  const fetchFn = fetchImpl || defaultFetch;
  const body = await fetchFn(url);
  const parsed = parseFeed(body, limit);
  const md = renderMarkdown({ ...parsed, url, title, now });
  const dir = outDir || digestsDir();
  const filename = safeFilename(url, now);
  const full = path.join(dir, filename);
  const mk = mkdir || (async p => fs.promises.mkdir(p, { recursive: true }));
  const wr = writeFile || (async (p, c) => fs.promises.writeFile(p, c, 'utf-8'));
  await mk(dir);
  await wr(full, md);
  return { path: full, items: parsed.items.length, bytes: Buffer.byteLength(md, 'utf8') };
}

module.exports = {
  name: 'rss-digest',
  version: '1.0.0',
  description: 'Subscribe → summarise → persist RSS/Atom feeds.',

  // Exposed for unit tests and for the cookbook.
  parseFeed,
  renderMarkdown,
  safeFilename,
  digestsDir,
  writeDigest,

  tools: [
    {
      name: 'rss_fetch',
      description: 'Download an RSS/Atom feed and return parsed items. No disk writes.',
      parameters: [
        { name: 'url', type: 'string', description: 'Feed URL', required: true },
        { name: 'limit', type: 'number', description: 'Max items (default 20)', required: false },
      ],
      permissions: ['network:http'],
      sandboxRequired: false,
      async execute(params) {
        const body = await defaultFetch(params.url);
        return parseFeed(body, params.limit);
      },
    },
    {
      name: 'rss_digest',
      description: 'Fetch a feed and write a Markdown digest into ~/.openhand/digests/.',
      parameters: [
        { name: 'url', type: 'string', description: 'Feed URL', required: true },
        { name: 'title', type: 'string', description: 'Optional digest title', required: false },
        { name: 'limit', type: 'number', description: 'Max items (default 20)', required: false },
      ],
      permissions: ['network:http', 'fs:write:~/.openhand'],
      sandboxRequired: false,
      async execute(params) {
        return await writeDigest({
          url: params.url,
          title: params.title,
          limit: params.limit,
        });
      },
    },
  ],

  async onEnable() {
    // Best-effort — we create the output directory lazily on first write.
  },
};
