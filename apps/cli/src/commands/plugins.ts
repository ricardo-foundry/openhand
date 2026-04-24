/**
 * `openhand plugins <sub>` — thin wrapper around `PluginLoader`.
 *
 * Sub-commands:
 *   list              Print a table of every discovered plugin.
 *   enable <id>       Re-enable a plugin that was disabled.
 *   disable <id>      Disable a plugin without unloading it.
 *   reload            Rescan the plugins directory from disk.
 *
 * The command is factored so `runPluginsCommand()` takes all of its
 * filesystem + stdout dependencies as injectable parameters. That keeps
 * the unit tests hermetic and fast — no real `fs.watch`, no real stdout.
 */
import * as path from 'path';
import * as os from 'os';

/** Minimal shape we need out of the plugin loader — keeps this file decoupled. */
export interface PluginLoaderFacade {
  loadAll(): Promise<unknown[]> | unknown[];
  listPlugins(): Array<{
    manifest: { id: string; version: string; description?: string; permissions?: string[] };
    dir: string;
    enabled: boolean;
    module: { tools?: Array<{ name: string }> };
  }>;
  enable(id: string): boolean;
  disable(id: string): boolean;
  unload(id: string): boolean;
}

export interface PluginsCommandDeps {
  /** Build the loader. Injecting this keeps tests away from the real filesystem. */
  createLoader: (pluginsDir: string) => PluginLoaderFacade;
  /** Stdout sink. Defaults to `process.stdout.write`. */
  write?: (s: string) => void;
  /** Override the plugins dir. Defaults to `$OPENHAND_HOME/plugins` or `~/.openhand/plugins`. */
  pluginsDir?: string;
}

export type PluginsSubcommand = 'list' | 'enable' | 'disable' | 'reload';

export interface PluginsCommandArgs {
  sub: PluginsSubcommand;
  id?: string;
}

const HELP = [
  'Usage: openhand plugins <sub> [id]',
  '',
  '  list              List every discovered plugin and whether it is enabled.',
  '  enable <id>       Re-enable a previously-disabled plugin.',
  '  disable <id>      Disable a plugin without removing it from disk.',
  '  reload            Rescan the plugins directory (picks up new plugins).',
].join('\n');

export async function runPluginsCommand(
  args: PluginsCommandArgs,
  deps: PluginsCommandDeps,
): Promise<number> {
  const out = deps.write ?? ((s: string) => void process.stdout.write(s));
  const dir = deps.pluginsDir ?? defaultPluginsDir();
  const loader = deps.createLoader(dir);
  await loader.loadAll();

  switch (args.sub) {
    case 'list': {
      const rows = loader.listPlugins();
      if (rows.length === 0) {
        out(`no plugins found in ${dir}\n`);
        return 0;
      }
      out(`${rows.length} plugin(s) in ${dir}\n`);
      out(renderTable(rows));
      return 0;
    }

    case 'enable': {
      if (!args.id) {
        out('error: plugins enable requires <id>\n');
        return 2;
      }
      const ok = loader.enable(args.id);
      out(ok ? `enabled ${args.id}\n` : `no change: ${args.id} was already enabled or not found\n`);
      return ok ? 0 : 1;
    }

    case 'disable': {
      if (!args.id) {
        out('error: plugins disable requires <id>\n');
        return 2;
      }
      const ok = loader.disable(args.id);
      out(ok ? `disabled ${args.id}\n` : `no change: ${args.id} was already disabled or not found\n`);
      return ok ? 0 : 1;
    }

    case 'reload': {
      // loadAll is already idempotent — it re-reads every dir and re-exports.
      await loader.loadAll();
      const rows = loader.listPlugins();
      out(`reloaded: ${rows.length} plugin(s)\n`);
      return 0;
    }

    default: {
      out(HELP + '\n');
      return 2;
    }
  }
}

export function pluginsHelpText(): string {
  return HELP;
}

export function renderTable(
  rows: ReadonlyArray<{
    manifest: { id: string; version: string; description?: string };
    enabled: boolean;
    module: { tools?: Array<{ name: string }> };
  }>,
): string {
  const header = ['id', 'version', 'enabled', 'tools', 'description'];
  const data = rows.map(r => [
    r.manifest.id,
    r.manifest.version,
    r.enabled ? 'yes' : 'no',
    String((r.module.tools ?? []).length),
    r.manifest.description ?? '',
  ]);
  const widths = header.map((h, i) =>
    Math.max(h.length, ...data.map(d => (d[i] ?? '').length)),
  );
  const fmt = (cells: string[]): string =>
    cells.map((c, i) => c.padEnd(widths[i] ?? c.length)).join('  ');
  const lines: string[] = [];
  lines.push(fmt(header));
  lines.push(fmt(widths.map(w => '-'.repeat(w))));
  for (const row of data) lines.push(fmt(row));
  return lines.join('\n') + '\n';
}

export function defaultPluginsDir(): string {
  const home = process.env.OPENHAND_HOME ?? path.join(os.homedir(), '.openhand');
  return path.join(home, 'plugins');
}
