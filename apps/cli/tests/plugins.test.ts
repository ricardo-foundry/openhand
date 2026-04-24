import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runPluginsCommand,
  pluginsHelpText,
  renderTable,
  defaultPluginsDir,
  type PluginLoaderFacade,
} from '../src/commands/plugins';

function fakePlugin(
  id: string,
  version: string,
  enabled: boolean,
  tools: string[] = [],
  description = '',
): ReturnType<PluginLoaderFacade['listPlugins']>[number] {
  return {
    manifest: { id, version, description, permissions: [] },
    dir: `/fake/${id}`,
    enabled,
    module: { tools: tools.map(n => ({ name: n })) },
  };
}

class FakeLoader implements PluginLoaderFacade {
  public loadAllCalls = 0;
  private plugins: ReturnType<PluginLoaderFacade['listPlugins']>;
  constructor(initial: ReturnType<PluginLoaderFacade['listPlugins']>) {
    this.plugins = initial;
  }
  async loadAll(): Promise<unknown[]> {
    this.loadAllCalls++;
    return this.plugins;
  }
  listPlugins(): ReturnType<PluginLoaderFacade['listPlugins']> {
    return this.plugins;
  }
  enable(id: string): boolean {
    const p = this.plugins.find(p => p.manifest.id === id);
    if (!p || p.enabled) return false;
    p.enabled = true;
    return true;
  }
  disable(id: string): boolean {
    const p = this.plugins.find(p => p.manifest.id === id);
    if (!p || !p.enabled) return false;
    p.enabled = false;
    return true;
  }
  unload(): boolean {
    return true;
  }
}

test('plugins list prints a header plus one row per plugin', async () => {
  let captured = '';
  const loader = new FakeLoader([
    fakePlugin('calculator', '1.0.0', true, ['calc_eval'], 'math'),
    fakePlugin('rss-digest', '1.0.0', false, ['rss_fetch', 'rss_digest']),
  ]);
  const code = await runPluginsCommand(
    { sub: 'list' },
    {
      createLoader: () => loader,
      write: (s) => { captured += s; },
      pluginsDir: '/fake',
    },
  );
  assert.equal(code, 0);
  assert.match(captured, /2 plugin\(s\) in \/fake/);
  assert.match(captured, /calculator/);
  assert.match(captured, /rss-digest/);
  assert.match(captured, /^id\s+version\s+enabled\s+tools\s+description/m);
});

test('plugins list reports empty state gracefully', async () => {
  let captured = '';
  await runPluginsCommand(
    { sub: 'list' },
    {
      createLoader: () => new FakeLoader([]),
      write: s => { captured += s; },
      pluginsDir: '/empty',
    },
  );
  assert.match(captured, /no plugins found in \/empty/);
});

test('plugins enable/disable return appropriate exit codes', async () => {
  const loader = new FakeLoader([fakePlugin('weather', '1.0.0', true)]);
  let captured = '';
  const write = (s: string) => { captured += s; };
  const disable = await runPluginsCommand(
    { sub: 'disable', id: 'weather' },
    { createLoader: () => loader, write, pluginsDir: '/x' },
  );
  assert.equal(disable, 0);
  assert.match(captured, /disabled weather/);

  captured = '';
  const enableAgain = await runPluginsCommand(
    { sub: 'enable', id: 'weather' },
    { createLoader: () => loader, write, pluginsDir: '/x' },
  );
  assert.equal(enableAgain, 0);
  assert.match(captured, /enabled weather/);

  captured = '';
  const enableMissing = await runPluginsCommand(
    { sub: 'enable', id: 'nope' },
    { createLoader: () => loader, write, pluginsDir: '/x' },
  );
  assert.equal(enableMissing, 1);
  assert.match(captured, /no change/);
});

test('plugins enable/disable without id exit with 2 and a hint', async () => {
  let captured = '';
  const code = await runPluginsCommand(
    { sub: 'enable' },
    {
      createLoader: () => new FakeLoader([]),
      write: s => { captured += s; },
      pluginsDir: '/x',
    },
  );
  assert.equal(code, 2);
  assert.match(captured, /requires <id>/);
});

test('plugins reload drives loader.loadAll again', async () => {
  const loader = new FakeLoader([fakePlugin('a', '1.0.0', true)]);
  let captured = '';
  const code = await runPluginsCommand(
    { sub: 'reload' },
    {
      createLoader: () => loader,
      write: s => { captured += s; },
      pluginsDir: '/x',
    },
  );
  assert.equal(code, 0);
  assert.equal(loader.loadAllCalls, 2); // once at entry, once for reload
  assert.match(captured, /reloaded: 1 plugin\(s\)/);
});

test('renderTable aligns columns deterministically', () => {
  const out = renderTable([
    fakePlugin('a', '1.0.0', true, ['t1']),
    fakePlugin('longer-id', '12.34.56', false, ['t1', 't2'], 'desc'),
  ]);
  const lines = out.trimEnd().split('\n');
  assert.equal(lines.length, 4); // header + divider + 2 rows
  assert.ok(lines[0].startsWith('id'));
  assert.ok(lines[1].includes('-'));
  assert.match(lines[2] ?? '', /^a\s+/);
});

test('pluginsHelpText and defaultPluginsDir are exported and shaped right', () => {
  assert.match(pluginsHelpText(), /Usage: openhand plugins/);
  const d = defaultPluginsDir();
  assert.ok(d.endsWith('plugins'));
});
