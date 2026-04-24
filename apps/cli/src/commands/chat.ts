import chalk from 'chalk';
import { OpenHandCLI } from '../cli';
import { runRepl } from '../repl';

interface ChatOptions {
  message?: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const cli = new OpenHandCLI();
  await cli.initialize();

  if (options.message) {
    await cli.sendMessage(options.message);
    process.exit(0);
  }

  // Interactive REPL with /help, /model, /reset, /save, /exit, ctrl+c.
  console.log(chalk.cyan('Type a message, or /help for commands.'));
  try {
    await runRepl({
      send: async (msg: string) => {
        await cli.sendMessage(msg);
      },
    });
  } catch (err) {
    console.log(chalk.red('REPL error:'), err);
  }
}
