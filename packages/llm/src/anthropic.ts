/**
 * @module @openhand/llm/anthropic
 *
 * Provider for Anthropic's Messages API (`POST /v1/messages`). Translates
 * `ChatMessage[]` into the `system` + `messages` shape Anthropic expects, and
 * normalises tool calls back into the cross-provider `ToolCall[]` shape.
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

export interface AnthropicProviderOptions {
  /** API key. Required unless `fetchImpl` is stubbed in tests. */
  apiKey?: string;
  /** Defaults to the public Anthropic endpoint. */
  baseUrl?: string;
  /** Wallclock timeout per request, in ms. */
  timeoutMs?: number;
  /** Inject a custom fetch (e.g. for testing). */
  fetchImpl?: typeof fetch;
  /** Anthropic API version header. */
  apiVersion?: string;
  /** Extra headers. */
  headers?: Record<string, string>;
}

/**
 * Anthropic `POST /v1/messages` provider.
 *
 * Anthropic's wire format differs from OpenAI in two ways that matter:
 *
 *   1. The first `system` message is hoisted into a top-level `system` field,
 *      not kept inline in `messages`.
 *   2. Content is typed (`text`, `tool_use`, `tool_result`) rather than a
 *      plain string. We flatten on the way out.
 *
 * We deliberately implement this as a narrow bridge on top of fetch. No SDK,
 * no retry, no tokenization — the `LLMClient` decorator layer handles those.
 */
export class AnthropicProvider implements LLMProvider {
  readonly info: LLMProviderInfo = {
    id: 'anthropic',
    label: 'Anthropic Messages',
    supportsTools: true,
    supportsStreaming: true,
  };

  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly apiVersion: string;
  private readonly headers: Record<string, string>;

  constructor(opts: AnthropicProviderOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? 'https://api.anthropic.com/v1').replace(/\/+$/, '');
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.fetchImpl = opts.fetchImpl ?? ((...args) => globalThis.fetch(...args));
    this.apiVersion = opts.apiVersion ?? '2023-06-01';
    this.headers = opts.headers ?? {};
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    const body = this.buildBody(request, false);
    const res = await this.callRaw(body);

    if (!res.ok) {
      const text = await safeText(res);
      throw new LLMError({
        provider: 'anthropic',
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
        provider: 'anthropic',
        code: 'bad_json',
        message: `invalid JSON from provider: ${(err as Error).message}`,
      });
    }

    const content = Array.isArray(parsed?.content) ? parsed.content : [];
    let text = '';
    const toolCalls: ToolCall[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text' && typeof block.text === 'string') {
        text += block.text;
      } else if (block.type === 'tool_use' && typeof block.name === 'string') {
        toolCalls.push({
          id: typeof block.id === 'string' ? block.id : '',
          name: block.name,
          argumentsJson: JSON.stringify(block.input ?? {}),
        });
      }
    }

    const response: CompletionResponse = {
      id: String(parsed?.id ?? ''),
      model: String(parsed?.model ?? request.model),
      content: text,
      finishReason: this.mapStopReason(parsed?.stop_reason),
    };
    if (toolCalls.length > 0) {
      response.toolCalls = toolCalls;
    }
    if (parsed?.usage) {
      response.usage = {
        promptTokens: Number(parsed.usage.input_tokens ?? 0),
        completionTokens: Number(parsed.usage.output_tokens ?? 0),
        totalTokens:
          Number(parsed.usage.input_tokens ?? 0) +
          Number(parsed.usage.output_tokens ?? 0),
      };
    }
    return response;
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    const body = this.buildBody(request, true);
    const res = await this.callRaw(body);

    if (!res.ok || !res.body) {
      const text = await safeText(res);
      throw new LLMError({
        provider: 'anthropic',
        code: 'http_error',
        status: res.status,
        message: `stream failed: ${res.status} ${text.slice(0, 200)}`,
      });
    }

    const text = await res.text();
    const lines = text.split(/\r?\n/);
    let pendingEvent: string | undefined;
    let finishReason: CompletionResponse['finishReason'] | undefined;
    let inputTokens = 0;
    let outputTokens = 0;

    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith('event:')) {
        pendingEvent = line.slice('event:'.length).trim();
        continue;
      }
      if (!line.startsWith('data:')) continue;
      const payload = line.slice('data:'.length).trim();
      if (payload === '' || payload === '[DONE]') continue;

      let obj: any;
      try {
        obj = JSON.parse(payload);
      } catch {
        continue;
      }

      const evt = obj.type ?? pendingEvent;
      if (evt === 'content_block_delta' && obj.delta?.type === 'text_delta') {
        yield { delta: String(obj.delta.text ?? '') };
      } else if (evt === 'message_delta') {
        if (obj.delta?.stop_reason) {
          finishReason = this.mapStopReason(obj.delta.stop_reason);
        }
        if (obj.usage) {
          outputTokens = Number(obj.usage.output_tokens ?? outputTokens);
        }
      } else if (evt === 'message_start' && obj.message?.usage) {
        inputTokens = Number(obj.message.usage.input_tokens ?? 0);
        outputTokens = Number(obj.message.usage.output_tokens ?? 0);
      } else if (evt === 'message_stop') {
        yield {
          delta: '',
          finishReason: finishReason ?? 'stop',
          usage: {
            promptTokens: inputTokens,
            completionTokens: outputTokens,
            totalTokens: inputTokens + outputTokens,
          },
        };
      }
    }
  }

  // --- internals -----------------------------------------------------------

  private buildBody(request: CompletionRequest, stream: boolean): Record<string, unknown> {
    // Anthropic hoists the first system message into a dedicated field.
    const systemMsgs = request.messages.filter(m => m.role === 'system');
    const convoMsgs = request.messages.filter(m => m.role !== 'system');

    const body: Record<string, unknown> = {
      model: request.model,
      messages: convoMsgs.map(toAnthropicMessage),
      // Anthropic requires `max_tokens`. Default to a reasonable cap.
      max_tokens: request.maxTokens ?? 1024,
      stream,
    };

    if (systemMsgs.length > 0) {
      body.system = systemMsgs.map(m => m.content).join('\n\n');
    }
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.stop && request.stop.length > 0) body.stop_sequences = request.stop;
    if (request.tools && request.tools.length > 0) {
      body.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
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
        'anthropic-version': this.apiVersion,
        ...this.headers,
      };
      if (this.apiKey) headers['x-api-key'] = this.apiKey;

      return await this.fetchImpl(`${this.baseUrl}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  private mapStopReason(raw: unknown): CompletionResponse['finishReason'] {
    switch (raw) {
      case 'end_turn':
      case 'stop_sequence':
        return 'stop';
      case 'max_tokens':
        return 'length';
      case 'tool_use':
        return 'tool_calls';
      default:
        return 'stop';
    }
  }
}

function toAnthropicMessage(m: ChatMessage): Record<string, unknown> {
  // Anthropic only accepts `user` and `assistant` roles in `messages[]`.
  // We map `tool` onto `user` with a `tool_result`-style text block since
  // we don't carry a matching `tool_use_id` in our cross-provider shape.
  const role = m.role === 'assistant' ? 'assistant' : 'user';
  return {
    role,
    content: [{ type: 'text', text: m.content }],
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
