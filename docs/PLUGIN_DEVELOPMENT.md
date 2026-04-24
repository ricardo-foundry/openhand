# Plugin Development

A plugin is the preferred way to extend OpenHand without touching core. This
guide uses [`plugins/weather/`](../plugins/weather) as the reference and walks
you through shipping your own plugin.

---

## 1. What a plugin can do

- Register one or more **tools** that the agent can call.
- Declare **permissions** (network, filesystem, etc.) that the sandbox and
  policy engine will honor.
- Hook into **lifecycle events** (`onInstall`, `onEnable`, `onDisable`,
  `onUninstall`).
- Ship its own tests and documentation.

A plugin **cannot** monkey-patch core, talk to the LLM directly, or bypass
the sandbox. If you need that, the design is wrong — open a discussion.

---

## 2. Anatomy of `plugins/weather`

```
plugins/weather/
├── package.json       // npm package metadata
├── manifest.json      // OpenHand-specific metadata (see below)
├── index.js           // entry point: exports the plugin object
├── README.md          // user-facing docs
└── tests/             // unit tests
```

### 2.1 Manifest fields

| Field            | Required | Description                                                                 |
| ---------------- | -------- | --------------------------------------------------------------------------- |
| `id`             | yes      | Globally unique, kebab-case. Prefix with your org, e.g. `acme-finance`.     |
| `version`        | yes      | Semver. Plugin loader warns on major-version mismatch with core.            |
| `name`           | yes      | Human name shown in the UI.                                                 |
| `description`    | yes      | One sentence; appears in the plugin list.                                   |
| `permissions`    | yes      | Array of `network:http`, `fs:read`, `fs:write`, `shell`, `email:send`, ...  |
| `tools`          | yes      | Array of tool descriptors (see 2.2). May be empty for lifecycle-only plugins. |
| `entry`          | no       | Override default `./index.js`.                                              |
| `requiresConfig` | no       | Array of env-var names the plugin needs; loader will complain if missing.   |

### 2.2 Tool descriptor

```js
{
  name: 'weather_current',           // unique inside the plugin
  description: 'Get current weather for a city',
  parameters: [
    { name: 'city',  type: 'string', required: false, default: 'Beijing' },
    { name: 'units', type: 'string', required: false, default: 'celsius' },
  ],
  permissions: ['network:http'],     // subset of manifest.permissions
  sandboxRequired: false,            // true for shell/fs tools
  async execute(params, context) {
    // context: { logger, fetch, approve, env, now }
    return { city: params.city, temperature: 22 };
  }
}
```

### 2.3 Lifecycle hooks

```js
module.exports = {
  // ...tools, config...
  async onInstall(ctx) {},    // first-time install; create state, seed files
  async onEnable(ctx) {},     // every boot after installed
  async onDisable(ctx) {},    // user toggled the plugin off
  async onUninstall(ctx) {},  // clean up persisted state
};
```

`ctx` contains a logger scoped to your plugin, a short-lived `fetch`
implementation that respects sandbox rules, and an `env` snapshot.

---

## 3. Building your first plugin

### Scaffold

```bash
mkdir -p plugins/hello/tests
cat > plugins/hello/package.json <<'JSON'
{
  "name": "@yourorg/openhand-plugin-hello",
  "version": "0.1.0",
  "main": "index.js",
  "license": "MIT"
}
JSON
```

### Manifest

```json
{
  "id": "yourorg-hello",
  "version": "0.1.0",
  "name": "Hello",
  "description": "Greets the user by name.",
  "permissions": [],
  "tools": ["hello_sayhi"]
}
```

### Entry point

```js
// plugins/hello/index.js
module.exports = {
  id: 'yourorg-hello',
  version: '0.1.0',
  tools: [
    {
      name: 'hello_sayhi',
      description: 'Return a friendly greeting.',
      parameters: [
        { name: 'name', type: 'string', required: true },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute({ name }) {
        return { message: `Hello, ${name}!` };
      },
    },
  ],
  async onEnable(ctx) { ctx.logger.info('hello plugin ready'); },
};
```

### Test

```js
// plugins/hello/tests/hello.test.js
const { test } = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('..');

test('hello_sayhi returns a greeting', async () => {
  const tool = plugin.tools.find(t => t.name === 'hello_sayhi');
  const out = await tool.execute({ name: 'World' });
  assert.equal(out.message, 'Hello, World!');
});
```

Run `node --test plugins/hello/tests/*.test.js`.

---

## 4. Testing guidance

- **Pure tools** (no I/O): plain unit tests, no mocks.
- **Network tools**: stub `globalThis.fetch` — never hit the real API in CI.
- **Stateful tools**: assert both the happy path and at least one failure
  path (bad input, timeout, upstream 5xx).
- **Permissions**: assert that omitting a required permission causes the
  loader to refuse the plugin.

---

## 5. Packaging & distribution

- Publish to npm under your own scope, e.g. `@acme/openhand-plugin-finance`.
- Consumers install with `npm install @acme/openhand-plugin-finance` and
  OpenHand auto-discovers any package whose `keywords` include
  `"openhand-plugin"`.
- Pin compatible core versions in `peerDependencies`:

```json
"peerDependencies": { "@openhand/core": "^0.1.0" }
```

---

## 6. Checklist before opening a PR for a plugin in this repo

- [ ] Unique `id` (prefix with your org if not the core team).
- [ ] Manifest + entry in sync.
- [ ] All tools list only the permissions they actually use.
- [ ] Tests cover happy path + at least one error path.
- [ ] README documents required env vars.
- [ ] No secrets committed; add any new env vars to `.env.example`.
