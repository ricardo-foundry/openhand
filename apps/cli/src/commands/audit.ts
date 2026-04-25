/**
 * `openhand audit` — surface the security-relevant surface area of every
 * installed plugin so an operator can review what they're actually trusting.
 *
 * For each loaded plugin we extract:
 *   - declared scopes (manifest.permissions)
 *   - tool count + names
 *   - per-scope risk score (additive, capped) — see `scoreScope`
 *   - aggregate risk band (low / medium / high)
 *
 * The output is plain Markdown so it round-trips to a file or PR comment.
 *
 * The scoring heuristic is intentionally simple and conservative — see
 * `SCOPE_WEIGHTS` below. It's not a CVSS replacement; it's a "does this
 * plugin look reasonable?" eyeball aid.
 */

import * as path from 'path';
import * as os from 'os';

/** Shape of a plugin we need for the audit. Matches `PluginLoader.listPlugins()`. */
export interface AuditablePlugin {
  manifest: {
    id: string;
    version: string;
    description?: string;
    permissions?: string[];
  };
  dir: string;
  enabled: boolean;
  module: { tools?: Array<{ name: string; permissions?: string[] }> };
}

export interface AuditCommandDeps {
  /** Build a loader. Injected so tests don't touch the real FS. */
  loadPlugins: () => Promise<AuditablePlugin[]> | AuditablePlugin[];
  /** Stdout sink. Defaults to `process.stdout.write`. */
  write?: (s: string) => void;
}

export interface AuditCommandArgs {
  /** Optional Markdown report sink. */
  outFile?: string;
  /** Override the plugins root in stdout headline only (no FS read). */
  pluginsDir?: string;
}

/** Higher = scarier. Tunable, but bumping these is a breaking change for
 * anyone parsing the report — keep weights stable across minor versions. */
const SCOPE_WEIGHTS: Record<string, number> = {
  // Network egress — the single biggest risk vector for plugins.
  'network:http': 4,
  'network:https': 4,
  'network:ws': 4,
  'network:any': 6,

  // Filesystem
  'fs:read': 2,
  'fs:write': 5,
  'fs:read:~': 3,
  'fs:write:~': 6,

  // Subprocess / shell
  'shell:exec': 8,
  'process:spawn': 8,

  // LLM scope is low-risk on its own — it's the combination with network
  // or shell that's worrying. Score it as 1 so multi-scope plugins still
  // bubble above plain LLM-only plugins.
  'llm:chat': 1,
  'llm:complete': 1,
  'llm:stream': 1,
  'llm:tool': 2,

  // Sandbox bypass — explicit "I want to escape the sandbox" scope.
  'sandbox:bypass': 10,
};

/** Match scopes by exact name; for `fs:write:~/.openhand` etc. we match
 * by the first two segments so `fs:write:/etc` still scores under
 * `fs:write` (5). */
export function scoreScope(scope: string): number {
  if (Object.prototype.hasOwnProperty.call(SCOPE_WEIGHTS, scope)) {
    return SCOPE_WEIGHTS[scope] ?? 0;
  }
  // Try the two-segment prefix.
  const segments = scope.split(':');
  if (segments.length >= 2) {
    const prefix = `${segments[0]}:${segments[1]}`;
    if (Object.prototype.hasOwnProperty.call(SCOPE_WEIGHTS, prefix)) {
      return SCOPE_WEIGHTS[prefix] ?? 0;
    }
  }
  // Unknown scope — give it 1 so it's visible without dominating known scopes.
  return 1;
}

export type RiskBand = 'low' | 'medium' | 'high';

export function bandForScore(score: number): RiskBand {
  if (score >= 8) return 'high';
  if (score >= 4) return 'medium';
  return 'low';
}

export interface PluginAuditRow {
  id: string;
  version: string;
  enabled: boolean;
  scopes: string[];
  toolNames: string[];
  score: number;
  band: RiskBand;
}

export function auditPlugin(p: AuditablePlugin): PluginAuditRow {
  const scopes = (p.manifest.permissions ?? []).slice().sort();
  const score = scopes.reduce((acc, s) => acc + scoreScope(s), 0);
  return {
    id: p.manifest.id,
    version: p.manifest.version,
    enabled: p.enabled,
    scopes,
    toolNames: (p.module.tools ?? []).map(t => t.name).sort(),
    score,
    band: bandForScore(score),
  };
}

/** Render the audit report as Markdown — tables + per-plugin sections. */
export function renderAuditReport(
  rows: ReadonlyArray<PluginAuditRow>,
  pluginsDir: string,
): string {
  const lines: string[] = [];
  lines.push('# OpenHand Plugin Audit');
  lines.push('');
  lines.push(`Plugins directory: \`${pluginsDir}\``);
  lines.push(`Total plugins: ${rows.length}`);
  lines.push('');

  if (rows.length === 0) {
    lines.push('_No plugins installed._');
    lines.push('');
    return lines.join('\n');
  }

  // Headline table
  lines.push('## Summary');
  lines.push('');
  lines.push('| id | version | enabled | scopes | tools | risk |');
  lines.push('| -- | ------- | ------- | ------ | ----- | ---- |');
  for (const r of rows) {
    lines.push(
      `| ${r.id} | ${r.version} | ${r.enabled ? 'yes' : 'no'} | ${r.scopes.length} | ${r.toolNames.length} | **${r.band}** (${r.score}) |`,
    );
  }
  lines.push('');

  // Per-plugin detail
  lines.push('## Details');
  lines.push('');
  for (const r of rows) {
    lines.push(`### ${r.id}@${r.version}`);
    lines.push('');
    lines.push(`- enabled: \`${r.enabled}\``);
    lines.push(`- risk score: \`${r.score}\` (${r.band})`);
    if (r.scopes.length > 0) {
      lines.push('- declared scopes:');
      for (const s of r.scopes) {
        lines.push(`  - \`${s}\` (+${scoreScope(s)})`);
      }
    } else {
      lines.push('- declared scopes: _none_');
    }
    if (r.toolNames.length > 0) {
      lines.push('- exposed tools:');
      for (const t of r.toolNames) lines.push(`  - \`${t}\``);
    } else {
      lines.push('- exposed tools: _none_');
    }
    lines.push('');
  }

  return lines.join('\n');
}

/** Run the audit and emit a Markdown report to stdout (and optionally a file). */
export async function runAudit(
  args: AuditCommandArgs,
  deps: AuditCommandDeps,
): Promise<{ code: number; report: string; rows: PluginAuditRow[] }> {
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));
  const plugins = await deps.loadPlugins();
  const rows = plugins.map(auditPlugin);
  // Sort highest-risk first so the worst offenders show up at the top.
  rows.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const dir = args.pluginsDir ?? defaultPluginsDir();
  const report = renderAuditReport(rows, dir);
  write(report);
  if (args.outFile) {
    const fs = await import('fs/promises');
    await fs.writeFile(args.outFile, report, 'utf-8');
  }
  // Audit is informational — exit code 0 unless we hit an unexpected
  // empty-plugins-dir state. We deliberately don't fail on `high`
  // band plugins; that decision belongs to the operator's CI policy.
  return { code: 0, report, rows };
}

export function defaultPluginsDir(): string {
  const home = process.env.OPENHAND_HOME ?? path.join(os.homedir(), '.openhand');
  return path.join(home, 'plugins');
}
