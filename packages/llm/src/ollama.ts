/**
 * @module @openhand/llm/ollama
 *
 * Provider for a local Ollama daemon (default `http://localhost:11434`).
 * Hits the native `/api/chat` endpoint and consumes its newline-delimited
 * JSON stream. No vendor SDK; just `fetch` + a small ndjson reader.
 *
 * Recommended for zero-config local development — see
 * `cookbook/01-hello-world.md`.
 */
import type { LLMProvider } from './provider';
import {
  LLMError,
  type ChatMessage,
  type CompletionRequest,
  type CompletionResponse,
  type LLMProviderInfo,
  type StreamChunk,
} from './types';

export interface OllamaProviderOptions {
  /** Ollama HTTP endpoint. Default: http://localhost:11434 */
  baseUrl?: string;
  /** Wallclock timeout per request, in ms. */
  timeoutMs?: number;
  /** Inject a custom fetch (e.g. for testing). */
  fetchImpl?: typeof fetch;
  /** Extra headers. */
  headers?: Record<string, string>;
}

/**
 * Ollama provider using the native `/api/chat` endpoint.
 *
 * Why not just use OpenAIProvider against Ollama's `/v1` shim? Because the
 * native endpoint carries per-message `eval_count` / `prompt_eval_count`
 * fields that are more accurate than the shim, and it reports
 * `done_reason` per chunk which lets us terminate streams cleanly without
 * guessing at SSE format.
 */
export class OllamaProvider implements LLMProvider {
  readonly info: LLMProviderInfo = {
    id: 'ollama',
    label: 'Ollama (local)',
    supportsTools: true, // supported by newer models, gated on model caps
    supportsStreaming: true,
  };

  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly headers: Record<string, string>;

  constructor(opts: OllamaProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'http://localhost:11434').replace(/\/+$/, '');
    this.timeoutMs = opts.timeoutMs ?? 60_000; // local models can be slower
    this.fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.headers = opts.headers ?? {};
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildBody(request, false);
    const res = await this.callRaw(body);

    if (!res.ok) {
      const text = await safeText(res);
      throw new LLMError({
        provider: 'ollama',
        code: 'http_error',
        status: res.status,
        message: `HTTP ${res.status}: ${text.slice(0, 500)}`,
      });
    }

    let parsed: any;
    try {
      parsed = await res.json();
    } catch (err) {
      throw new LLMError({
        provider: 'ollama',
        code: 'bad_json',
        message: `invalid JSON from provider: ${(err as Error).message}`,
      });
    }

    const message = parsed?.message ?? {};
    const toolCalls = this.parseToolCalls(message.tool_calls);
    const promptTokens = Number(parsed?.prompt_eval_count ?? 0);
    const completionTokens = Number(parsed?.eval_count ?? 0);

    return {
      id: String(parsed?.created_at ?? ''),
      model: String(parsed?.model ?? request.model),
      content: typeof message.content === 'string' ? message.content : '',
      toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
      finishReason: this.mapDoneReason(parsed?.done_reason, toolCalls.length > 0),
      usage:
        promptTokens > 0 || completionTokens > 0
          ? {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
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
        provider: 'ollama',
        code: 'http_error',
        status: res.status,
        message: `stream failed: ${res.status} ${text.slice(0, 200)}`,
      });
    }

    // Ollama streams newline-delimited JSON (not SSE).
    const text = await res.text();
    const lines = text.split(/\r?\n/);
    for (const raw of lines) {
      const line = raw.trim();
      if (line === '') continue;
      let obj: any;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      const deltaText = obj?.message?.content ?? '';
      if (obj.done === true) {
        const promptTokens = Number(obj.prompt_eval_count ?? 0);
        const completionTokens = Number(obj.eval_count ?? 0);
        yield {
          delta: typeof deltaText === 'string' ? deltaText : '',
          finishReason: this.mapDoneReason(obj.done_reason, false),
          usage: {
            promptTokens,
            completionTokens,
            totalTokens: promptTokens + completionTokens,
          },
        };
      } else {
        yield { delta: typeof deltaText === 'string' ? deltaText : '' };
      }
    }
  }

  // --- internals -----------------------------------------------------------

  private buildBody(request: CompletionRequest, stream: boolean): Record<string, unknown> {
    const opts: Record<string, unknown> = {};
    if (request.temperature !== undefined) opts.temperature = request.temperature;
    if (request.maxTokens !== undefined) opts.num_predict = request.maxTokens;
    if (request.stop && request.stop.length > 0) opts.stop = request.stop;

    const body: Record<string, unknown> = {
      model: request.model,
      messages: request.messages.map(toOllamaMessage),
      stream,
    };
    if (Object.keys(opts).length > 0) body.options = opts;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        },
      }));
    }
    if (request.extra) {
      for (const [k, v] of Object.entries(request.extra)) {
        if (k === 'signal') continue;
        body[k] = v;
      }
    }
    return body;
  }

  private async callRaw(body: Record<string, unknown>): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        ...this.headers,
      };
      return await this.fetchImpl(`${this.baseUrl}/api/chat`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private parseToolCalls(raw: unknown): { id: string; name: string; argumentsJson: string }[] {
    if (!Array.isArray(raw)) return [];
    const out: { id: string; name: string; argumentsJson: string }[] = [];
    for (const r of raw) {
      if (!r || typeof r !== 'object') continue;
      const fn = (r as any).function ?? {};
      if (typeof fn.name !== 'string') continue;
      const args = fn.arguments;
      out.push({
        id: '',
        name: fn.name,
        argumentsJson: typeof args === 'string' ? args : JSON.stringify(args ?? {}),
      });
    }
    return out;
  }

  private mapDoneReason(
    raw: unknown,
    hasToolCalls: boolean,
  ): CompletionResponse['finishReason'] {
    if (hasToolCalls) return 'tool_calls';
    switch (raw) {
      case 'stop':
        return 'stop';
      case 'length':
        return 'length';
      default:
        return 'stop';
    }
  }
}

function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  const role = m.role === 'tool' ? 'tool' : m.role;
  const out: Record<string, unknown> = { role, content: m.content };
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
