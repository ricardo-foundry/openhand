/**
 * Micro-benchmark: `PluginLoader.loadAll` over N plugin directories.
 *
 * We stand up 100 fake plugin directories on a tmpdir, point the loader at
 * them with `require` stubbed, and measure the wallclock for a full scan.
 *
 * Rationale: the loader walks the dir, reads a JSON file, runs the cache
 * evict + require. On a fresh cold startup that's the first thing the CLI
 * does, so any quadratic surprise would be visible to users as "slow to
 * start".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { PluginLoader } from '../packages/core/src/plugin-loader';

async function seedPlugins(dir: string, n: number): Promise<void> {
  await Promise.all(
    Array.from({ length: n }, async (_, i) => {
      const pluginDir = path.join(dir, `p${i}`);
      await fs.mkdir(pluginDir, { recursive: true });
      await fs.writeFile(
        path.join(pluginDir, 'package.json'),
        JSON.stringify({
          name: `p${i}`,
          version: '0.0.1',
          openhand: { id: `p${i}`, version: '0.0.1', entry: './index.js' },
        }),
        'utf-8',
      );
    }),
  );
}

test('PluginLoader.loadAll with 100 plugins completes under 500ms', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-bench-plugins-'));
  try {
    const N = 100;
    await seedPlugins(dir, N);

    const loader = new PluginLoader({
      pluginsDir: dir,
      require: () => ({ tools: [] }),
    });

    // Warm-up.
    await loader.loadAll();

    const start = performance.now();
    const loaded = await loader.loadAll();
    const elapsedMs = performance.now() - start;

    // eslint-disable-next-line no-console
    console.log(`    loadAll(${N}): ${elapsedMs.toFixed(2)}ms (${(elapsedMs / N).toFixed(3)}ms/plugin)`);

    assert.equal(loaded.length, N);
    // Very conservative ceiling — on M1 this runs in ~2ms.
    assert.ok(elapsedMs < 500, `loadAll took ${elapsedMs}ms (expected < 500ms)`);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('PluginLoader.loadAll scales roughly linearly from 10 -> 100', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-bench-plugins-'));
  const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'oh-bench-plugins-'));
  try {
    await seedPlugins(dir, 10);
    await seedPlugins(dir2, 100);

    const l1 = new PluginLoader({ pluginsDir: dir, require: () => ({ tools: [] }) });
    const l2 = new PluginLoader({ pluginsDir: dir2, require: () => ({ tools: [] }) });

    await l1.loadAll();
    await l2.loadAll();

    const t10 = await time(() => l1.loadAll());
    const t100 = await time(() => l2.loadAll());

    // eslint-disable-next-line no-console
    console.log(`    10 plugins: ${t10.toFixed(2)}ms, 100 plugins: ${t100.toFixed(2)}ms, ratio ${(t100 / Math.max(t10, 0.1)).toFixed(1)}x`);

    // Guardrail: ratio should NOT be obviously quadratic (>50x for 10x input).
    // We allow slack for small-number noise.
    assert.ok(t100 / Math.max(t10, 0.5) < 50, 'loadAll appears superlinear');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    await fs.rm(dir2, { recursive: true, force: true });
  }
});

async function time<T>(fn: () => Promise<T>): Promise<number> {
  const s = performance.now();
  await fn();
  return performance.now() - s;
}
