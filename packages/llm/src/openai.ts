/**
 * @module @openhand/llm/openai
 *
 * Thin `fetch` wrapper around `POST /v1/chat/completions`. Speaks the OpenAI
 * Chat Completions wire format, which is the de-facto lingua franca for
 * compatible servers (vLLM, LM Studio, llama.cpp, Together, Groq, …).
 *
 * Override `baseUrl` to point at any of those — see
 * `cookbook/03-custom-llm-provider.md`.
 */
import type { LLMProvider } from './provider';
import {
  LLMError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResponse,
  type LLMProviderInfo,
  type StreamChunk,
  type ToolCall,
} from './types';

export interface OpenAIProviderOptions {
  /** API key. Required unless `fetchImpl` is stubbed in tests. */
  apiKey?: string;
  /** Defaults to the public OpenAI endpoint. Override for Azure / Ollama. */
  baseUrl?: string;
  /** Wallclock timeout per request, in ms. */
  timeoutMs?: number;
  /** Inject a custom fetch (e.g. for testing). */
  fetchImpl?: typeof fetch;
  /** Extra headers (e.g. `OpenAI-Organization`). */
  headers?: Record<string, string>;
}

/**
 * Minimal OpenAI-compatible provider.
 *
 * This is intentionally a **reference / placeholder** implementation: it
 * speaks the `/v1/chat/completions` shape used by OpenAI, Ollama, vLLM,
 * LiteLLM, and most local gateways. It does not pull in the OpenAI SDK, it
 * does not retry, and it does not tokenize — all that is left to a richer
 * provider if needed.
 */
export class OpenAIProvider implements LLMProvider {
  readonly info: LLMProviderInfo = {
    id: 'openai',
    label: 'OpenAI-compatible',
    supportsTools: true,
    supportsStreaming: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(opts: OpenAIProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.headers = opts.headers ?? {};
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildBody(request, false);
    const res = await this.callJson(body);

    const choice = res?.choices?.[0];
    if (!choice) {
      throw new LLMError({
        provider: 'openai',
        code: 'no_choice',
        message: 'Provider returned no choices',
      });
    }

    const message = choice.message ?? {};
    const toolCalls = this.parseToolCalls(message.tool_calls);

    return {
      id: String(res.id ?? ''),
      model: String(res.model ?? request.model),
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapFinishReason(choice.finish_reason),
      usage: res.usage
        ? {
            promptTokens: Number(res.usage.prompt_tokens ?? 0),
            completionTokens: Number(res.usage.completion_tokens ?? 0),
            totalTokens: Number(res.usage.total_tokens ?? 0),
          }
        : undefined,
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const body = this.buildBody(request, true);
    const res = await this.callRaw(body);

    if (!res.ok || !res.body) {
      const text = await safeText(res);
      throw new LLMError({
        provider: 'openai',
        code: 'http_error',
        status: res.status,
        message: `stream failed: ${res.status} ${text.slice(0, 200)}`,
      });
    }

    // For test convenience, parse the whole body as SSE text. Real usage
    // would use a proper SSE reader; we keep this tiny.
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (payload === '' || payload === '[DONE]') continue;
      let obj: any;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = obj?.choices?.[0];
      const delta = choice?.delta?.content ?? '';
      const finishRaw = choice?.finish_reason;
      yield {
        delta: typeof delta === 'string' ? delta : '',
        finishReason: finishRaw ? this.mapFinishReason(finishRaw) : undefined,
        usage: obj.usage
          ? {
              promptTokens: Number(obj.usage.prompt_tokens ?? 0),
              completionTokens: Number(obj.usage.completion_tokens ?? 0),
              totalTokens: Number(obj.usage.total_tokens ?? 0),
            }
          : undefined,
      };
    }
  }

  // --- internals -----------------------------------------------------------

  private buildBody(request: CompletionRequest, stream: boolean): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map(toWireMessage),
      ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
      ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      ...(request.stop ? { stop: request.stop } : {}),
      ...(request.tools
        ? {
            tools: request.tools.map(t => ({
              type: 'function',
              function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters,
              },
            })),
          }
        : {}),
      stream,
      ...(request.extra ?? {}),
    };
  }

  private async callJson(body: Record<string, unknown>): Promise<any> {
    const res = await this.callRaw(body);
    if (!res.ok) {
      const text = await safeText(res);
      throw new LLMError({
        provider: 'openai',
        code: 'http_error',
        status: res.status,
        message: `HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
    }
    try {
      return await res.json();
    } catch (err) {
      throw new LLMError({
        provider: 'openai',
        code: 'bad_json',
        message: `invalid JSON from provider: ${(err as Error).message}`,
      });
    }
  }

  private async callRaw(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...this.headers,
      };
      if (this.apiKey) headers['authorization'] = `Bearer ${this.apiKey}`;

      return await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private parseToolCalls(raw: unknown): ToolCall[] {
    if (!Array.isArray(raw)) return [];
    const out: ToolCall[] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const fn = (r as any).function ?? {};
      const id = (r as any).id;
      if (typeof fn.name !== 'string') continue;
      out.push({
        id: typeof id === 'string' ? id : '',
        name: fn.name,
        argumentsJson: typeof fn.arguments === 'string' ? fn.arguments : JSON.stringify(fn.arguments ?? {}),
      });
    }
    return out;
  }

  private mapFinishReason(raw: unknown): CompletionResponse['finishReason'] {
    switch (raw) {
      case 'stop':
      case 'length':
      case 'tool_calls':
        return raw;
      case 'function_call':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

function toWireMessage(m: ChatMessage): Record<string, unknown> {
  const out: Record<string, unknown> = { role: m.role, content: m.content };
  if (m.name) out.name = m.name;
  return out;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
