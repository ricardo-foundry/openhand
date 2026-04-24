#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { PluginLoader } from '@openhand/core';
import { OpenHandCLI } from './cli';
import { configCommand } from './commands/config';
import { chatCommand } from './commands/chat';
import { taskCommand } from './commands/task';
import {
  runPluginsCommand,
  defaultPluginsDir,
  type PluginsSubcommand,
} from './commands/plugins';
import { renderStatus } from './commands/status';
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
  chalk.white('🤖 OpenHand CLI v1.0.0') + '\n' +
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
      '  openhand plugins list      enumerate every discovered plugin',
      '',
      'Docs: https://github.com/Ricardo-M-L/openhand',
    ].join('\n'),
  )
  .version('1.0.0');

// Chat command
program
  .command('chat')
  .description('Start an interactive REPL. Type `/help` inside for slash commands.')
  .option('-m, --message <message>', 'Send a single message and exit (non-interactive)')
  .action(async (options) => {
    const cli = new OpenHandCLI();
    await cli.initialize();

    if (options.message) {
      await cli.sendMessage(options.message);
      process.exit(0);
    } else {
      await cli.startInteractiveChat();
    }
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
    const out = renderStatus({
      config,
      sandbox: {
        allowedCommands: ['ls', 'cat', 'git', 'npm', 'node'],
        allowedPaths: [process.cwd()],
        timeoutMs: 30_000,
        memoryLimitMb: 256,
      },
      plugins,
    });
    process.stdout.write(out);
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

// Default: interactive mode
if (process.argv.length === 2) {
  (async () => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.startInteractiveChat();
  })();
} else {
  program.parse();
}