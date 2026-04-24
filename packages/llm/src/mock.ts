/**
 * @module @openhand/llm/mock
 *
 * In-process provider for tests, demos, and offline development.
 *
 * It never touches the network. By default it returns a canned reply; pass
 * `replies` to pre-script a sequence of answers, or `handler` for full
 * dynamic control (used by `examples/hello-world.ts` so the demo works with
 * zero setup).
 *
 * Not suitable for production — there's no real model behind it.
 */
import type { LLMProvider } from './provider';
import type {
  CompletionRequest,
  CompletionResponse,
  LLMProviderInfo,
  StreamChunk,
} from './types';

export interface MockProviderOptions {
  /** Canned single reply. Ignored if `replies` or `handler` is set. */
  reply?: string;
  /** Ordered queue of replies. Wraps around once exhausted. */
  replies?: readonly string[];
  /** Full custom handler. Wins over `reply`/`replies`. */
  handler?: (req: CompletionRequest) => string | Promise<string>;
  /** Label shown via `info.label`. */
  label?: string;
  /** Stable id for `info.id`. Defaults to `mock`. */
  id?: string;
  /** Artificial latency per call, in ms. Zero by default. */
  latencyMs?: number;
  /** Characters per streaming chunk. Default 4. */
  chunkSize?: number;
}

/**
 * Deterministic, offline-first `LLMProvider`.
 *
 * Example:
 * ```ts
 * const mock = new MockProvider({ reply: 'Hello from OpenHand.' });
 * const res = await mock.complete({ model: 'mock', messages: [] });
 * // res.content === 'Hello from OpenHand.'
 * ```
 */
export class MockProvider implements LLMProvider {
  readonly info: LLMProviderInfo;
  private readonly opts: MockProviderOptions;
  private cursor = 0;
  private callCount = 0;

  constructor(opts: MockProviderOptions = {}) {
    this.opts = opts;
    this.info = {
      id: opts.id ?? 'mock',
      label: opts.label ?? 'Mock LLM (offline)',
      supportsTools: false,
      supportsStreaming: true,
    };
  }

  /** Number of `complete` / `stream` calls since construction. */
  get calls(): number {
    return this.callCount;
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    this.callCount++;
    const content = await this.nextReply(request);
    if (this.opts.latencyMs && this.opts.latencyMs > 0) {
      await sleep(this.opts.latencyMs);
    }
    const prompt = approxTokenCount(
      request.messages.map(m => m.content).join('\n'),
    );
    const completion = approxTokenCount(content);
    return {
      id: `mock-${Date.now()}-${this.callCount}`,
      model: request.model,
      content,
      finishReason: 'stop',
      usage: {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
      },
    };
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    this.callCount++;
    const text = await this.nextReply(request);
    const size = Math.max(1, this.opts.chunkSize ?? 4);
    for (let i = 0; i < text.length; i += size) {
      const delta = text.slice(i, i + size);
      yield { delta };
      if (this.opts.latencyMs && this.opts.latencyMs > 0) {
        await sleep(this.opts.latencyMs);
      }
    }
    const prompt = approxTokenCount(
      request.messages.map(m => m.content).join('\n'),
    );
    const completion = approxTokenCount(text);
    yield {
      delta: '',
      finishReason: 'stop',
      usage: {
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
      },
    };
  }

  private async nextReply(req: CompletionRequest): Promise<string> {
    if (this.opts.handler) {
      return await this.opts.handler(req);
    }
    if (this.opts.replies && this.opts.replies.length > 0) {
      const idx = this.cursor % this.opts.replies.length;
      this.cursor++;
      return this.opts.replies[idx] ?? '';
    }
    return this.opts.reply ?? 'Hello from the OpenHand mock provider.';
  }
}

function approxTokenCount(s: string): number {
  // Cheap heuristic — good enough for tests that assert "usage was recorded".
  if (!s) return 0;
  return Math.max(1, Math.ceil(s.length / 4));
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => {
    const t = setTimeout(resolve, ms);
    t.unref?.();
  });
}
