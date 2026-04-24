#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import boxen from 'boxen';
import { OpenHandCLI } from './cli';
import { configCommand } from './commands/config';
import { chatCommand } from './commands/chat';
import { taskCommand } from './commands/task';

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
  .description('OpenHand - Secure AI Agent CLI')
  .version('1.0.0');

// Chat command
program
  .command('chat')
  .description('Start interactive chat with OpenHand')
  .option('-m, --message <message>', 'Send a single message')
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
  .description('Manage OpenHand configuration')
  .option('-s, --setup', 'Run initial setup')
  .option('-l, --list', 'List current configuration')
  .option('--llm-provider <provider>', 'Set LLM provider (openai/claude/ollama)')
  .option('--llm-model <model>', 'Set LLM model')
  .option('--llm-api-key <key>', 'Set API key')
  .action(async (options) => {
    await configCommand(options);
  });

// Task command
program
  .command('task')
  .description('Manage tasks')
  .option('-l, --list', 'List all tasks')
  .option('-a, --approve <taskId>', 'Approve a pending task')
  .option('-r, --reject <taskId>', 'Reject a pending task')
  .option('--cancel <taskId>', 'Cancel a running task')
  .action(async (options) => {
    await taskCommand(options);
  });

// Quick commands
program
  .command('ask <question>')
  .description('Quick ask a question')
  .action(async (question) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(question);
    process.exit(0);
  });

program
  .command('exec <command>')
  .description('Execute a shell command (sandboxed)')
  .action(async (command) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Execute shell command: ${command}`);
    process.exit(0);
  });

program
  .command('read <path>')
  .description('Read a file')
  .action(async (filePath) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Read file: ${filePath}`);
    process.exit(0);
  });

program
  .command('write <path> <content>')
  .description('Write to a file')
  .action(async (filePath, content) => {
    const cli = new OpenHandCLI();
    await cli.initialize();
    await cli.sendMessage(`Write to file ${filePath}: ${content}`);
    process.exit(0);
  });

program
  .command('search <query>')
  .description('Search the web')
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