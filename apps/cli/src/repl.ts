import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

/**
 * Minimal slash-command aware REPL.
 *
 * Deliberately zero-dependency (no `inquirer`, no `prompts`, no `blessed`):
 *
 *   - native `readline` for input — gives us ctrl+c handling and history for
 *     free.
 *   - native ANSI for the spinner — one repainted line, no allocation.
 *   - config persistence lives in `~/.openhand/config.json` under
 *     `OPENHAND_HOME` if set.
 *
 * The REPL is UI-only: it does not import core, it does not call an LLM. The
 * caller passes a `send(message)` function that decides what "send" means.
 * That keeps this module testable (swap `send` for a fake) and reusable from
 * tests, `openhand chat`, or any embed.
 */

export interface ReplConfig {
  llm: {
    provider: 'openai' | 'anthropic' | 'ollama' | 'custom';
    model: string;
    apiKey?: string;
    baseUrl?: string;
    temperature?: number;
    maxTokens?: number;
  };
  agent?: Record<string, unknown>;
  history?: string[];
}

export const DEFAULT_REPL_CONFIG: ReplConfig = Object.freeze({
  llm: {
    provider: 'openai',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxTokens: 2000,
  },
  agent: {},
  history: [],
}) as ReplConfig;

export interface ReplDeps {
  /** Called for each non-slash line the user types. */
  send: (message: string) => Promise<void>;
  /** Replace stdout for tests. */
  out?: NodeJS.WriteStream | { write: (s: string) => void };
  /** Replace stdin for tests. */
  in?: NodeJS.ReadStream;
  /** Override config file path (defaults to ~/.openhand/config.json). */
  configPath?: string;
}

export const SLASH_COMMANDS = [
  '/help',
  '/model',
  '/reset',
  '/save',
  '/exit',
] as const;

export type SlashCommandName = (typeof SLASH_COMMANDS)[number];

export interface SlashCommandResult {
  /** Message to print to the user, if any. */
  message?: string;
  /** Request the REPL loop to terminate. */
  exit?: boolean;
  /** Mutations to apply to config before next turn. */
  config?: Partial<ReplConfig>;
}

/**
 * Pure function: given a slash command line and current config, return what
 * should happen. Factored out from the runner so tests can exercise every
 * command without spawning a TTY.
 */
