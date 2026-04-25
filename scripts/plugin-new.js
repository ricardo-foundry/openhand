#!/usr/bin/env node
/**
 * `npm run plugin:new <name>` — scaffold a new plugin under plugins/<name>/.
 *
 * Generates:
 *   plugins/<name>/package.json     — manifest with the openhand block
 *   plugins/<name>/index.js         — minimal CJS entry exporting one tool
 *   plugins/<name>/README.md        — short README with run/test instructions
 *   plugins/<name>/tests/<name>.test.js — node:test smoke test
 *
 * Idempotent enough to be safe-ish: refuses to overwrite an existing
 * directory unless `--force` is passed. Names must match `[a-z0-9-]+`.
 *
 * Why a hand-rolled script and not yo / plop / hygen? Because we explicitly
 * promise "no runtime deps" — plop would pull in 200kb of templating glue
 * for what fits on one screen.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLUGINS = path.join(ROOT, 'plugins');

function bail(msg, code = 1) {
  process.stderr.write(`plugin:new: ${msg}\n`);
  process.exit(code);
}

function parseArgs(argv) {
  const out = { name: '', force: false };
  for (const a of argv) {
    if (a === '--force' || a === '-f') out.force = true;
    else if (a.startsWith('-')) bail(`unknown flag: ${a}`);
    else if (!out.name) out.name = a;
    else bail(`unexpected positional arg: ${a}`);
  }
  if (!out.name) {
    bail('usage: npm run plugin:new -- <name> [--force]');
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(out.name)) {
    bail(`invalid name "${out.name}". Use lowercase letters, digits, and dashes.`);
  }
  return out;
}

function write(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  process.stdout.write(`  + ${path.relative(ROOT, file)}\n`);
}

function packageJson(name) {
  return JSON.stringify(
    {
      name: `@openhand/plugin-${name}`,
      version: '0.1.0',
      description: `Scaffolded ${name} plugin for OpenHand.`,
      main: 'index.js',
      keywords: ['openhand', 'plugin', name],
      license: 'MIT',
      scripts: { test: 'node --test tests/*.test.js' },
      openhand: {
        id: name,
        version: '0.1.0',
        entry: './index.js',
        description: `${name} plugin (scaffolded by scripts/plugin-new.js).`,
        permissions: [],
      },
    },
    null,
    2,
  ) + '\n';
}

function indexJs(name) {
  return `// @openhand/plugin-${name}
//
// Scaffolded by scripts/plugin-new.js. Edit freely.
//
// The agent calls tools through their \`execute\` function. Add as many
// tools as you want; each one needs at minimum a \`name\` and an
// \`execute\` callback. \`parameters\` is purely for the LLM tool-calling
// schema — runtime validation is your responsibility.

'use strict';

module.exports = {
  name: '${name}',
  version: '0.1.0',
  description: 'Scaffolded ${name} plugin.',

  tools: [
    {
      name: '${name.replace(/-/g, '_')}_echo',
      description: 'Returns whatever message the caller passed.',
      parameters: [
        { name: 'message', type: 'string', description: 'Anything', required: true },
      ],
      permissions: [],
      sandboxRequired: false,
      async execute(params) {
        const raw = params && params.message;
        if (typeof raw !== 'string' || raw.length === 0) {
          throw new Error('message is required');
        }
        return { plugin: '${name}', echoed: raw, at: new Date().toISOString() };
      },
    },
  ],

  async onEnable() { /* called once when the loader picks this plugin up */ },
  async onDisable() { /* called once when the plugin is disabled */ },
};
`;
}

function readme(name) {
  const tool = `${name.replace(/-/g, '_')}_echo`;
  return `# @openhand/plugin-${name}

Scaffolded by \`scripts/plugin-new.js\`. Replace this README with a real one.

## What it does

Exposes a single tool, \`${tool}\`, that echoes whatever message it gets.

## Tests

\`\`\`bash
npm test --workspace plugins/${name}
# or, from the root:
npm run test:plugins
\`\`\`

## Next steps

1. Update \`package.json\`'s \`openhand.permissions\` array if you need
   \`network:http\`, \`fs:read:...\`, \`llm:chat\`, etc.
2. Add real tools to \`index.js\`. Look at \`plugins/code-reviewer\` or
   \`plugins/web-scraper\` for richer examples (LLM, fetch, SSRF guards).
3. Add tests under \`tests/\`. See [Cookbook 02](../../cookbook/02-writing-a-plugin.md).
`;
}

function testJs(name) {
  const tool = `${name.replace(/-/g, '_')}_echo`;
  return `'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const plugin = require('../index.js');

test('plugin manifest exposes ${tool}', () => {
  const names = plugin.tools.map(t => t.name);
  assert.ok(names.includes('${tool}'), \`expected ${tool} in \${names.join(',')}\`);
});

test('${tool} returns the echoed message', async () => {
  const tool = plugin.tools.find(t => t.name === '${tool}');
  const out = await tool.execute({ message: 'ping' }, {});
  assert.equal(out.plugin, '${name}');
  assert.equal(out.echoed, 'ping');
  assert.match(out.at, /^\\d{4}-\\d{2}-\\d{2}T/);
});

test('${tool} requires a message', async () => {
  const tool = plugin.tools.find(t => t.name === '${tool}');
  await assert.rejects(() => tool.execute({}, {}), /message is required/);
});
`;
}

function main() {
  // npm run forwards args after `--`; strip node + script.
  const args = parseArgs(process.argv.slice(2));
  const dir = path.join(PLUGINS, args.name);
  if (fs.existsSync(dir) && !args.force) {
    bail(`plugin "${args.name}" already exists at plugins/${args.name}/. Use --force to overwrite.`);
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });

  process.stdout.write(`Scaffolding plugins/${args.name}/\n`);
  write(path.join(dir, 'package.json'), packageJson(args.name));
  write(path.join(dir, 'index.js'), indexJs(args.name));
  write(path.join(dir, 'README.md'), readme(args.name));
  write(path.join(dir, 'tests', `${args.name}.test.js`), testJs(args.name));

  process.stdout.write(`\nNext: npm test --workspace plugins/${args.name}\n`);
}

main();
