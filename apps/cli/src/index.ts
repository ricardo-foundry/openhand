#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import * as os from 'os';
import { PluginLoader } from '@openhand/core';
import { SecureSandbox } from '@openhand/sandbox';
import { OpenHandCLI } from './cli';
import { configCommand } from './commands/config';
import { chatCommand } from './commands/chat';
import { taskCommand } from './commands/task';
import { runInit } from './commands/init';
import {
  runPluginsCommand,
  defaultPluginsDir,
  type PluginsSubcommand,
} from './commands/plugins';
import { renderStatus } from './commands/status';
import {
  runDoctor,
  defaultResolveWorkspacePackage,
  defaultSandboxPaths,
} from './commands/doctor';
import { runAudit, type AuditablePlugin } from './commands/audit';
import { loadConfig } from './repl';

const program = new Command();

const logo = `
  ██████  ██████  ███████ ███    ██ ███    ██  █████  ███    ██ ██████  
 ██    ██ ██   ██ ██      ████   ██ ████   ██ ██   ██ ████   ██ ██   ██ 
 ██    ██ ██████  █████   ██ ██  ██ ██ ██  ██ ███████ ██ ██  ██ ██   ██ 
 ██    ██ ██   ██ ██      ██  ██ ██ ██  ██ ██ ██   ██ ██  ██ ██ ██   ██ 
  ██████  ██   ██ ███████ ██   ████ ██   ████ ██   ██ ██   ████ ██████  
`;

console.log(chalk.cyan(logo));
console.log(boxen(
  chalk.white('🤖 OpenHand CLI v0.7.0') + '\n' +
  chalk.gray('Your secure AI assistant in the terminal'),
  {
    padding: 1,
    margin: 1,
    borderStyle: 'round',
    borderColor: 'cyan'
  }
));

program
  .name('openhand')
  .description(
    [
      'OpenHand — secure, LLM-agnostic AI agent.',
      '',
      'Common flows:',
      '  openhand chat              interactive REPL (/help inside for slash commands)',
      '  openhand ask "…"           one-shot question, prints the reply',
      '  openhand status            show provider + sandbox + plugins',
      '  openhand doctor            diagnose Node, provider, sandbox, deps',
      '  openhand audit             enumerate plugin scopes + risk scores',
      '  openhand plugins list      enumerate every discovered plugin',
      '',
      'Docs: https://github.com/ricardo-foundry/openhand',
    ].join('\n'),
  )
  .version('0.7.0');

// Init command — drop a project-local .openhand/config.json and walk the
// user through provider selection. Separate from `config --setup` (global).
program
  .command('init')
  .description('Initialise a project-local `.openhand/config.json` (interactive provider picker)')
  .option('-f, --force', 'Overwrite an existing config without prompting')
  .option('-y, --yes', 'Skip the wizard and write defaults (mock provider)')
  .action(async (options) => {
    const code = await runInit({
      force: !!options.force,
      yes: !!options.yes,
    });
    process.exit(code);
  });

// Chat command — delegates to chatCommand (which uses the zero-dep runRepl).
program
  .command('chat')
  .description('Start an interactive REPL. Type `/help` inside for slash commands.')
  .option('-m, --message <message>', 'Send a single message and exit (non-interactive)')
  .action(async (options) => {
    await chatCommand(options);
  });

// Config command
program
  .command('config')
  .description('Read or update the persistent config at ~/.openhand/config.json')
  .option('-s, --setup', 'Run the interactive first-time setup wizard')
  .option('-l, --list', 'Print the current config as JSON')
  .option('--llm-provider <provider>', 'Switch LLM provider (openai|anthropic|ollama|custom)')
  .option('--llm-model <model>', 'Switch model id (e.g. gpt-4o-mini, claude-3-5-haiku-latest)')
  .option('--llm-api-key <key>', 'Persist an API key (stored locally only)')
  .action(async (options) => {
    await configCommand(options);
  });

// Task command
program
  .command('task')
  .description('Inspect, approve, reject, or cancel background tasks')
  .option('-l, --list', 'List every task in the current session, any status')
  .option('-a, --approve <taskId>', 'Approve a task currently blocked on approval')
  .option('-r, --reject <taskId>', 'Reject a task currently blocked on approval')
  .option('--cancel <taskId>', 'Send cancellation to a running task')
  .action(async (options) => {
    await taskCommand(options);
  });

// Plugins command
program
  .command('plugins <sub> [id]')
  .description('Manage plugins: list | enable <id> | disable <id> | reload')
  .action(async (sub: string, id?: string) => {
    const allowed: readonly PluginsSubcommand[] = ['list', 'enable', 'disable', 'reload'];
    if (!(allowed as readonly string[]).includes(sub)) {
      console.log(`unknown plugins subcommand: ${sub}`);
      console.log('  try: openhand plugins list');
      process.exit(2);
    }
    const code = await runPluginsCommand(
      { sub: sub as PluginsSubcommand, ...(id !== undefined ? { id } : {}) },
      {
        createLoader: (pluginsDir: string) => new PluginLoader({ pluginsDir }),
      },
    );
    process.exit(code);
  });