export function handleSlashCommand(
  line: string,
  config: ReplConfig,
): SlashCommandResult {
  const trimmed = line.trim();
  if (!trimmed.startsWith('/')) {
    return { message: 'not a slash command' };
  }
  const [cmd, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ');

  switch (cmd) {
    case '/help':
      return {
        message: [
          'Available commands:',
          '  /help             show this list',
          '  /model <name>     switch model (also accepts "<provider>:<model>")',
          '  /reset            clear history for the current session',
          '  /save             persist config to ~/.openhand/config.json',
          '  /exit             leave the REPL',
        ].join('\n'),
      };

    case '/model': {
      if (!arg) {
        return { message: `current model: ${config.llm.provider}/${config.llm.model}` };
      }
      const colon = arg.indexOf(':');
      if (colon > 0) {
        const provider = arg.slice(0, colon).toLowerCase();
        const model = arg.slice(colon + 1).trim();
        if (!['openai', 'anthropic', 'ollama', 'custom'].includes(provider)) {
          return { message: `unknown provider: ${provider}` };
        }
        return {
          message: `switched to ${provider}/${model}`,
          config: {
            llm: { ...config.llm, provider: provider as ReplConfig['llm']['provider'], model },
          },
        };
      }
      return {
        message: `switched to ${config.llm.provider}/${arg}`,
        config: { llm: { ...config.llm, model: arg } },
      };
    }

    case '/reset':
      return {
        message: 'history cleared',
        config: { history: [] },
      };

    case '/save':
      return { message: '__PERSIST__' }; // sentinel — runner persists.

    case '/exit':
      return { message: 'bye', exit: true };

    default:
      return { message: `unknown command: ${cmd} (try /help)` };
  }
}

/** File-backed config persistence. */
export async function loadConfig(configPath?: string): Promise<ReplConfig> {
  const p = configPath ?? defaultConfigPath();
  try {
    const raw = await fs.readFile(p, 'utf-8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_REPL_CONFIG, ...parsed, llm: { ...DEFAULT_REPL_CONFIG.llm, ...(parsed.llm ?? {}) } };
  } catch {
    return { ...DEFAULT_REPL_CONFIG };
  }
}

export async function saveConfig(config: ReplConfig, configPath?: string): Promise<string> {
  const p = configPath ?? defaultConfigPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, JSON.stringify(config, null, 2) + '\n', 'utf-8');
  return p;
}

function defaultConfigPath(): string {
  const home = process.env.OPENHAND_HOME
    ? resolveTilde(process.env.OPENHAND_HOME)
    : path.join(os.homedir(), '.openhand');
  return path.join(home, 'config.json');
}

function resolveTilde(p: string): string {
  if (p === '~' || p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}

// --- spinner ---------------------------------------------------------------

/**
 * Tiny ANSI spinner on a single line. No deps.
 * Safe to start/stop multiple times.
 */
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private frame = 0;
  private timer: NodeJS.Timeout | null = null;
  private readonly out: NodeJS.WriteStream | { write: (s: string) => void };
  private lastLen = 0;

  constructor(out?: NodeJS.WriteStream | { write: (s: string) => void }) {
    this.out = out ?? process.stdout;
  }

  start(message: string): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.render(message), 90);
    this.timer.unref?.();
    this.render(message);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // wipe the line
    if (this.lastLen > 0) {
      this.out.write('\r' + ' '.repeat(this.lastLen) + '\r');
      this.lastLen = 0;
    }
  }

  private render(message: string): void {
    const ch = this.frames[this.frame++ % this.frames.length];
    const line = `\r${ch} ${message}`;
    this.lastLen = line.length;
    this.out.write(line);
  }
}

// --- runner ----------------------------------------------------------------

export async function runRepl(deps: ReplDeps): Promise<void> {
  const out = deps.out ?? process.stdout;
  const input = deps.in ?? process.stdin;

  let config = await loadConfig(deps.configPath);
  out.write('OpenHand REPL. /help for commands, ctrl+c to exit.\n');

  const rl = readline.createInterface({
    input,
    output: out as NodeJS.WritableStream,
    terminal: false,
  });

  let exited = false;
  let activeSpinner: Spinner | undefined;
  const onSigint = (): void => {
    out.write('\n^C\nexiting...\n');
    exited = true;
    // Stop any spinner so we don't leave ANSI state garbling the terminal.
    activeSpinner?.stop();
    // Best-effort persist so the user's in-REPL /model changes aren't lost.
    // We don't await here because SIGINT handlers should return quickly;
    // fs.writeFile's callback keeps the event loop alive just long enough
    // for rl.close() to settle.
    saveConfig(config, deps.configPath).catch(() => { /* swallow */ });
    rl.close();
  };
  process.on('SIGINT', onSigint);

  try {
    for await (const raw of rl) {
      if (exited) break;
      const line = raw.trim();
      if (!line) {
        out.write('> ');
        continue;
      }

      if (line.startsWith('/')) {
        const result = handleSlashCommand(line, config);
        if (result.config) {
          config = { ...config, ...result.config };
        }
        if (result.message === '__PERSIST__') {
          const p = await saveConfig(config, deps.configPath);
          out.write(`saved config to ${p}\n`);
        } else if (result.message) {
          out.write(result.message + '\n');
        }
        if (result.exit) break;
        out.write('> ');
        continue;
      }

      activeSpinner = new Spinner(out);
      activeSpinner.start('thinking');
      try {
        await deps.send(line);
      } catch (err) {
        out.write(`\nerror: ${(err as Error).message}\n`);
      } finally {
        activeSpinner.stop();
        activeSpinner = undefined;
      }
      out.write('> ');
    }
  } finally {
    process.off('SIGINT', onSigint);
  }
}
