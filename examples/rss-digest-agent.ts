/**
 * RSS digest "agent": fetches a feed every N seconds, prints the latest
 * items, and de-duplicates by GUID/link so you only see new entries.
 *
 * This is intentionally a *plain script* — not the full agent loop — so the
 * code maps 1:1 onto the cookbook recipe (`cookbook/02-writing-a-plugin.md`).
 * To convert it into a real plugin, drop `parseItems` and `fetchFeed` into
 * `plugins/rss/index.js` and export them under a `tools[]` array.
 *
 * Run:
 *   npx tsx examples/rss-digest-agent.ts                       # once
 *   POLL_MS=60000 npx tsx examples/rss-digest-agent.ts         # every minute
 */
const FEED = process.env.RSS_URL ?? 'https://hnrss.org/frontpage';
const LIMIT = Number.parseInt(process.env.RSS_LIMIT ?? '5', 10);
const POLL_MS = Number.parseInt(process.env.POLL_MS ?? '0', 10);

interface Item {
  title: string;
  link: string;
  pubDate: string;
}

function parseItems(xml: string, limit: number): Item[] {
  const items: Item[] = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1] ?? '';
    const get = (tag: string): string => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const v = block.match(r);
      return v ? v[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    items.push({ title: get('title'), link: get('link'), pubDate: get('pubDate') });
  }
  return items;
}

async function fetchFeed(url: string, limit: number): Promise<Item[]> {
  const res = await fetch(url, { headers: { 'user-agent': 'openhand-rss/0.1' } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return parseItems(await res.text(), limit);
}

const seen = new Set<string>();

async function tick(): Promise<void> {
  try {
    const items = await fetchFeed(FEED, LIMIT);
    let fresh = 0;
    for (const it of items) {
      const key = it.link || it.title;
      if (seen.has(key)) continue;
      seen.add(key);
      fresh++;
      console.log(`- ${it.title}`);
      console.log(`  ${it.link}  (${it.pubDate})`);
    }
    if (fresh === 0) console.log(`(no new items at ${new Date().toISOString()})`);
  } catch (err) {
    console.error('[error]', (err as Error).message);
  }
}

(async (): Promise<void> => {
  console.log(`[rss] feed=${FEED} limit=${LIMIT} poll=${POLL_MS || 'one-shot'}`);
  await tick();
  if (POLL_MS > 0) {
    setInterval(tick, POLL_MS);
  }
})();