// Status command
program
  .command('status')
  .description('Show the active provider, sandbox policy, and loaded plugins')
  .action(async () => {
    const config = await loadConfig();
    const pluginsDir = defaultPluginsDir();
    const loader = new PluginLoader({ pluginsDir });
    try {
      await loader.loadAll();
    } catch { /* ignore — status should still print core context */ }
    const plugins = loader.listPlugins().map(p => ({
      id: p.manifest.id,
      version: p.manifest.version,
      enabled: p.enabled,
      toolCount: (p.module.tools ?? []).length,
      ...(p.manifest.permissions !== undefined ? { permissions: p.manifest.permissions } : {}),
    }));
    // Build a live sandbox with the same defaults `OpenHandCLI` uses, then
    // ask it for its real policy — no more hard-coded strings here, so the
    // output reflects what the sandbox would actually enforce.
    const sandbox = new SecureSandbox({
      timeout: 30_000,
      memoryLimit: 256,
      allowedPaths: [process.cwd(), os.homedir()],
    });
    const policy = sandbox.getPolicy();
    const out = renderStatus({
      config,
      sandbox: {
        allowedCommands: policy.allowedCommands,
        allowedPaths: policy.allowedPaths,
        timeoutMs: policy.timeoutMs,
        memoryLimitMb: policy.memoryLimitMb,
      },
      plugins,
    });
    process.stdout.write(out);
  });

// Doctor command
program
  .command('doctor')
  .description('Diagnose the local environment (Node, provider, sandbox, deps) and emit Markdown')
  .option('-o, --out <file>', 'Also write the Markdown report to <file>')
  .action(async (options) => {
    const repoRoot = process.cwd();
    const pluginsDir = defaultPluginsDir();
    const loader = new PluginLoader({ pluginsDir });
    let pluginCount = 0;
    try {
      await loader.loadAll();
      pluginCount = loader.listPlugins().length;
    } catch { /* keep doctor diagnostic-only — don't crash */ }
    const result = await runDoctor(
      { ...(options.out !== undefined ? { outFile: options.out as string } : {}) },
      {
        loadConfig,
        resolveWorkspacePackage: defaultResolveWorkspacePackage,
        repoRoot,
        sandboxPaths: defaultSandboxPaths(),
        pluginCount,
      },
    );
    process.exit(result.code);
  });

// Audit command — list every installed plugin's declared scopes + a
// quick risk score. Read-only, never modifies the plugin set.
program
  .command('audit')
  .description('Audit installed plugins: declared scopes + risk score per plugin (Markdown)')
  .option('-o, --out <file>', 'Also write the Markdown report to <file>')
  .action(async (options) => {
    const pluginsDir = defaultPluginsDir();
    const result = await runAudit(
      {
        ...(options.out !== undefined ? { outFile: options.out as string } : {}),
        pluginsDir,
      },
      {
        loadPlugins: async (): Promise<AuditablePlugin[]> => {
          const loader = new PluginLoader({ pluginsDir });
          try {
            await loader.loadAll();
          } catch {
            /* keep audit informational — never crash */
          }
          return loader.listPlugins().map(p => ({
            manifest: {
              id: p.manifest.id,
              version: p.manifest.version,
              ...(p.manifest.description !== undefined ? { description: p.manifest.description } : {}),
              ...(p.manifest.permissions !== undefined ? { permissions: p.manifest.permissions } : {}),
            },
            dir: p.dir,
            enabled: p.enabled,
            module: { tools: (p.module.tools ?? []).map(t => ({ name: t.name })) },
          }));
        },
      },
    );
    process.exit(result.code);
  });

// Quick commands
program
  .command('ask <question>')
  .description('One-shot: send a single question, print the reply, exit')
  .action(async (question) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(question);
    process.exit(0);
  });

program
  .command('exec <command>')
  .description('Ask the agent to run a shell command (sandbox + approval gated)')
  .action(async (command) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Execute shell command: ${command}`);
    process.exit(0);
  });

program
  .command('read <path>')
  .description('Ask the agent to read a file from disk (sandbox path-checked)')
  .action(async (filePath) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Read file: ${filePath}`);
    process.exit(0);
  });

program
  .command('write <path> <content>')
  .description('Ask the agent to write to a file (approval gated, path-checked)')
  .action(async (filePath, content) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Write to file ${filePath}: ${content}`);
    process.exit(0);
  });

program
  .command('search <query>')
  .description('Delegate a web search query to the agent (requires network:http)')
  .action(async (query) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Search for: ${query}`);
    process.exit(0);
  });

// Default: drop the user straight into the same REPL `openhand chat` uses.
// Keeps one code path — no more legacy inquirer-based startInteractiveChat.
if (process.argv.length === 2) {
  (async () => {
    await chatCommand({});
  })();
} else {
  program.parse();
}