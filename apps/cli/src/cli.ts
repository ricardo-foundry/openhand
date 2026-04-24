import { Agent, AgentConfig, LLMConfig, Message, Task } from '@openhand/core';
import { SecureSandbox } from '@openhand/sandbox';
import { createTools } from '@openhand/tools';
import chalk from 'chalk';
import inquirer from 'inquirer';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface Config {
  llm: LLMConfig;
  agent: Partial<AgentConfig>;
}

export class OpenHandCLI {
  private agent?: Agent;
  private sandbox: SecureSandbox;
  private config: Config;
  private sessionId: string;
  private pendingApprovals: Map<string, Task> = new Map();

  constructor() {
    this.sessionId = `cli-${Date.now()}`;
    this.sandbox = new SecureSandbox({
      timeout: 30000,
      memoryLimit: 256,
      allowedPaths: [process.cwd(), os.homedir()]
    });
    this.config = this.getDefaultConfig();
  }

  async initialize(): Promise<void> {
    // 加载配置
    await this.loadConfig();

    // 创建工具
    const tools = createTools({ sandbox: this.sandbox });

    // 创建 Agent
    const agentConfig: AgentConfig = {
      name: 'OpenHand CLI',
      description: 'Your secure AI assistant',
      systemPrompt: `You are OpenHand, a helpful and secure AI assistant. 
You help users with various tasks including file operations, web searches, and system queries.
Always prioritize security and ask for confirmation before performing destructive operations.`,
      tools: Array.from(tools.keys()),
      maxIterations: 10,
      requireApprovalFor: ['shell_exec', 'file_write', 'email_send'],
      sandboxEnabled: true,
      ...this.config.agent
    };

    this.agent = new Agent({
      config: agentConfig,
      llmConfig: this.config.llm,
      tools
    });

    // 设置事件监听
    this.setupEventListeners();

    // 初始化 Agent
    await this.agent.initialize();
  }

  async startInteractiveChat(): Promise<void> {
    console.log(chalk.cyan('\n🤖 OpenHand is ready! Type your message or "help" for commands.\n'));
    console.log(chalk.gray('Commands: /quit, /exit, /clear, /tasks, /approve, /reject\n'));

    while (true) {
      const { message } = await inquirer.prompt([{
        type: 'input',
        name: 'message',
        message: chalk.green('You'),
        prefix: '>'
      }]);

      if (!message.trim()) continue;

      // 处理特殊命令
      if (message.startsWith('/')) {
        const handled = await this.handleSlashCommand(message);
        if (!handled) break;
        continue;
      }

      await this.sendMessage(message);
    }
  }

  async sendMessage(message: string): Promise<void> {
    if (!this.agent) {
      console.log(chalk.red('Agent not initialized'));
      return;
    }

    const spinner = ora('Thinking...').start();
    const agent = this.agent;

    // Resolve when agent emits a terminal signal:
    //  - assistant `message` event       -> normal completion
    //  - `system` event with level=error -> hard failure
    //  - `task:error` on a non-approval task
    // Wired this way so `runRepl` can `await send()` and trust the spinner
    // is stopped + output flushed before printing the next prompt.
    const settled = new Promise<void>(resolve => {
      let done = false;
      const finish = (): void => {
        if (done) return;
        done = true;
        agent.off('message', onMessage);
        agent.off('system', onSystem);
        resolve();
      };
      const onMessage = (msg: Message): void => {
        if (msg.role === 'assistant') finish();
      };
      const onSystem = (e: { level: string }): void => {
        if (e.level === 'error') finish();
      };
      agent.on('message', onMessage);
      agent.on('system', onSystem);
    });

    try {
      await Promise.all([
        agent.chat(this.sessionId, message),
        settled,
      ]);
    } catch (error) {
      console.log(chalk.red('Error:'), error);
    } finally {
      spinner.stop();
    }
  }

