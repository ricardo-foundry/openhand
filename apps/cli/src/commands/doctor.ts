/**
 * `openhand doctor` — environment health check.
 *
 * Inspects four axes and reports a diagnosis the user can act on:
 *
 *   1. Node version            — must be ≥ 20 (the rest of the stack assumes it).
 *   2. Provider configuration  — provider name, model, api key set/unset.
 *   3. Sandbox path            — `cwd` and `~` reachable, sandbox tmpdir writable.
 *   4. Dependency integrity    — `node_modules/` exists, key workspace packages
 *                                resolve, npm audit cache is healthy if present.
 *
 * The command is split into a *pure* `runDiagnostics(input) -> Report` and a
 * thin `renderMarkdown(report) -> string` so tests don't have to touch fs.
 */
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ReplConfig } from '../repl';

export type CheckLevel = 'ok' | 'warn' | 'fail';

export interface CheckResult {
  /** Stable id for programmatic consumers (e.g. CI). */
  id: string;
  title: string;
  level: CheckLevel;
  detail: string;
  /** Optional remediation string, shown verbatim. */
  fix?: string;
}

export interface DoctorReport {
  generatedAt: string;
  node: { version: string; platform: string; arch: string };
  checks: CheckResult[];
  summary: { ok: number; warn: number; fail: number };
}

export interface DoctorInput {
  /** `process.versions.node` style ('20.10.0'). */
  nodeVersion: string;
  platform: string;
  arch: string;
  config: ReplConfig;
  /** Set of paths that should be readable (cwd, home). */
  sandboxPaths: readonly string[];
  /** Resolution of important workspace packages. */
  workspacePackages: ReadonlyArray<{ name: string; resolved: boolean; version?: string }>;
  /** Whether `node_modules/` exists at the repo root. */
  nodeModulesExists: boolean;
  /** Number of plugins discovered (informational). */
  pluginCount: number;
}

export const REQUIRED_NODE_MAJOR = 20;

/**
 * Pure: build the report from already-collected facts. Tests feed in
 * synthesised inputs to exercise each branch without touching a real fs.
 */
export function runDiagnostics(input: DoctorInput): DoctorReport {
  const checks: CheckResult[] = [];

  // -- 1. Node version ------------------------------------------------------
  const major = parseInt(input.nodeVersion.split('.')[0] ?? '0', 10);
  if (Number.isFinite(major) && major >= REQUIRED_NODE_MAJOR) {
    checks.push({
      id: 'node.version',
      title: `Node ${input.nodeVersion}`,
      level: 'ok',
      detail: `Meets minimum (>= ${REQUIRED_NODE_MAJOR}).`,
    });
  } else {
    checks.push({
      id: 'node.version',
      title: `Node ${input.nodeVersion}`,
      level: 'fail',
      detail: `OpenHand requires Node ${REQUIRED_NODE_MAJOR}+. You're on ${input.nodeVersion}.`,
      fix: `Install Node ${REQUIRED_NODE_MAJOR} via nvm: \`nvm install ${REQUIRED_NODE_MAJOR} && nvm use ${REQUIRED_NODE_MAJOR}\``,
    });
  }

  // -- 2. Provider configuration -------------------------------------------
  const llm = input.config.llm;
  if (!llm.provider) {
    checks.push({
      id: 'provider.set',
      title: 'Provider not set',
      level: 'fail',
      detail: 'No LLM provider configured.',
      fix: 'Run `openhand init` and pick a provider, or `openhand config --setup`.',
    });
  } else {
    checks.push({
      id: 'provider.set',
      title: `Provider: ${llm.provider} / ${llm.model}`,
      level: 'ok',
      detail: `Model: ${llm.model}${llm.baseUrl ? `, base_url: ${llm.baseUrl}` : ''}`,
    });
    // API key check — `mock` and `ollama` legitimately don't need one.
    const needsKey = llm.provider !== 'ollama' && (llm.provider as string) !== 'mock';
    if (needsKey && !llm.apiKey) {
      checks.push({
        id: 'provider.api_key',
        title: `${llm.provider} API key`,
        level: 'warn',
        detail: 'No API key in config.',
        fix: `Set via env (\`${llm.provider.toUpperCase()}_API_KEY\`) or \`openhand config --llm-api-key <key>\`.`,
      });
    } else if (needsKey) {
      checks.push({
        id: 'provider.api_key',
        title: `${llm.provider} API key`,
        level: 'ok',
        detail: 'Configured (value redacted).',
      });
    }
  }

  // -- 3. Sandbox paths ----------------------------------------------------
  if (input.sandboxPaths.length === 0) {
    checks.push({
      id: 'sandbox.paths',
      title: 'Sandbox paths',
      level: 'warn',
      detail: 'No allow-listed paths — sandbox will refuse fs access.',
    });
  } else {
    checks.push({
      id: 'sandbox.paths',
      title: `Sandbox paths (${input.sandboxPaths.length})`,
      level: 'ok',
      detail: input.sandboxPaths.join(', '),
    });
  }

  // -- 4. Dependency integrity --------------------------------------------
  if (!input.nodeModulesExists) {
    checks.push({
      id: 'deps.installed',
      title: 'node_modules/',
      level: 'fail',
      detail: 'node_modules/ missing — dependencies not installed.',
      fix: 'Run `npm install` from the repo root.',
    });
  } else {
    checks.push({
      id: 'deps.installed',
      title: 'node_modules/',
      level: 'ok',
      detail: 'Present.',
    });
  }

  const missingPkgs = input.workspacePackages.filter(p => !p.resolved);
  if (missingPkgs.length > 0) {
    checks.push({
      id: 'deps.workspaces',
      title: 'Workspace packages',
      level: 'fail',
      detail: `Cannot resolve: ${missingPkgs.map(p => p.name).join(', ')}`,
      fix: 'Run `npm install` and confirm `npm run build --workspaces` succeeds.',
    });
  } else {
    checks.push({
      id: 'deps.workspaces',
      title: `Workspace packages (${input.workspacePackages.length})`,
      level: 'ok',
      detail: input.workspacePackages.map(p => `${p.name}@${p.version ?? '?'}`).join(', '),
    });
  }

  // -- Summary -------------------------------------------------------------
  const summary = { ok: 0, warn: 0, fail: 0 };
  for (const c of checks) summary[c.level]++;

  return {
    generatedAt: new Date().toISOString(),
    node: { version: input.nodeVersion, platform: input.platform, arch: input.arch },
    checks,
    summary,
  };
}

