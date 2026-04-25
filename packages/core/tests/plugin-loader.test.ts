import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PluginLoader, pluginToolsToMap } from '../src/plugin-loader';

function makePluginDir(
  root: string,
  name: string,
  manifest: Record<string, any>,
  entryBody: string,
): string {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify(
      { name: `@test/${name}`, version: '1.0.0', main: './index.js', openhand: manifest },
      null,
      2,
    ),
  );
  fs.writeFileSync(path.join(dir, 'index.js'), entryBody);
  return dir;
}

async function scratchDir(): Promise<string> {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'oh-plugins-'));
}

test('loadAll discovers plugins and exposes manifest + tools', async () => {
  const root = await scratchDir();
  makePluginDir(
    root,
    'greeter',
    { id: 'greeter', version: '1.0.0', entry: './index.js' },
    `module.exports = {
       name: 'greeter',
       tools: [{ name: 'hello', description: 'say hi', execute: async () => 'hi' }],
     };`,
  );

  const loader = new PluginLoader({ pluginsDir: root });
  const loaded = await loader.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]!.manifest.id, 'greeter');
  assert.equal(loader.listTools().length, 1);
  assert.equal(loader.listTools()[0]!.name, 'hello');
});

test('loadAll skips directories without an openhand manifest', async () => {
  const root = await scratchDir();
  const noMfDir = path.join(root, 'random');
  fs.mkdirSync(noMfDir);
  fs.writeFileSync(path.join(noMfDir, 'package.json'), JSON.stringify({ name: 'x', version: '1' }));
  makePluginDir(
    root,
    'ok',
    { id: 'ok', version: '1.0.0' },
    'module.exports = { tools: [] };',
  );

  const loader = new PluginLoader({ pluginsDir: root });
  const loaded = await loader.loadAll();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0]!.manifest.id, 'ok');
});

test('enable/disable toggles whether tools are listed', async () => {
  const root = await scratchDir();
  makePluginDir(
    root,
    'togl',
    { id: 'togl', version: '1.0.0' },
    `module.exports = {
       tools: [{ name: 't1', execute: async () => 1 }],
     };`,
  );

  const loader = new PluginLoader({ pluginsDir: root });
  await loader.loadAll();
  assert.equal(loader.listTools().length, 1);

  loader.disable('togl');
  assert.equal(loader.listTools().length, 0);
  assert.equal(loader.getPlugin('togl')?.enabled, false);

  loader.enable('togl');
  assert.equal(loader.listTools().length, 1);
});

test('unload removes a plugin entirely', async () => {
  const root = await scratchDir();
  makePluginDir(
    root,
    'victim',
    { id: 'victim', version: '1.0.0' },
    'module.exports = { tools: [] };',
  );
  const loader = new PluginLoader({ pluginsDir: root });
  await loader.loadAll();
  assert.equal(loader.listPlugins().length, 1);
  assert.equal(loader.unload('victim'), true);
  assert.equal(loader.listPlugins().length, 0);
  assert.equal(loader.unload('victim'), false);
});

test('loader emits "loaded" and "error" events', async () => {
  const root = await scratchDir();
  makePluginDir(
    root,
    'okplug',
    { id: 'okplug', version: '1.0.0' },
    'module.exports = { tools: [] };',
  );
  // Broken plugin
  const brokenDir = path.join(root, 'broken');
  fs.mkdirSync(brokenDir);
  fs.writeFileSync(
    path.join(brokenDir, 'package.json'),
    JSON.stringify({ name: 'broken', version: '1', openhand: { id: 'broken', entry: './nope.js' } }),
  );

  const events: string[] = [];
  const loader = new PluginLoader({ pluginsDir: root });
  loader.on('plugin', (e: any) => events.push(e.type));
  await loader.loadAll();
  assert.ok(events.includes('loaded'));
  assert.ok(events.includes('error'));
});

test('pluginToolsToMap adapts plugin tools to core Tool shape', () => {
  const map = pluginToolsToMap([
    {
      name: 't',
      description: 'd',
      parameters: [
        { name: 'x', type: 'number', description: 'x', required: true },
      ],
      sandboxRequired: false,
      execute: async () => 42,
    },
  ]);
  assert.equal(map.size, 1);
  const t = map.get('t')!;
  assert.equal(t.name, 't');
  assert.equal(t.description, 'd');
  assert.equal(t.parameters.length, 1);
  assert.equal(t.parameters[0]!.name, 'x');
  assert.equal(t.sandboxRequired, false);
});

