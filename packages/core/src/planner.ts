import { LLMConfig, Tool } from './types';

interface TaskPlan {
  tasks: { type: string; params: Record<string, any> }[];
  reasoning: string;
}

export interface LLMUsage {
  /** Total prompt tokens reported by the provider (0 if unknown). */
  promptTokens: number;
  /** Total completion tokens reported by the provider (0 if unknown). */
  completionTokens: number;
  /** Number of provider HTTP calls issued (includes retries). */
  calls: number;
}

/** Options specific to one LLM invocation. */
export interface LLMCallOptions {
  /** Per-request timeout in ms (default 60_000). */
  timeoutMs?: number;
  /** Max retries on transient errors (default 2). */
  maxRetries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Planner: asks the configured LLM to break a user request into a list
 * of tool calls. Handles provider differences, retries, timeouts and
 * exposes aggregate token usage via `getUsage()`.
 */
export class TaskPlanner {
  private llmConfig: LLMConfig;
  private usage: LLMUsage = { promptTokens: 0, completionTokens: 0, calls: 0 };

  constructor(llmConfig: LLMConfig) {
    this.llmConfig = llmConfig;
  }

  getUsage(): LLMUsage {
    return { ...this.usage };
  }

  resetUsage(): void {
    this.usage = { promptTokens: 0, completionTokens: 0, calls: 0 };
  }