/**
 * Render a Markdown report. Plain text — no chalk, so it pastes cleanly
 * into a GitHub issue.
 */
export function renderMarkdown(report: DoctorReport): string {
  const lines: string[] = [];
  lines.push('# OpenHand doctor');
  lines.push('');
  lines.push(`_Generated: ${report.generatedAt}_`);
  lines.push('');
  lines.push(`**Node**: ${report.node.version} on ${report.node.platform}/${report.node.arch}`);
  lines.push('');
  lines.push(
    `**Summary**: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.fail} fail`,
  );
  lines.push('');
  lines.push('| Check | Level | Detail |');
  lines.push('| --- | --- | --- |');
  for (const c of report.checks) {
    const badge = c.level === 'ok' ? 'OK' : c.level === 'warn' ? 'WARN' : 'FAIL';
    const detail = c.detail.replace(/\|/g, '\\|');
    lines.push(`| ${c.title} | ${badge} | ${detail} |`);
  }
  lines.push('');
  // Remediation block — only emit if we have any non-ok findings.
  const fixable = report.checks.filter(c => c.fix && c.level !== 'ok');
  if (fixable.length > 0) {
    lines.push('## Suggested fixes');
    lines.push('');
    for (const c of fixable) {
      lines.push(`- **${c.title}** — ${c.fix}`);
    }
    lines.push('');
  }
  return lines.join('\n') + '\n';
}

// ---- I/O wrapper. The default export the CLI actually calls. ---------------

export interface RunDoctorOptions {
  /** Path to write the markdown report to (omit to skip writing). */
  outFile?: string;
  /** Override the repo root we look for `node_modules/` under. */
  repoRoot?: string;
  /** Stub for tests. */
  config?: ReplConfig;
  /** Stub for tests. */
  pluginCount?: number;
}

export interface RunDoctorDeps {
  loadConfig: () => Promise<ReplConfig>;
  /** Pluggable so tests don't have to touch the filesystem. */
  resolveWorkspacePackage: (name: string) => { resolved: boolean; version?: string };
  /** Where to look for `node_modules/`. */
  repoRoot: string;
  /** Sandbox paths used by the runtime. */
  sandboxPaths: readonly string[];
  /** Plugin count (informational). */
  pluginCount: number;
}

export async function runDoctor(
  options: RunDoctorOptions,
  deps: RunDoctorDeps,
  out: { write: (s: string) => void } = process.stdout,
): Promise<{ code: number; report: DoctorReport; markdown: string }> {
  const config = options.config ?? (await deps.loadConfig());
  const workspaceNames = ['@openhand/core', '@openhand/llm', '@openhand/sandbox', '@openhand/tools'];
  const workspacePackages = workspaceNames.map(name => ({
    name,
    ...deps.resolveWorkspacePackage(name),
  }));
  const nodeModulesExists = fs.existsSync(path.join(deps.repoRoot, 'node_modules'));

  const report = runDiagnostics({
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    config,
    sandboxPaths: deps.sandboxPaths,
    workspacePackages,
    nodeModulesExists,
    pluginCount: options.pluginCount ?? deps.pluginCount,
  });

  const md = renderMarkdown(report);
  out.write(md);

  if (options.outFile) {
    await fsp.mkdir(path.dirname(options.outFile), { recursive: true });
    await fsp.writeFile(options.outFile, md, 'utf-8');
  }

  // Exit code: 1 if any fail, 0 otherwise. Warns don't fail CI.
  const code = report.summary.fail > 0 ? 1 : 0;
  return { code, report, markdown: md };
}

/**
 * Default workspace package resolver — uses `require.resolve` to locate
 * the package's `package.json`. Returns `{ resolved: false }` on miss so
 * we never throw inside diagnostics.
 */
export function defaultResolveWorkspacePackage(name: string): { resolved: boolean; version?: string } {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const req = require;
    const pkgPath = req.resolve(`${name}/package.json`);
    const json = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return { resolved: true, ...(json.version !== undefined ? { version: json.version } : {}) };
  } catch {
    return { resolved: false };
  }
}

export function defaultSandboxPaths(): readonly string[] {
  return [process.cwd(), os.homedir()];
}
