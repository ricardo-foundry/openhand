/**
 * `openhand init` — drop a project-local `.openhand/config.json` in the
 * current working directory and walk the user through a tiny provider-pick
 * wizard. This is intentionally separate from `openhand config --setup`
 * which writes to the *global* `~/.openhand/` instead. The two never share
 * state.
 *
 * Why a local config? Two real reasons we hit while playing with the CLI:
 *   - You want different providers for different repos (Ollama for OSS work,
 *     OpenAI for the gig that pays for it). Per-repo settings in `.openhand/`
 *     do exactly that.
 *   - Onboarding: dropping the file makes the repo "claim" itself for
 *     OpenHand, which the agent can use later to find the project root.
 *
 * The wizard is `readline`-only (no `inquirer`). Tests inject a fake
 * `prompt` so we never spawn a TTY.
 */
import * as fs from 'fs/promises';
import * as path from 'path';
import * as readline from 'readline';

export interface InitOptions {
  /** Force overwriting an existing `.openhand/config.json`. */
  force?: boolean;
  /** Skip the wizard and write defaults. Useful for CI and tests. */
  yes?: boolean;
  /** Override target directory (defaults to `process.cwd()`). */
  cwd?: string;
}

export interface InitDeps {
  /** Where to write. Defaults to `<cwd>/.openhand/config.json`. */
  configPath?: string;
  /** Question/answer hook. Tests inject a scripted impl. */
  prompt?: (question: string) => Promise<string>;
  /** Output sink. Defaults to `process.stdout.write`. */
  write?: (s: string) => void;
}

export interface InitConfig {
  schema: 1;
  llm: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'mock';
    model: string;
    apiKey?: string;
    baseUrl?: string;
  };
  agent: {
    sandboxEnabled: boolean;
    requireApprovalFor: string[];
  };
  createdAt: string;
}

const PROVIDER_DEFAULTS = {
  openai: { model: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1' },
  anthropic: { model: 'claude-3-5-haiku-latest', baseUrl: 'https://api.anthropic.com/v1' },
  ollama: { model: 'qwen2.5:0.5b', baseUrl: 'http://localhost:11434' },
  mock: { model: 'mock', baseUrl: '' },
} as const;

export const PROVIDERS: ReadonlyArray<keyof typeof PROVIDER_DEFAULTS> = [
  'openai',
  'anthropic',
  'ollama',
  'mock',
];

/**
 * Run the wizard. Pure-ish: no global state, all I/O hits the injected deps.
 * Returns the exit code so a caller in tests can assert behaviour without
 * trapping `process.exit`.
 */
export async function runInit(opts: InitOptions, deps: InitDeps = {}): Promise<number> {
  const cwd = opts.cwd ?? process.cwd();
  const configPath = deps.configPath ?? path.join(cwd, '.openhand', 'config.json');
  const write = deps.write ?? ((s: string) => void process.stdout.write(s));

  // Refuse to clobber unless --force.
  if (!opts.force) {
    try {
      await fs.stat(configPath);
      write(`error: ${configPath} already exists. Re-run with --force to overwrite.\n`);
      return 2;
    } catch {
      // ENOENT — proceed.
    }
  }

  let provider: keyof typeof PROVIDER_DEFAULTS = 'mock';
  let model: string = PROVIDER_DEFAULTS.mock.model;
  let apiKey: string | undefined;
  let baseUrl: string | undefined;

  if (opts.yes) {
    // Defaults: mock provider so first-run is offline and never fails.
    provider = 'mock';
    model = PROVIDER_DEFAULTS.mock.model;
  } else {
    const promptCtx = deps.prompt
      ? { ask: deps.prompt, dispose: (): void => {} }
      : openReadlinePrompt();
    try {
      write('Pick a provider:\n');
      PROVIDERS.forEach((p, i) => write(`  ${i + 1}) ${p}\n`));
      write('  (default: 4 = mock — works offline, no API key)\n');
      const rawProv = (await promptCtx.ask('> ')).trim();
      const choice = parseProviderChoice(rawProv);
      if (choice) provider = choice;

      const def = PROVIDER_DEFAULTS[provider];
      const rawModel = (await promptCtx.ask(`Model [${def.model}]: `)).trim();
      model = rawModel || def.model;

      if (provider === 'openai' || provider === 'anthropic') {
        const k = (await promptCtx.ask('API key (leave blank to set later via env): ')).trim();
        if (k) apiKey = k;
      }
      if (provider === 'ollama' || provider === 'openai') {
        const b = (await promptCtx.ask(`Base URL [${def.baseUrl}]: `)).trim();
        if (b) baseUrl = b;
      }
    } finally {
      promptCtx.dispose();
    }
  }

  const config: InitConfig = {
    schema: 1,
    llm: {
      provider,
      model,
      ...(apiKey !== undefined ? { apiKey } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
    },
    agent: {
      sandboxEnabled: true,
      requireApprovalFor: ['shell_exec', 'file_write', 'email_send'],
    },
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  write(`wrote ${configPath}\n`);
  write(`provider=${provider} model=${model}\n`);
  if (provider === 'mock') {
    write('next: try `openhand chat` — the mock provider returns canned replies (offline).\n');
  } else {
    write('next: `openhand chat` to start a session, or set the API key via env if you skipped it.\n');
  }
  return 0;
}

/** Parse user input for the provider question. Accepts numbers or names. */
export function parseProviderChoice(raw: string): keyof typeof PROVIDER_DEFAULTS | null {
  if (!raw) return null;
  const n = Number.parseInt(raw, 10);
  if (Number.isFinite(n) && n >= 1 && n <= PROVIDERS.length) {
    return PROVIDERS[n - 1]!;
  }
  const lower = raw.toLowerCase().trim();
  if ((PROVIDERS as readonly string[]).includes(lower)) {
    return lower as keyof typeof PROVIDER_DEFAULTS;
  }
  return null;
}

function openReadlinePrompt(): {
  ask: (q: string) => Promise<string>;
  dispose: () => void;
} {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return {
    ask: (q: string) =>
      new Promise<string>(resolve => {
        rl.question(q, answer => resolve(answer));
      }),
    dispose: () => rl.close(),
  };
}
