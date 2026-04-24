/**
 * End-to-end: PluginLoader.watch picks up a new plugin dropped into the
 * plugins directory *after* watch() starts, loads it, and emits 'loaded'.
 *
 * Uses the injected `require` + `readJson` hooks to avoid any real module
 * resolution (so the test is hermetic and works on any fs that supports
 * `fs.watch`, macOS/Linux/Windows alike — though Windows watch semantics
 * are known to flake, hence the generous 10s timeout).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PluginLoader, type LoadedPluginModule } from '../../packages/core/src/plugin-loader';

test('PluginLoader.watch detects new plugin dropped into pluginsDir', { timeout: 10000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-e2e-plugin-'));

  // In-memory module registry so we don't actually require off disk.
  const modules = new Map<string, LoadedPluginModule>();
  const loader = new PluginLoader({
    pluginsDir: dir,
    require: (id: string) => {
      const mod = modules.get(id);
      if (!mod) throw new Error(`module not yet available: ${id}`);
      return mod;
    },
  });

  const loaded: string[] = [];
  loader.on('plugin', (evt: any) => {
    if (evt.type === 'loaded') loaded.push(evt.plugin.manifest.id);
  });

  const stop = loader.watch();
  try {
    // Drop a new plugin dir + package.json + stub entry. The entry path
    // must exist for the require hook to look it up — we pre-seed the
    // in-memory registry below.
    const pluginDir = path.join(dir, 'e2e-hot');
    await fs.mkdir(pluginDir, { recursive: true });
    const entryAbs = path.resolve(pluginDir, './index.js');
    modules.set(entryAbs, { name: 'e2e-hot', tools: [] });

    // Write the entry file first so that (even with retry) the loader
    // finds both the entry file and the package.json consistently.
    await fs.writeFile(entryAbs, 'module.exports = {};');
    await fs.writeFile(
      path.join(pluginDir, 'package.json'),
      JSON.stringify({
        name: 'e2e-hot',
        version: '0.0.1',
        openhand: { id: 'e2e-hot', version: '0.0.1', entry: './index.js' },
      }),
      'utf-8',
    );

    // Wait for watch() to fire + debounce (100ms) + retry-budget (100ms).
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (loaded.includes('e2e-hot')) break;
      await new Promise(r => setTimeout(r, 80));
    }
    assert.ok(
      loaded.includes('e2e-hot'),
      `expected 'e2e-hot' to be hot-loaded; got: ${JSON.stringify(loaded)}`,
    );

    const plugin = loader.getPlugin('e2e-hot');
    assert.ok(plugin, 'plugin is registered');
    assert.equal(plugin?.manifest.id, 'e2e-hot');
  } finally {
    stop();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