test('watch retries once after 100ms when entry file is not yet on disk', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oh-plugins-watch-'));
  const loader = new PluginLoader({ pluginsDir: root });
  const errors: string[] = [];
  const loadedIds: string[] = [];
  loader.on('plugin', (e: any) => {
    if (e.type === 'error') errors.push(e.id);
    if (e.type === 'loaded') loadedIds.push(e.plugin.manifest.id);
  });
  const stop = loader.watch();

  // Step 1: write only package.json — entry.js is NOT there yet.
  const dir = path.join(root, 'late');
  fs.mkdirSync(dir);
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ name: 'late', version: '1', openhand: { id: 'late', entry: './index.js' } }),
  );

  // Wait past the debounce (100ms) so the first attempt fires + fails.
  await new Promise(r => setTimeout(r, 60));
  // Step 2: drop the entry in BEFORE the retry fires.
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = { tools: [] };');
  // Wait long enough for the 100ms retry to land.
  await new Promise(r => setTimeout(r, 350));

  stop();
  assert.ok(loadedIds.includes('late'), `expected late to load, got ${loadedIds.join(',')}`);
  assert.ok(!errors.includes('late'), `expected no error event, got ${errors.join(',')}`);
});

test('loadFromDir honors injected require so entry is never actually loaded from disk', async () => {
  const root = await scratchDir();
  const dir = path.join(root, 'virt');
  fs.mkdirSync(dir);
  // Put a real package.json on disk so the existence check passes.
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'virt',
      version: '1.0.0',
      main: './entry.js',
      openhand: { id: 'virt', version: '1.0.0', entry: './entry.js' },
    }),
  );
  // Deliberately DO NOT create entry.js — only the injected require should be hit.

  const loader = new PluginLoader({
    pluginsDir: root,
    require: () => ({ tools: [{ name: 'v', execute: async () => 'v' }] }),
  });

  const plugin = loader.loadFromDir(dir);
  assert.ok(plugin);
  assert.equal(plugin!.manifest.id, 'virt');
  assert.equal(plugin!.module.tools?.length, 1);
});

test('dispose clears watcher, plugins, listeners, and fires onDisable', async () => {
  const root = await scratchDir();
  // Plugin records lifecycle calls onto a shared array we can inspect.
  const calls: string[] = [];
  makePluginDir(
    root,
    'dis',
    { id: 'dis', version: '1.0.0' },
    `module.exports = {
       tools: [{ name: 'noop', execute: async () => 0 }],
       onEnable() { (global.__disCalls ||= []).push('enable'); },
       onDisable() { (global.__disCalls ||= []).push('disable'); },
       onUninstall() { (global.__disCalls ||= []).push('uninstall'); },
     };`,
  );
  // Re-route the plugin's lifecycle into our local array via globalThis.
  (globalThis as any).__disCalls = calls;
  const loader = new PluginLoader({ pluginsDir: root });
  await loader.loadAll();
  const stop = loader.watch();
  assert.equal(loader.listPlugins().length, 1);

  let listenerCalls = 0;
  loader.on('plugin', () => { listenerCalls++; });

  loader.dispose();

  assert.equal(loader.listPlugins().length, 0, 'plugins map should be empty after dispose');
  assert.ok(calls.includes('disable'), `onDisable should fire (calls=${calls.join(',')})`);
  assert.ok(calls.includes('uninstall'), `onUninstall should fire (calls=${calls.join(',')})`);
  assert.equal(loader.listenerCount('plugin'), 0, 'listeners should be removed');
  assert.equal(loader.listTools().length, 0);

  // Re-calling dispose is safe (idempotent).
  loader.dispose();

  // Re-calling stop() (returned by watch()) is also safe.
  stop();

  delete (globalThis as any).__disCalls;
  // Tear down listenerCalls var (unused after dispose) silences lint.
  void listenerCalls;
});

test('dispose is safe to call before any loadAll()', async () => {
  const root = await scratchDir();
  const loader = new PluginLoader({ pluginsDir: root });
  // No plugins, no watcher, no listeners — should still not throw.
  assert.doesNotThrow(() => loader.dispose());
});
