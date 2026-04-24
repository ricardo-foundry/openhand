import chalk from 'chalk';
import { OpenHandCLI } from '../cli';

interface ChatOptions {
  message?: string;
}

export async function chatCommand(options: ChatOptions): Promise<void> {
  const cli = new OpenHandCLI();
  await cli.initialize();

  if (options.message) {
    await cli.sendMessage(options.message);
    process.exit(0);
  } else {
    await cli.startInteractiveChat();
  }
}