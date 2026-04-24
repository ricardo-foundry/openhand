/**
 * `openhand status` — print the current session context:
 *
 *   - configured LLM provider + model
 *   - sandbox policy (allow-lists, limits)
 *   - discovered plugins and whether they are enabled
 *
 * Factored as pure `renderStatus()` + a thin I/O wrapper so the unit tests
 * don't need to touch a real filesystem or REPL config file.
 */
import type { ReplConfig } from '../repl';

export interface StatusInput {
  config: ReplConfig;
  sandbox: {
    allowedCommands: readonly string[];
    allowedPaths: readonly string[];
    timeoutMs: number;
    memoryLimitMb: number;
  };
  plugins: ReadonlyArray<{
    id: string;
    version: string;
    enabled: boolean;
    toolCount: number;
    permissions?: readonly string[];
  }>;
}

/**
 * Pure formatter — no process reads, no fs reads. Everything it needs comes
 * from the `StatusInput` argument.
 */
export function renderStatus(input: StatusInput): string {
  const lines: string[] = [];
  lines.push('OpenHand — status');
  lines.push('');

  lines.push('Provider');
  lines.push(`  provider   ${input.config.llm.provider}`);
  lines.push(`  model      ${input.config.llm.model}`);
  if (input.config.llm.baseUrl) {
    lines.push(`  base_url   ${input.config.llm.baseUrl}`);
  }
  lines.push(`  api_key    ${input.config.llm.apiKey ? '(set)' : '(not set)'}`);
  if (typeof input.config.llm.temperature === 'number') {
    lines.push(`  temp       ${input.config.llm.temperature}`);
  }
  if (typeof input.config.llm.maxTokens === 'number') {
    lines.push(`  max_tokens ${input.config.llm.maxTokens}`);
  }
  lines.push('');

  lines.push('Sandbox policy');
  lines.push(`  timeout    ${input.sandbox.timeoutMs}ms`);
  lines.push(`  memory     ${input.sandbox.memoryLimitMb}MB`);
  lines.push(`  commands   ${input.sandbox.allowedCommands.length} allowed (${preview(input.sandbox.allowedCommands)})`);
  lines.push(`  paths      ${input.sandbox.allowedPaths.length} allowed (${preview(input.sandbox.allowedPaths)})`);
  lines.push('');

  lines.push(`Plugins (${input.plugins.length})`);
  if (input.plugins.length === 0) {
    lines.push('  (none discovered)');
  } else {
    for (const p of input.plugins) {
      const perms = p.permissions && p.permissions.length > 0
        ? ` [${p.permissions.join(', ')}]`
        : '';
      lines.push(
        `  ${p.enabled ? '•' : '·'} ${p.id}@${p.version}  ${p.toolCount} tool(s)${perms}`,
      );
    }
  }
  return lines.join('\n') + '\n';
}

function preview(list: readonly string[]): string {
  if (list.length === 0) return 'none';
  const head = list.slice(0, 3).join(', ');
  return list.length > 3 ? `${head}, …` : head;
}
