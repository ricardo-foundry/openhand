# 09 — Quick plugin in 5 minutes (`plugin:new` end-to-end)

**Goal:** scaffold a brand-new plugin with `npm run plugin:new`, swap in
real logic, watch the loader pick it up, and ship a green test — all in
under five minutes.

This is the fast path. For the deeper "why" of manifests, permissions, and
hot-reload, jump to [02-writing-a-plugin](./02-writing-a-plugin.md).

## 1. Scaffold (10 seconds)

```bash
npm run plugin:new -- coin-flip
# Scaffolding plugins/coin-flip/
#   + plugins/coin-flip/package.json
#   + plugins/coin-flip/index.js
#   + plugins/coin-flip/README.md
#   + plugins/coin-flip/tests/coin-flip.test.js
```

What you get: a `package.json` with the `openhand` manifest block, a CJS
`index.js` exporting one echo tool, a README, and three passing tests
under `node --test`. Names must match `[a-z0-9-]+`. Add `--force` to
overwrite an existing plugin directory.

The script is `scripts/plugin-new.js` — plain Node, no templating
dependency. Honours the repo's "no runtime deps" rule.

## 2. Replace the echo with real logic (90 seconds)

Open `plugins/coin-flip/index.js` and replace the single tool's body:

```js
// plugins/coin-flip/index.js
'use strict';

module.exports = {
  name: 'coin-flip',
  version: '0.1.0',
  description: 'Flip a fair coin. Optionally seedable for tests.',

  tools: [{
    name: 'coin_flip',
    description: 'Return "heads" or "tails".',
    parameters: [
      { name: 'seed', type: 'number', description: 'Optional integer seed', required: false },
    ],
    permissions: [],
    sandboxRequired: false,
    async execute({ seed } = {}) {
      const r = seed === undefined ? Math.random() : ((seed * 9301 + 49297) % 233280) / 233280;
      return { result: r < 0.5 ? 'heads' : 'tails' };
    },
  }],
};
```

## 3. Update the test (60 seconds)

Open `plugins/coin-flip/tests/coin-flip.test.js` and replace the body:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

test('coin_flip is registered', () => {
  assert.ok(plugin.tools.find(t => t.name === 'coin_flip'));
});

test('coin_flip returns heads or tails', async () => {
  const tool = plugin.tools.find(t => t.name === 'coin_flip');
  for (let s = 0; s < 20; s++) {
    const out = await tool.execute({ seed: s }, {});
    assert.match(out.result, /^(heads|tails)$/);
  }
});

test('coin_flip is deterministic with a seed', async () => {
  const tool = plugin.tools.find(t => t.name === 'coin_flip');
  const a = await tool.execute({ seed: 42 }, {});
  const b = await tool.execute({ seed: 42 }, {});
  assert.deepEqual(a, b);
});
```

## 4. Run the tests (5 seconds)

```bash
node --test plugins/coin-flip/tests/*.test.js
# ...
# 1..3
# # tests 3
# # pass 3
```

Or run **all** plugin suites at once with `npm run test:plugins`.

## 5. Wire it into the agent (60 seconds)

```ts
import { PluginLoader, pluginToolsToMap } from '@openhand/core';

const loader = new PluginLoader({ pluginsDir: './plugins' });
await loader.loadAll();
const tools = pluginToolsToMap(loader.listTools());
console.log([...tools.keys()]); // includes 'coin_flip'

const out = await tools.get('coin_flip')!.execute({}, ctx);
console.log(out.result);
```

That's it — discovery is filesystem-based, no registry, no rebuild.

## What you didn't have to do

- No `npm install` for the plugin (it has zero runtime deps).
- No build step, no TypeScript compile.
- No registration call: dropping a directory under `plugins/` is the API.
- No restart for development: `loader.watch()` re-imports on change. See
  [02-writing-a-plugin](./02-writing-a-plugin.md#hot-reload) for hot-reload.

## Where to go next

- Add real permissions (`network:http`, `fs:read:...`, `llm:chat`) to
  `package.json`'s `openhand.permissions` array. The loader denies
  unlisted capabilities at runtime.
- Look at `plugins/fortune-cookie/` for a richer single-file example
  with multiple modes and a deterministic-seed pattern, or
  `plugins/code-reviewer/` for an LLM-backed plugin with proper context
  injection.
- Read [`docs/PLUGIN_DEVELOPMENT.md`](../docs/PLUGIN_DEVELOPMENT.md) for
  the full manifest spec.
