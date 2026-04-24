import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import type { Tool } from './types';

/**
 * Plugin manifest, declared inside `package.json` under the `openhand` key.
 *
 * Example:
 * ```json
 * {
 *   "name": "@openhand/plugin-weather",
 *   "openhand": {
 *     "id": "weather",
 *     "version": "1.0.0",
 *     "entry": "./index.js",
 *     "permissions": ["network:http"]
 *   }
 * }
 * ```
 */
export interface PluginManifest {
  /** Unique plugin id. Must be stable across versions. */
  id: string;
  /** Semver. */
  version: string;
  /** Path to the JS entry module, relative to the plugin directory. */
  entry?: string;
  /** Optional human-readable description. */
  description?: string;
  /** Advertised permissions (used by policy; not enforced here). */
  permissions?: string[];
}

export interface LoadedPluginTool {
  name: string;
  description?: string;
  parameters?: unknown;
  permissions?: string[];
  sandboxRequired?: boolean;
  execute: (params: Record<string, any>, context: any) => Promise<any> | any;
}

export interface LoadedPluginModule {
  name?: string;
  version?: string;
  description?: string;
  config?: Record<string, any>;
  tools?: LoadedPluginTool[];
  onInstall?: () => Promise<void> | void;
  onUninstall?: () => Promise<void> | void;
  onEnable?: () => Promise<void> | void;
  onDisable?: () => Promise<void> | void;
}

export interface LoadedPlugin {
  manifest: PluginManifest;
  /** Absolute path to the plugin directory. */
  dir: string;
  /** Resolved entry module. */
  module: LoadedPluginModule;
  enabled: boolean;
}

export interface PluginLoaderOptions {
  /** Absolute path to the plugins directory. */
  pluginsDir: string;
  /** Optional require-equivalent override (used in tests). */
  require?: (id: string) => unknown;
  /** Optional JSON reader override (used in tests). */
  readJson?: (file: string) => unknown;
}

type Listener = (evt: PluginLoaderEvent) => void;

export type PluginLoaderEvent =
  | { type: 'loaded'; plugin: LoadedPlugin }
  | { type: 'unloaded'; id: string }
  | { type: 'enabled'; id: string }
  | { type: 'disabled'; id: string }
  | { type: 'error'; id?: string; error: Error };

/**
 * Filesystem plugin discovery + hot reload.
 *
 * Conventions:
 *
 *   - Every plugin is a directory directly under `pluginsDir`.
 *   - Each directory has a `package.json` with an `openhand` field (the
 *     manifest). If missing, the directory is skipped (but NOT treated as
 *     an error — keeps the loader tolerant of `node_modules` noise in dev).
 *   - The `entry` field points at the JS module that actually exports the
 *     plugin. Defaults to `./index.js`.
 *
 * The loader is intentionally not opinionated about *how* tools are
 * registered with core — consumers call `listPlugins()` / `getPlugin()` and
 * feed the tools into their own tool map. That keeps this loader testable
 * in isolation.
 */
export class PluginLoader extends EventEmitter {
  private readonly pluginsDir: string;
  private readonly plugins: Map<string, LoadedPlugin> = new Map();
  private readonly requireImpl: (id: string) => unknown;
  private readonly readJsonImpl: (file: string) => unknown;
  private watcher: fs.FSWatcher | undefined;

  constructor(opts: PluginLoaderOptions) {
    super();
    this.pluginsDir = opts.pluginsDir;
    this.requireImpl = opts.require ?? ((id: string) => defaultRequire(id));
    this.readJsonImpl =
      opts.readJson ??
      ((file: string) => JSON.parse(fs.readFileSync(file, 'utf-8')));
  }

