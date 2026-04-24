/**
 * Shared types for `@openhand/llm`.
 *
 * The goal of this package is to keep `packages/core` free of any vendor SDK.
 * Every provider (OpenAI, Anthropic, Ollama, custom) implements `LLMProvider`
 * so core never imports a specific HTTP client.
 */

export type Role = 'system' | 'user' | 'assistant' | 'tool';

export interface ChatMessage {
  role: Role;
  content: string;
  /** Optional tool-call name when role is `tool`. */
  name?: string;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  /** 0..2. Provider may clamp. */
  temperature?: number;
  /** Hard cap on output tokens. */
  maxTokens?: number;
  /** Stop sequences. */
  stop?: string[];
  /** Tool / function schemas for providers that support it. */
  tools?: ToolSchema[];
  /** Provider-specific pass-through. Do not rely on this cross-provider. */
  extra?: Record<string, unknown>;
}

export interface ToolSchema {
  name: string;
  description: string;
  /** JSON-Schema-ish parameter schema. */
  parameters: Record<string, unknown>;
}

export interface CompletionResponse {
  id: string;
  model: string;
  content: string;
  /** Populated when the model asked to call a tool. */
  toolCalls?: ToolCall[];
  /** Why the model stopped. `stop`, `length`, `tool_calls`, `error`. */
  finishReason: 'stop' | 'length' | 'tool_calls' | 'error';
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON string as emitted by the model. Callers parse + validate. */
  argumentsJson: string;
}

export interface StreamChunk {
  /** Incremental text. Empty string is valid for control-only frames. */
  delta: string;
  /** Present only on the terminal chunk. */
  finishReason?: CompletionResponse['finishReason'];
  /** Present only on the terminal chunk. */
  usage?: CompletionResponse['usage'];
}

export interface LLMProviderInfo {
  /** Stable identifier, e.g. `openai`, `anthropic`, `ollama`. */
  id: string;
  /** Human-readable label. */
  label: string;
  /** Supports tool calling natively? */
  supportsTools: boolean;
  /** Supports server-sent streaming? */
  supportsStreaming: boolean;
}

export class LLMError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly provider: string;

  constructor(params: { message: string; code: string; provider: string; status?: number }) {
    super(params.message);
    this.name = 'LLMError';
    this.code = params.code;
    this.provider = params.provider;
    if (params.status !== undefined) {
      this.status = params.status;
    }
  }
}
