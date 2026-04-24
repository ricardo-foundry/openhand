# @openhand/plugin-rss-digest

Subscribe to an RSS/Atom feed, render a Markdown digest, and save it to
`~/.openhand/digests/`.

## What it does

| Tool          | Description                                                                |
|---------------|----------------------------------------------------------------------------|
| `rss_fetch`   | Download the feed and return parsed items. Pure, no disk write.            |
| `rss_digest`  | Fetch → render → persist a dated Markdown file under `~/.openhand/digests/`. |

The parser handles RSS 2.0 and Atom, strips CDATA + the five HTML entities,
and caps input at 4 MiB. It deliberately does **not** pull in an XML
library — the surface we accept is tiny.

## Permissions

- `network:http` — fetch the feed
- `fs:write:~/.openhand` — drop the generated digest

## Example

```js
const plugin = require('@openhand/plugin-rss-digest');

const { items } = plugin.parseFeed(xml, 5);
const md = plugin.renderMarkdown({
  feedTitle: 'Hacker News',
  url: 'https://hnrss.org/frontpage',
  items,
});
```

Override the output directory:

```bash
OPENHAND_HOME=/tmp/openhand-demo
```

## Tests

```bash
cd plugins/rss-digest && npm test
```

Five tests covering parse / render / filename / oversize rejection / full
`writeDigest` flow (with injected fake `fetch` + filesystem).