  async plan(
    userInput: string,
    context: Record<string, any>,
    availableTools: Tool[],
    callOptions: LLMCallOptions = {},
  ): Promise<TaskPlan> {
    const systemPrompt = this.buildSystemPrompt(availableTools);
    const userPrompt = this.buildUserPrompt(userInput, context);

    try {
      const response = await this.callLLM(systemPrompt, userPrompt, callOptions);
      return this.parseResponse(response);
    } catch (error) {
      return {
        tasks: [
          {
            type: 'direct_response',
            params: { message: userInput },
          },
        ],
        reasoning: `Fallback to direct response due to LLM error: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private buildSystemPrompt(tools: Tool[]): string {
    const toolDescriptions = tools
      .map(tool => {
        const params = tool.parameters
          .map(
            p =>
              `${p.name}: ${p.type}${p.required ? ' (required)' : ''} - ${p.description}`,
          )
          .join('\n  ');
        return `- ${tool.name}: ${tool.description}\n  Parameters:\n  ${params || '  None'}`;
      })
      .join('\n\n');

    return `You are a task planning AI. Given a user request, break it down into a sequence of tool calls.

Available Tools:
${toolDescriptions}

Respond in JSON format:
{
  "reasoning": "Your step-by-step thinking process",
  "tasks": [
    {
      "type": "tool_name",
      "params": { "param1": "value1", ... }
    }
  ]
}

Guidelines:
1. Break complex tasks into simple steps
2. Use appropriate tools for each step
3. Provide clear parameter values
4. If no tools are needed, use "direct_response" type`;
  }

  private buildUserPrompt(input: string, context: Record<string, any>): string {
    const contextStr =
      Object.keys(context).length > 0
        ? `\n\nContext:\n${JSON.stringify(context, null, 2)}`
        : '';
    return `User Request: ${input}${contextStr}`;
  }

  private async callLLM(
    systemPrompt: string,
    userPrompt: string,
    opts: LLMCallOptions,
  ): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const maxRetries = opts.maxRetries ?? 2;

    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        return await this.invokeProvider(systemPrompt, userPrompt, timeoutMs);
      } catch (err) {
        lastErr = err;
        if (!this.isRetriable(err) || attempt === maxRetries) break;
        // Exponential backoff with jitter: 500ms, 1000ms, 2000ms...
        const base = 500 * 2 ** attempt;
        const jitter = Math.floor(Math.random() * 250);
        await sleep(base + jitter);
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
  }

  private isRetriable(err: unknown): boolean {
    if (err instanceof Error) {
      const msg = err.message.toLowerCase();
      // Network-level transients
      if (msg.includes('timeout') || msg.includes('abort')) return true;
      if (msg.includes('econnreset') || msg.includes('enotfound')) return true;
      // Provider 5xx / 429
      const m = msg.match(/\b(5\d\d|429)\b/);
      if (m) return true;
    }
    return false;
  }

  private async invokeProvider(
    systemPrompt: string,
    userPrompt: string,
    timeoutMs: number,
  ): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      switch (this.llmConfig.provider) {
        case 'openai':
          return await this.callOpenAI(systemPrompt, userPrompt, controller.signal);
        case 'claude':
          return await this.callClaude(systemPrompt, userPrompt, controller.signal);
        case 'ollama':
          return await this.callOllama(systemPrompt, userPrompt, controller.signal);
        default:
          return await this.callCustom(systemPrompt, userPrompt, controller.signal);
      }
    } finally {
      clearTimeout(timer);
    }
  }

  private recordUsage(data: any): void {
    this.usage.calls += 1;
    const u = data?.usage;
    if (!u) return;
    // OpenAI/compat: prompt_tokens / completion_tokens
    if (typeof u.prompt_tokens === 'number') this.usage.promptTokens += u.prompt_tokens;
    if (typeof u.completion_tokens === 'number')
      this.usage.completionTokens += u.completion_tokens;
    // Anthropic: input_tokens / output_tokens
    if (typeof u.input_tokens === 'number') this.usage.promptTokens += u.input_tokens;
    if (typeof u.output_tokens === 'number') this.usage.completionTokens += u.output_tokens;
  }

  private async callOpenAI(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.llmConfig.apiKey ?? ''}`,
      },
      body: JSON.stringify({
        model: this.llmConfig.model || 'gpt-4',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.llmConfig.temperature ?? 0.7,
        max_tokens: this.llmConfig.maxTokens ?? 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    this.recordUsage(data);
    return data.choices?.[0]?.message?.content ?? '';
  }

  private async callClaude(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.llmConfig.apiKey ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: this.llmConfig.model || 'claude-3-opus-20240229',
        max_tokens: this.llmConfig.maxTokens ?? 2000,
        temperature: this.llmConfig.temperature ?? 0.7,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    if (!response.ok) {
      throw new Error(`Claude API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    this.recordUsage(data);
    return data.content?.[0]?.text ?? '';
  }

  private async callOllama(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const baseUrl = this.llmConfig.baseUrl || 'http://localhost:11434';
    const response = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.llmConfig.model || 'llama2',
        prompt: `${systemPrompt}\n\n${userPrompt}`,
        stream: false,
        options: { temperature: this.llmConfig.temperature ?? 0.7 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    this.recordUsage(data);
    return data.response ?? '';
  }

  private async callCustom(
    systemPrompt: string,
    userPrompt: string,
    signal: AbortSignal,
  ): Promise<string> {
    const baseUrl = this.llmConfig.baseUrl;
    if (!baseUrl) {
      throw new Error('Custom provider requires baseUrl');
    }

    const response = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        ...(this.llmConfig.apiKey
          ? { Authorization: `Bearer ${this.llmConfig.apiKey}` }
          : {}),
      },
      body: JSON.stringify({
        model: this.llmConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: this.llmConfig.temperature ?? 0.7,
        max_tokens: this.llmConfig.maxTokens ?? 2000,
      }),
    });

    if (!response.ok) {
      throw new Error(`Custom API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    this.recordUsage(data);
    return data.choices?.[0]?.message?.content || data.response || '';
  }

  /**
   * Parse the LLM's response as JSON. The model sometimes wraps it in
   * markdown code fences; we strip them before parsing.
   */
  private parseResponse(response: string): TaskPlan {
    const stripped = response
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/```\s*$/i, '')
      .trim();

    const candidates = [stripped];
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) candidates.push(jsonMatch[0]);

    for (const candidate of candidates) {
      try {
        const parsed = JSON.parse(candidate);
        if (parsed && typeof parsed === 'object') {
          return {
            reasoning: typeof parsed.reasoning === 'string'
              ? parsed.reasoning
              : 'No reasoning provided',
            tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          };
        }
      } catch {
        // try next candidate
      }
    }

    return {
      reasoning: 'Failed to parse plan, using fallback',
      tasks: [
        {
          type: 'direct_response',
          params: { message: response },
        },
      ],
    };
  }
}