  private setupEventListeners(): void {
    if (!this.agent) return;

    this.agent.on('message', (message: Message) => {
      if (message.role === 'assistant') {
        console.log(chalk.cyan('\n🤖 Assistant:'), message.content, '\n');
      }
    });

    this.agent.on('task:start', (task: Task) => {
      console.log(chalk.blue(`⚙️  Starting task: ${task.type}`));
    });

    this.agent.on('task:complete', (task: Task) => {
      if (task.result) {
        console.log(chalk.green(`✅ Task completed: ${task.type}`));
        if (typeof task.result === 'object') {
          console.log(chalk.gray(JSON.stringify(task.result, null, 2)));
        } else {
          console.log(chalk.gray(String(task.result)));
        }
      }
    });

    this.agent.on('task:error', ({ taskId, error }: { taskId: string; error: string }) => {
      console.log(chalk.red(`❌ Task failed: ${error}`));
    });

    this.agent.on('approval:required', ({ taskId, reason }: { taskId: string; reason: string }) => {
      const session = this.agent?.getSession(this.sessionId);
      const task = session?.tasks.find(t => t.id === taskId);
      if (task) {
        this.pendingApprovals.set(taskId, task);
        console.log(chalk.yellow(`⏳ Approval required: ${reason}`));
        console.log(chalk.gray(`   Task ID: ${taskId}`));
        console.log(chalk.gray(`   Run \`/approve ${taskId}\` to approve or \`/reject ${taskId}\` to reject`));
      }
    });

    this.agent.on('system', ({ message, level }: { message: string; level: string }) => {
      if (level === 'error') {
        console.log(chalk.red(`System: ${message}`));
      } else if (level === 'warn') {
        console.log(chalk.yellow(`System: ${message}`));
      }
    });
  }

  private async handleSlashCommand(command: string): Promise<boolean> {
    const parts = command.slice(1).split(' ');
    const cmd = (parts[0] ?? '').toLowerCase();
    const args = parts.slice(1);

    switch (cmd) {
      case 'quit':
      case 'exit':
        console.log(chalk.cyan('Goodbye! 👋'));
        return false;

      case 'clear':
        console.clear();
        return true;

      case 'tasks':
        await this.showTasks();
        return true;

      case 'approve':
        if (args[0]) {
          await this.approveTask(args[0], true);
        } else {
          console.log(chalk.yellow('Usage: /approve <task-id>'));
        }
        return true;

      case 'reject':
        if (args[0]) {
          await this.approveTask(args[0], false);
        } else {
          console.log(chalk.yellow('Usage: /reject <task-id>'));
        }
        return true;

      case 'help':
        this.showHelp();
        return true;

      case 'config':
        console.log(chalk.cyan('Current configuration:'));
        console.log(JSON.stringify(this.config, null, 2));
        return true;

      default:
        console.log(chalk.yellow(`Unknown command: /${cmd}`));
        return true;
    }
  }

  private async showTasks(): Promise<void> {
    const session = this.agent?.getSession(this.sessionId);
    if (!session || session.tasks.length === 0) {
      console.log(chalk.gray('No tasks yet.'));
      return;
    }

    console.log(chalk.cyan('\n📋 Tasks:'));
    for (const task of session.tasks.slice(-10)) {
      const status = task.status === 'completed' ? chalk.green('✓') :
                    task.status === 'failed' ? chalk.red('✗') :
                    task.status === 'running' ? chalk.blue('◐') :
                    task.status === 'pending' ? chalk.yellow('○') : chalk.gray('⊘');
      
      console.log(`  ${status} ${task.type} (${task.status})`);
      if (task.id) {
        console.log(chalk.gray(`     ID: ${task.id}`));
      }
    }
    console.log('');
  }

  private async approveTask(taskId: string, approved: boolean): Promise<void> {
    if (!this.agent) return;

    const spinner = ora(approved ? 'Approving...' : 'Rejecting...').start();
    
    try {
      await this.agent.approveTask(taskId, approved);
      spinner.stop();
      console.log(chalk.green(approved ? '✅ Task approved' : '❌ Task rejected'));
    } catch (error) {
      spinner.stop();
      console.log(chalk.red('Error:'), error);
    }
  }

  private showHelp(): void {
    console.log(chalk.cyan('\n📖 Available Commands:\n'));
    console.log('  /quit, /exit    - Exit the application');
    console.log('  /clear          - Clear the screen');
    console.log('  /tasks          - Show recent tasks');
    console.log('  /approve <id>   - Approve a pending task');
    console.log('  /reject <id>    - Reject a pending task');
    console.log('  /config         - Show current configuration');
    console.log('  /help           - Show this help message\n');
  }

  private async loadConfig(): Promise<void> {
    try {
      const configPath = path.join(os.homedir(), '.openhand', 'config.json');
      const data = await fs.readFile(configPath, 'utf-8');
      const saved = JSON.parse(data);
      this.config = { ...this.config, ...saved };
    } catch (error) {
      // 使用默认配置
    }
  }

  private getDefaultConfig(): Config {
    return {
      llm: {
        provider: 'openai',
        model: 'gpt-4',
        apiKey: process.env.OPENAI_API_KEY || '',
        temperature: 0.7,
        maxTokens: 2000
      },
      agent: {
        requireApprovalFor: ['shell_exec', 'file_write']
      }
    };
  }
}