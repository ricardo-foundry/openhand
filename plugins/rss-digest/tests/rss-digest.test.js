'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
  <title>Example Feed</title>
  <link>https://example.com</link>
  <item>
    <title>First Post</title>
    <link>https://example.com/1</link>
    <pubDate>Tue, 20 Apr 2026 10:00:00 GMT</pubDate>
    <description><![CDATA[<p>Hello <b>world</b> &amp; friends</p>]]></description>
    <guid>post-1</guid>
  </item>
  <item>
    <title>Second &amp; Final</title>
    <link>https://example.com/2</link>
    <pubDate>Wed, 21 Apr 2026 10:00:00 GMT</pubDate>
    <description>Short summary</description>
    <guid>post-2</guid>
  </item>
</channel></rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom One</title>
    <link href="https://example.com/a1" />
    <updated>2026-04-21T10:00:00Z</updated>
    <summary>Atom summary</summary>
    <id>urn:id:1</id>
  </entry>
</feed>`;

test('parseFeed extracts RSS 2.0 items and strips CDATA + entities', () => {
  const { feedTitle, items } = plugin.parseFeed(SAMPLE_RSS, 10);
  assert.equal(feedTitle, 'Example Feed');
  assert.equal(items.length, 2);
  assert.equal(items[0].title, 'First Post');
  assert.equal(items[0].link, 'https://example.com/1');
  assert.match(items[0].summary, /Hello world & friends/);
  assert.equal(items[1].title, 'Second & Final');
  assert.equal(items[1].guid, 'post-2');
});

test('parseFeed handles Atom entries with href-style links', () => {
  const { items } = plugin.parseFeed(SAMPLE_ATOM, 10);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'Atom One');
  assert.equal(items[0].link, 'https://example.com/a1');
  assert.equal(items[0].pubDate, '2026-04-21T10:00:00Z');
});

test('parseFeed respects the limit argument', () => {
  const { items } = plugin.parseFeed(SAMPLE_RSS, 1);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'First Post');
});

test('parseFeed rejects non-strings and oversized inputs', () => {
  assert.throws(() => plugin.parseFeed(null, 10), /must be a string/);
  const huge = 'x'.repeat(5 * 1024 * 1024);
  assert.throws(() => plugin.parseFeed(huge, 10), /too large/);
});

test('renderMarkdown produces a stable Markdown document', () => {
  const { items } = plugin.parseFeed(SAMPLE_RSS, 2);
  const md = plugin.renderMarkdown({
    feedTitle: 'Example Feed',
    url: 'https://example.com/feed.xml',
    items,
    now: new Date('2026-04-25T00:00:00Z'),
  });
  assert.match(md, /^# Example Feed/m);
  assert.match(md, /Source: https:\/\/example\.com\/feed\.xml/);
  assert.match(md, /Generated: 2026-04-25T00:00:00\.000Z/);
  assert.match(md, /## First Post/);
  assert.match(md, /## Second & Final/);
});

test('safeFilename includes ISO timestamp + host, and avoids path separators', () => {
  const now = new Date('2026-04-25T12:34:56Z');
  const name = plugin.safeFilename('https://news.example.com/feed.xml', now);
  assert.match(name, /^2026-04-25-12-34-56-news\.example\.com\.md$/);
  assert.ok(!name.includes('/'));
});

test('writeDigest runs end-to-end against injected fetch + writer', async () => {
  const fakeFetch = async url => {
    assert.equal(url, 'https://example.com/feed.xml');
    return SAMPLE_RSS;
  };
  const writes = [];
  const mkdirs = [];
  const result = await plugin.writeDigest({
    url: 'https://example.com/feed.xml',
    outDir: '/tmp/openhand-test-digests',
    title: 'Demo',
    limit: 5,
    fetchImpl: fakeFetch,
    mkdir: async p => { mkdirs.push(p); },
    writeFile: async (p, c) => { writes.push({ p, c }); },
    now: new Date('2026-04-25T00:00:00Z'),
  });
  assert.equal(result.items, 2);
  assert.equal(mkdirs[0], '/tmp/openhand-test-digests');
  assert.equal(writes.length, 1);
  assert.match(writes[0].p, /2026-04-25-00-00-00-example\.com\.md$/);
  assert.match(writes[0].c, /^# Demo/);
  assert.ok(result.bytes > 0);
});

test('plugin manifest exposes the expected tools', () => {
  const names = plugin.tools.map(t => t.name);
  assert.deepEqual(names.sort(), ['rss_digest', 'rss_fetch']);
  const fetchTool = plugin.tools.find(t => t.name === 'rss_fetch');
  assert.deepEqual(fetchTool.permissions, ['network:http']);
});