  /** Scan the plugins directory and load every valid plugin found. */
  async loadAll(): Promise<LoadedPlugin[]> {
    if (!fs.existsSync(this.pluginsDir)) return [];
    const entries = fs.readdirSync(this.pluginsDir, { withFileTypes: true });
    const loaded: LoadedPlugin[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const dir = path.join(this.pluginsDir, entry.name);
      try {
        const plugin = this.loadFromDir(dir);
        if (plugin) loaded.push(plugin);
      } catch (error) {
        this.emitSafe({
          type: 'error',
          id: entry.name,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    }
    return loaded;
  }

  /** Load a single plugin directory. Returns null if no manifest is found. */
  loadFromDir(dir: string): LoadedPlugin | null {
    const pkgPath = path.join(dir, 'package.json');
    if (!fs.existsSync(pkgPath)) return null;

    const pkg = this.readJsonImpl(pkgPath) as any;
    if (!pkg || typeof pkg !== 'object' || !pkg.openhand) return null;

    const manifest = normalizeManifest(pkg.openhand, pkg);
    const entryPath = path.resolve(dir, manifest.entry ?? './index.js');

    // Evict cached module so hot-reload picks up edits.
    this.evictRequireCache(entryPath);
    const mod = this.requireImpl(entryPath) as LoadedPluginModule;
    if (!mod || typeof mod !== 'object') {
      throw new Error(`plugin ${manifest.id}: entry did not export an object`);
    }

    const plugin: LoadedPlugin = {
      manifest,
      dir,
      module: mod,
      enabled: true,
    };
    this.plugins.set(manifest.id, plugin);
    this.emitSafe({ type: 'loaded', plugin });
    return plugin;
  }

  /** List every currently-loaded plugin. */
  listPlugins(): LoadedPlugin[] {
    return Array.from(this.plugins.values());
  }

  getPlugin(id: string): LoadedPlugin | undefined {
    return this.plugins.get(id);
  }

  /** Return only the enabled plugins' tools, flattened. */
  listTools(): LoadedPluginTool[] {
    const out: LoadedPluginTool[] = [];
    for (const p of this.plugins.values()) {
      if (!p.enabled) continue;
      for (const t of p.module.tools ?? []) out.push(t);
    }
    return out;
  }

  enable(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p || p.enabled) return false;
    p.enabled = true;
    fireLifecycle(p.module.onEnable);
    this.emitSafe({ type: 'enabled', id });
    return true;
  }

  disable(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p || !p.enabled) return false;
    p.enabled = false;
    fireLifecycle(p.module.onDisable);
    this.emitSafe({ type: 'disabled', id });
    return true;
  }

  unload(id: string): boolean {
    const p = this.plugins.get(id);
    if (!p) return false;
    fireLifecycle(p.module.onUninstall);
    const entryPath = path.resolve(p.dir, p.manifest.entry ?? './index.js');
    this.evictRequireCache(entryPath);
    this.plugins.delete(id);
    this.emitSafe({ type: 'unloaded', id });
    return true;
  }

  /**
   * Watch `pluginsDir` for changes and reload plugins whose files change.
   * Uses `fs.watch` (no extra dependency). Returns a stop function.
   */
  watch(): () => void {
    if (this.watcher) return () => this.stopWatch();
    if (!fs.existsSync(this.pluginsDir)) return () => {};

    let debounce: NodeJS.Timeout | null = null;
    const pending = new Set<string>();
    // Track in-progress retries so we don't pile up on noisy fs.watch events.
    const retrying = new Set<string>();

    const tryLoad = (dirname: string, attempt: number): void => {
      const dir = path.join(this.pluginsDir, dirname);
      if (!fs.existsSync(dir)) {
        // deleted
        const byDir = Array.from(this.plugins.values()).find(p => p.dir === dir);
        if (byDir) this.unload(byDir.manifest.id);
        return;
      }
      try {
        this.loadFromDir(dir);
      } catch (error) {
        // editors / `npm install` / git checkout often emit watch events
        // before package.json or the entry file is fully on disk. Give it
        // one 100ms retry before surfacing as an error.
        if (attempt === 0 && !retrying.has(dirname)) {
          retrying.add(dirname);
          const t = setTimeout(() => {
            retrying.delete(dirname);
            tryLoad(dirname, 1);
          }, 100);
          t.unref?.();
          return;
        }
        this.emitSafe({
          type: 'error',
          id: dirname,
          error: error instanceof Error ? error : new Error(String(error)),
        });
      }
    };

    const flush = (): void => {
      const ids = Array.from(pending);
      pending.clear();
      debounce = null;
      for (const dirname of ids) {
        tryLoad(dirname, 0);
      }
    };

    this.watcher = fs.watch(this.pluginsDir, { recursive: true }, (_evt, filename) => {
      if (!filename) return;
      const top = String(filename).split(path.sep)[0];
      if (!top) return;
      pending.add(top);
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(flush, 100);
    });
    return () => this.stopWatch();
  }

  stopWatch(): void {
    if (!this.watcher) return;
    try {
      this.watcher.close();
    } catch {
      /* already closed */
    }
    this.watcher = undefined;
  }

  // `EventEmitter.on` is already what we want; this override just types it.
  override on(event: 'plugin', listener: Listener): this {
    return super.on(event, listener);
  }

  private emitSafe(evt: PluginLoaderEvent): void {
    this.emit('plugin', evt);
    // Emit the specific event only if someone is listening, to avoid
    // EventEmitter's default behaviour of crashing on unhandled 'error'.
    if (this.listenerCount(evt.type) > 0) {
      this.emit(evt.type, evt);
    }
  }

  private evictRequireCache(absPath: string): void {
    try {
      // node's CJS require cache
      const req = (globalThis as any).require;
      if (req && req.cache) delete req.cache[absPath];
    } catch {
      /* ignore */
    }
  }
}

function defaultRequire(id: string): unknown {
  // Use `eval` to defeat bundlers that would try to resolve this at build time.
  // eslint-disable-next-line no-eval
  const req = eval('require') as NodeJS.Require;
  return req(id);
}

function normalizeManifest(raw: any, pkg: any): PluginManifest {
  const id = raw.id ?? pkg.name;
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error('plugin manifest: `id` is required');
  }
  return {
    id,
    version: String(raw.version ?? pkg.version ?? '0.0.0'),
    entry: typeof raw.entry === 'string' ? raw.entry : pkg.main,
    description: typeof raw.description === 'string' ? raw.description : pkg.description,
    permissions: Array.isArray(raw.permissions) ? raw.permissions.slice() : [],
  };
}

