import chalk from 'chalk';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';

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

    // Zero-dep readline-based wizard. We dropped `inquirer` to keep the CLI's
    // require graph importable without it (otherwise every subcommand went
    // through index.ts -> commands/config.ts -> inquirer and crashed for
    // anyone who only installed the production deps).
    const answers = await runSetupWizard();

    config.llm = {
      provider: answers.provider,
      model: answers.model,
      apiKey: answers.apiKey,
      baseUrl: answers.baseUrl,
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

interface WizardAnswers {
  provider: string;
  apiKey?: string;
  model: string;
  baseUrl?: string;
}

const PROVIDER_CHOICES: Array<{ label: string; value: string }> = [
  { label: 'OpenAI', value: 'openai' },
  { label: 'Claude (Anthropic)', value: 'claude' },
  { label: 'Ollama (Local)', value: 'ollama' },
  { label: 'Custom', value: 'custom' },
];

function defaultModelFor(provider: string): string {
  switch (provider) {
    case 'openai':
      return 'gpt-4';
    case 'claude':
      return 'claude-3-opus-20240229';
    case 'ollama':
      return 'llama2';
    default:
      return '';
  }
}

async function runSetupWizard(): Promise<WizardAnswers> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, answer => resolve(answer)));

  try {
    console.log('Choose your LLM provider:');
    PROVIDER_CHOICES.forEach((choice, idx) => {
      console.log(`  ${idx + 1}) ${choice.label}`);
    });
    let provider = 'openai';
    while (true) {
      const raw = (await ask('> ')).trim();
      const idx = Number.parseInt(raw, 10);
      if (Number.isFinite(idx) && idx >= 1 && idx <= PROVIDER_CHOICES.length) {
        provider = PROVIDER_CHOICES[idx - 1]!.value;
        break;
      }
      // Allow typing the value directly too (e.g. "openai") for scripted use.
      const match = PROVIDER_CHOICES.find(c => c.value === raw.toLowerCase());
      if (match) {
        provider = match.value;
        break;
      }
      console.log(chalk.yellow('  Enter 1-4 or one of: openai, claude, ollama, custom'));
    }

    let apiKey: string | undefined;
    if (provider !== 'ollama') {
      apiKey = (await ask('Enter your API key: ')).trim();
    }

    const modelDefault = defaultModelFor(provider);
    const modelRaw = (await ask(`Enter the model name${modelDefault ? ` [${modelDefault}]` : ''}: `)).trim();
    const model = modelRaw || modelDefault;

    let baseUrl: string | undefined;
    if (provider === 'ollama' || provider === 'custom') {
      const raw = (await ask('Enter the API base URL (optional): ')).trim();
      if (raw) baseUrl = raw;
    }

    const out: WizardAnswers = { provider, model };
    if (apiKey !== undefined) out.apiKey = apiKey;
    if (baseUrl !== undefined) out.baseUrl = baseUrl;
    return out;
  } finally {
    rl.close();
  }
}