import chalk from 'chalk';
import inquirer from 'inquirer';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface ConfigOptions {
  setup?: boolean;
  list?: boolean;
  llmProvider?: string;
  llmModel?: string;
  llmApiKey?: string;
}

export async function configCommand(options: ConfigOptions): Promise<void> {
  const configDir = path.join(os.homedir(), '.openhand');
  const configPath = path.join(configDir, 'config.json');

  // 确保配置目录存在
  await fs.mkdir(configDir, { recursive: true });

  let config: any = {};
  try {
    const data = await fs.readFile(configPath, 'utf-8');
    config = JSON.parse(data);
  } catch (error) {
    // 配置文件不存在
  }

  if (options.setup || (!config.llm?.apiKey && !options.list)) {
    console.log(chalk.cyan('🔧 OpenHand Initial Setup\n'));
    
    const answers = await inquirer.prompt([
      {
        type: 'list',
        name: 'provider',
        message: 'Choose your LLM provider:',
        choices: [
          { name: 'OpenAI', value: 'openai' },
          { name: 'Claude (Anthropic)', value: 'claude' },
          { name: 'Ollama (Local)', value: 'ollama' },
          { name: 'Custom', value: 'custom' }
        ]
      },
      {
        type: 'input',
        name: 'apiKey',
        message: 'Enter your API key:',
        when: (answers) => answers.provider !== 'ollama',
        mask: '*'
      },
      {
        type: 'input',
        name: 'model',
        message: 'Enter the model name:',
        default: (answers: any) => {
          switch (answers.provider) {
            case 'openai': return 'gpt-4';
            case 'claude': return 'claude-3-opus-20240229';
            case 'ollama': return 'llama2';
            default: return '';
          }
        }
      },
      {
        type: 'input',
        name: 'baseUrl',
        message: 'Enter the API base URL (optional):',
        when: (answers) => answers.provider === 'ollama' || answers.provider === 'custom'
      }
    ]);

    config.llm = {
      provider: answers.provider,
      model: answers.model,
      apiKey: answers.apiKey,
      baseUrl: answers.baseUrl
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green('\n✅ Configuration saved!'));
    return;
  }

  if (options.list) {
    console.log(chalk.cyan('📋 Current Configuration:\n'));
    console.log(JSON.stringify(config, null, 2));
    return;
  }

  // 更新单个配置项
  if (options.llmProvider) {
    config.llm = config.llm || {};
    config.llm.provider = options.llmProvider;
  }
  if (options.llmModel) {
    config.llm = config.llm || {};
    config.llm.model = options.llmModel;
  }
  if (options.llmApiKey) {
    config.llm = config.llm || {};
    config.llm.apiKey = options.llmApiKey;
  }

  await fs.writeFile(configPath, JSON.stringify(config, null, 2));
  console.log(chalk.green('✅ Configuration updated!'));
}