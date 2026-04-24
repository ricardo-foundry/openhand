import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface TaskOptions {
  list?: boolean;
  approve?: string;
  reject?: string;
  cancel?: string;
}

export async function taskCommand(options: TaskOptions): Promise<void> {
  const configDir = path.join(os.homedir(), '.openhand');
  
  if (options.list) {
    try {
      const tasksPath = path.join(configDir, 'tasks.json');
      const data = await fs.readFile(tasksPath, 'utf-8');
      const tasks = JSON.parse(data);
      
      console.log(chalk.cyan('\n📋 Task List:\n'));
      
      if (tasks.length === 0) {
        console.log(chalk.gray('No tasks found.'));
        return;
      }

      for (const task of tasks) {
        const statusColor = task.status === 'completed' ? chalk.green :
                           task.status === 'failed' ? chalk.red :
                           task.status === 'running' ? chalk.blue :
                           task.status === 'pending' ? chalk.yellow : chalk.gray;
        
        console.log(`${statusColor(task.status.toUpperCase())} ${task.type}`);
        console.log(chalk.gray(`  ID: ${task.id}`));
        console.log(chalk.gray(`  Created: ${task.createdAt}`));
        if (task.result) {
          console.log(chalk.gray(`  Result: ${JSON.stringify(task.result).substring(0, 100)}`));
        }
        console.log('');
      }
    } catch (error) {
      console.log(chalk.gray('No tasks found.'));
    }
    return;
  }

  if (options.approve) {
    console.log(chalk.yellow(`Task approval functionality requires running agent`));
    console.log(chalk.gray(`Use \`openhand chat\` and run \`/approve ${options.approve}\``));
    return;
  }

  if (options.reject) {
    console.log(chalk.yellow(`Task rejection functionality requires running agent`));
    console.log(chalk.gray(`Use \`openhand chat\` and run \`/reject ${options.reject}\``));
    return;
  }

  if (options.cancel) {
    console.log(chalk.yellow(`Task cancellation is not yet implemented`));
    return;
  }

  console.log(chalk.yellow('Please specify an action: --list, --approve, --reject, or --cancel'));
}