# 02 — Writing a plugin (RSS digest, ~15 min)

**Goal:** ship a plugin that fetches an RSS feed and returns the latest N items
in a shape the agent can quote back. No build step, no extra deps.

## Skip the boilerplate: `npm run plugin:new`

The repo ships a tiny scaffolder so you can stop hand-writing manifests:

```bash
npm run plugin:new -- rss
# Scaffolding plugins/rss/
#   + plugins/rss/package.json
#   + plugins/rss/index.js
#   + plugins/rss/README.md
#   + plugins/rss/tests/rss.test.js
```

You get a manifest, a one-tool stub, a README, and a passing 3-test suite
under `node --test`. From there, replace the echo tool with whatever you
actually need (the RSS reader below is a good template). Use `--force`
to overwrite an existing directory; names must match `[a-z0-9-]+`.

The script is plain Node — see `scripts/plugin-new.js`. It honours the
"no runtime deps" rule: nothing to install, nothing to maintain.

## File layout

```text
plugins/rss/
├── package.json
└── index.js
```

## `plugins/rss/package.json`

```json
{
  "name": "@openhand/plugin-rss",
  "version": "0.1.0",
  "main": "./index.js",
  "openhand": {
    "id": "rss",
    "version": "0.1.0",
    "entry": "./index.js",
    "permissions": ["network:http"],
    "description": "Fetch and parse RSS feeds"
  }
}
```

## `plugins/rss/index.js`

```js
// Tiny RSS parser — no XML lib, just regex on <item>...</item> blocks.
// Plenty for ATOM/RSS 2.0 sources; swap in `fast-xml-parser` if you need rigor.
function parseItems(xml, limit) {
  const items = [];
  const re = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = re.exec(xml)) && items.length < limit) {
    const block = m[1];
    const get = tag => {
      const r = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
      const v = block.match(r);
      return v ? v[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };
    items.push({ title: get('title'), link: get('link'), pubDate: get('pubDate') });
  }
  return items;
}

module.exports = {
  name: 'rss',
  version: '0.1.0',
  tools: [{
    name: 'rss_digest',
    description: 'Fetch an RSS feed and return the latest items.',
    parameters: [
      { name: 'url',   type: 'string', description: 'Feed URL', required: true },
      { name: 'limit', type: 'number', description: 'Max items',  required: false, default: 5 },
    ],
    permissions: ['network:http'],
    sandboxRequired: false,
    async execute({ url, limit = 5 }) {
      const res = await fetch(url, { headers: { 'user-agent': 'openhand-rss/0.1' } });
      if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
      const xml = await res.text();
      return { feed: url, items: parseItems(xml, limit) };
    },
  }],
  onEnable()  { console.log('[rss] enabled');  },
  onDisable() { console.log('[rss] disabled'); },
};
```

## Wire it up

```ts
import { PluginLoader, pluginToolsToMap } from '@openhand/core';

const loader = new PluginLoader({ pluginsDir: './plugins' });
await loader.loadAll();
const toolMap = pluginToolsToMap(loader.listTools());
console.log([...toolMap.keys()]);   // -> ['rss_digest', ...other plugins]

// Hot reload: edit index.js and watch the loader pick it up.
const stop = loader.watch();
process.on('SIGINT', stop);
```

## Smoke test

```bash
node -e "require('./plugins/rss').tools[0].execute({ url: 'https://hnrss.org/frontpage', limit: 3 }).then(r => console.log(JSON.stringify(r, null, 2)))"
```

## Where to go from here

- Add a JSON schema for `parameters` so the LLM gets richer typing hints.
- Set `sandboxRequired: true` and route the fetch through `packages/sandbox`'s
  network policy if you want allow-list enforcement.
- Read [`docs/PLUGIN_DEVELOPMENT.md`](../docs/PLUGIN_DEVELOPMENT.md) for the
  full manifest spec.