function fireLifecycle(fn: (() => void | Promise<void>) | undefined): void {
  if (!fn) return;
  try {
    const out = fn();
    if (out && typeof (out as Promise<void>).then === 'function') {
      (out as Promise<void>).catch(() => undefined);
    }
  } catch {
    /* swallow: lifecycle hooks are best-effort */
  }
}

/** Convenience: wrap a loader's tools into a `Map<string, Tool>` core can consume. */
export function pluginToolsToMap(tools: LoadedPluginTool[]): Map<string, Tool> {
  const map = new Map<string, Tool>();
  for (const t of tools) {
    const adapted: Tool = {
      name: t.name,
      description: t.description ?? '',
      parameters: normalizeParameters(t.parameters),
      permissions: t.permissions ?? [],
      sandboxRequired: t.sandboxRequired ?? false,
      execute: async (params, context) => t.execute(params, context),
    };
    map.set(adapted.name, adapted);
  }
  return map;
}

function normalizeParameters(raw: unknown): Tool['parameters'] {
  if (!Array.isArray(raw)) return [];
  const out: Tool['parameters'] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as any;
    if (typeof e.name !== 'string') continue;
    out.push({
      name: e.name,
      type: (e.type ?? 'string') as Tool['parameters'][number]['type'],
      description: typeof e.description === 'string' ? e.description : '',
      required: Boolean(e.required),
      default: e.default,
    });
  }
  return out;
}
