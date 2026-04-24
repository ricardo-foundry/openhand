import type {
  CompletionRequest,
  CompletionResponse,
  LLMProviderInfo,
  StreamChunk,
} from './types';

/**
 * The single interface every LLM backend must implement.
 *
 * Keep this small. If a provider needs special knobs, put them in
 * `CompletionRequest.extra` — do not extend this interface.
 */
export interface LLMProvider {
  readonly info: LLMProviderInfo;

  /**
   * Fetch a complete response. Providers that only support streaming should
   * accumulate chunks and resolve with the final response.
   */
  complete(request: CompletionRequest): Promise<CompletionResponse>;

  /**
   * Stream tokens as they arrive. The final chunk MUST include
   * `finishReason`. Implementations should handle cancellation via
   * `AbortSignal` passed through `request.extra.signal` if supplied.
   */
  stream(request: CompletionRequest): AsyncIterable<StreamChunk>;
}
