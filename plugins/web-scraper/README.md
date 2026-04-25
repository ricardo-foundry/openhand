# @openhand/plugin-web-scraper

> SSRF-guarded fetch + cheerio extract + LLM summary, in one plugin.

This plugin lets the agent answer "summarise that page for me" without
juggling three separate tool calls. It fetches a public URL, strips
boilerplate, and asks the LLM for a structured JSON summary.

## Why a plugin and not just `browser_*`?

`packages/tools` exposes `browser_fetch` and `browser_extract`, but they
return raw text — the agent then has to compose its own summary prompt.
This plugin owns the full pipeline (fetch → extract → summarise) and
re-applies the SSRF check at the plugin boundary so a misconfigured tools
bundle can't slip a private URL through.

## Tools

| Tool | Permissions | What it does |
|------|-------------|--------------|
| `scrape_summary` | `network:http`, `llm:chat` | Fetch + extract + LLM JSON summary |
| `scrape_extract` | `network:http` | Fetch + extract only (no LLM) |

`scrape_summary` returns:

```jsonc
{
  "url": "https://...",
  "title": "...",
  "summary": {
    "title": "...",
    "summary": "3-6 sentences",
    "bullets": ["...", "..."],
    "entities": ["...", "..."],
    "confidence": 0.0-1.0
  },
  "length": 12345
}
```

## Install

The plugin lives at `plugins/web-scraper/`. The standard `PluginLoader`
auto-discovers it; nothing else to install.

```ts
import { PluginLoader, pluginToolsToMap } from '@openhand/core';

const loader = new PluginLoader({ pluginsDir: './plugins' });
await loader.loadAll();
const tools = pluginToolsToMap(loader.listTools());
console.log(tools.has('scrape_summary')); // -> true
```

## Defence in depth

- `assertSafeUrl` blocks every loopback, RFC1918, link-local, IPv6 ULA, and
  cloud-metadata host. Re-checked at the plugin boundary even though the
  underlying tools package also checks.
- 2 MiB hard cap on response body via streaming reader.
- 15-second `AbortController` timeout per request.
- Caller-supplied `Cookie`, `Authorization`, `Host`, `Proxy-Authorization`,
  and `X-Forwarded-For` headers are dropped.
- `cheerio` is used when present; otherwise the plugin falls back to a
  regex strip so it still runs in a `--no-workspaces` checkout.

## Demo (with the mock LLM, no API key)

```bash
node -e "(async () => {
  const plugin = require('./plugins/web-scraper');
  const llm = {
    complete: async () => ({
      content: JSON.stringify({
        title: 'Example',
        summary: 'A short demo summary.',
        bullets: ['a', 'b'],
        entities: ['OpenHand'],
        confidence: 0.7,
      }),
    }),
  };
  const out = await plugin.runSummary({
    url: 'https://example.com/',
    llm,
    model: 'mock-1',
  });
  console.log(JSON.stringify(out, null, 2));
})();"
```

## Tests

```bash
npm test --workspace plugins/web-scraper
# or from the root:
npm run test:plugins
```

The plugin ships **15 unit tests** covering SSRF rejection, header
sanitisation, byte-cap enforcement, the cheerio + regex extractors, JSON
parser tolerance, and the full pipeline with a fake fetch + fake LLM.
