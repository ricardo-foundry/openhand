/**
 * Chaos: deliberately broken plugins must NOT take down the loader, and
 * must NOT contaminate the rest of the plugin set.
 *
 * For each break we cover:
 *   - missing entry file
 *   - corrupt manifest (truncated JSON)
 *   - manifest with no `id`
 *   - entry that throws on require
 *   - entry that exports a primitive (not an object)
 *
 * The loader's `loadAll()` is documented as best-effort: it must emit
 * `error` events for the broken ones but still return the working ones.
 *
 * Bug found while writing this round: nothing yet — the loader's
 * try/catch around `loadFromDir` already isolates the bad apple. But the
 * absence of this test means we'd silently regress later.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PluginLoader, type PluginLoaderEvent } from '../../packages/core/src/plugin-loader';

interface PluginSeed {
  name: string;
  /** When omitted, no package.json is written. */
  pkg?: string;
  /** When omitted, no entry file is written. */
  entry?: string;
  entryName?: string; // defaults to index.js
}

async function seedDir(plugins: PluginSeed[]): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-chaos-plugins-'));
  for (const p of plugins) {
    const pluginDir = path.join(dir, p.name);
    await fs.mkdir(pluginDir, { recursive: true });
    if (p.pkg !== undefined) {
      await fs.writeFile(path.join(pluginDir, 'package.json'), p.pkg, 'utf-8');
    }
    if (p.entry !== undefined) {
      await fs.writeFile(path.join(pluginDir, p.entryName ?? 'index.js'), p.entry, 'utf-8');
    }
  }
  return { dir, cleanup: () => fs.rm(dir, { recursive: true, force: true }) };
}

const validPkg = (id: string): string =>
  JSON.stringify({
    name: id,
    version: '1.0.0',
    openhand: { id, version: '1.0.0', entry: './index.js' },
  });

const validEntry = `module.exports = { tools: [{ name: 't', execute: () => 1 }] };`;

/**
 * Subscribe to every event by listening on the 'plugin' channel. The loader's
 * typed `on()` only exposes the 'plugin' name, but `emitSafe` mirrors every
 * event onto it — so this is the supported way to read errors out.
 */
function collectErrors(loader: PluginLoader): Error[] {
  const errors: Error[] = [];
  loader.on('plugin', (evt: PluginLoaderEvent) => {
    if (evt.type === 'error') errors.push(evt.error);
  });
  return errors;
}

test('chaos/plugin: missing entry file emits error but does not throw from loadAll', async () => {
  const { dir, cleanup } = await seedDir([
    { name: 'good', pkg: validPkg('good'), entry: validEntry },
    { name: 'no-entry', pkg: validPkg('no-entry') }, // no entry file
  ]);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    const errors = collectErrors(loader);
    const loaded = await loader.loadAll();
    assert.equal(loaded.length, 1, 'only "good" should load');
    assert.equal(loaded[0]?.manifest.id, 'good');
    assert.ok(errors.length >= 1, 'broken plugin must emit error');
    loader.dispose();
  } finally {
    await cleanup();
  }
});

test('chaos/plugin: truncated package.json is isolated', async () => {
  const { dir, cleanup } = await seedDir([
    { name: 'good', pkg: validPkg('good'), entry: validEntry },
    { name: 'bad-json', pkg: '{"name":"bad-json","openhand":{', entry: validEntry },
  ]);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    const errors = collectErrors(loader);
    const loaded = await loader.loadAll();
    assert.equal(loaded.length, 1);
    assert.ok(errors.length >= 1);
    assert.match(errors[0]!.message, /JSON|Unexpected|parse/i);
    loader.dispose();
  } finally {
    await cleanup();
  }
});

test('chaos/plugin: missing manifest id is rejected with a clear error', async () => {
  // The loader treats `pkg.name` as a fallback id, so to actually trigger
  // the "no id" path we need both `openhand.id` and `pkg.name` missing.
  const { dir, cleanup } = await seedDir([
    {
      name: 'no-id',
      pkg: JSON.stringify({ openhand: { version: '1.0.0', entry: './index.js' } }),
      entry: validEntry,
    },
    { name: 'good', pkg: validPkg('good'), entry: validEntry },
  ]);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    const errors = collectErrors(loader);
    const loaded = await loader.loadAll();
    assert.equal(loaded.length, 1);
    assert.ok(errors.some(e => /id.*required/i.test(e.message)));
    loader.dispose();
  } finally {
    await cleanup();
  }
});

test('chaos/plugin: entry that throws at require time is isolated', async () => {
  const { dir, cleanup } = await seedDir([
    { name: 'good', pkg: validPkg('good'), entry: validEntry },
    { name: 'throws', pkg: validPkg('throws'), entry: `throw new Error('boom at require');` },
  ]);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    const errors = collectErrors(loader);
    const loaded = await loader.loadAll();
    assert.equal(loaded.length, 1);
    assert.equal(loaded[0]?.manifest.id, 'good');
    assert.ok(errors.some(e => /boom at require/.test(e.message)));
    loader.dispose();
  } finally {
    await cleanup();
  }
});

test('chaos/plugin: entry exporting a primitive is rejected', async () => {
  const { dir, cleanup } = await seedDir([
    { name: 'good', pkg: validPkg('good'), entry: validEntry },
    { name: 'string-entry', pkg: validPkg('string-entry'), entry: `module.exports = 42;` },
  ]);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    const errors = collectErrors(loader);
    const loaded = await loader.loadAll();
    assert.equal(loaded.length, 1);
    assert.ok(errors.some(e => /entry did not export an object/.test(e.message)));
    loader.dispose();
  } finally {
    await cleanup();
  }
});

test('chaos/plugin: many broken plugins do not prevent good ones from loading', async () => {
  const seeds: PluginSeed[] = [];
  // 5 broken with truncated JSON
  for (let i = 0; i < 5; i++) {
    seeds.push({ name: `bad${i}`, pkg: '{ this is not json', entry: validEntry });
  }
  // 5 good
  for (let i = 0; i < 5; i++) {
    seeds.push({ name: `good${i}`, pkg: validPkg(`good${i}`), entry: validEntry });
  }
  const { dir, cleanup } = await seedDir(seeds);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    const errors = collectErrors(loader);
    const loaded = await loader.loadAll();
    assert.equal(loaded.length, 5, 'every good plugin must still load');
    assert.ok(errors.length >= 5, 'every broken one must emit');
    loader.dispose();
  } finally {
    await cleanup();
  }
});

test('chaos/plugin: dispose() releases watchers + listeners with broken set', async () => {
  // Even when half the plugins are broken, dispose must not throw and must
  // leave no event listeners behind. This is the leak guard for the watch
  // path (see plugin-loader.ts dispose() doc comment).
  const { dir, cleanup } = await seedDir([
    { name: 'good', pkg: validPkg('good'), entry: validEntry },
    { name: 'broken', pkg: '{', entry: '' },
  ]);
  try {
    const loader = new PluginLoader({ pluginsDir: dir });
    loader.on('plugin', () => undefined);
    await loader.loadAll();
    loader.watch(); // ensure watcher path is exercised
    loader.dispose();
    assert.equal(loader.listenerCount('plugin'), 0, 'dispose must drop all listeners');
    assert.equal(loader.listPlugins().length, 0, 'dispose must clear plugin map');
  } finally {
    await cleanup();
  }
});
