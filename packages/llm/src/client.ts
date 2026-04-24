import type { LLMProvider } from './provider';
import {
  LLMError,
  type CompletionRequest,
  type CompletionResponse,
  type LLMProviderInfo,
  type StreamChunk,
} from './types';

export interface RetryPolicy {
  /** Maximum attempts (including the first one). Minimum 1. */
  maxAttempts: number;
  /** Initial backoff in ms. Applied as `initialDelayMs * 2^(attempt-1)`. */
  initialDelayMs: number;
  /** Cap the backoff so exponential growth doesn't blow past it. */
  maxDelayMs: number;
  /**
   * Whether to retry. Defaults to retrying on network errors and HTTP 5xx /
   * 408 / 429. Callers may override with a custom predicate.
   */
  shouldRetry?: (err: unknown) => boolean;
  /** Replace `Math.random` for deterministic tests. */
  random?: () => number;
  /** Replace `setTimeout` for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface RateLimitPolicy {
  /** Maximum requests per `windowMs`. */
  maxRequests: number;
  /** Window size in ms. Default: 60_000 (per minute). */
  windowMs?: number;
  /** Replace `Date.now` for deterministic tests. */
  now?: () => number;
  /** Replace `setTimeout` for deterministic tests. */
  sleep?: (ms: number) => Promise<void>;
}

export interface CostTracker {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  /**
   * Record a usage event. Called by the client after every completion and
   * after the terminal chunk of every stream.
   */
  record(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void;
  /** Reset the accumulator. */
  reset(): void;
}

/**
 * Default cost tracker. Thread-safe under Node's single-threaded loop.
 * For multi-process setups, swap it with a shared-store implementation.
 */
export class InMemoryCostTracker implements CostTracker {
  promptTokens = 0;
  completionTokens = 0;
  totalTokens = 0;

  record(usage: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }): void {
    this.promptTokens += usage.promptTokens;
    this.completionTokens += usage.completionTokens;
    this.totalTokens += usage.totalTokens;
  }

  reset(): void {
    this.promptTokens = 0;
    this.completionTokens = 0;
    this.totalTokens = 0;
  }
}

export interface LLMClientOptions {
  /** Wrapped provider. */
  provider: LLMProvider;
  /** Retry policy. Default: 3 attempts, 500ms initial, 8s cap. */
  retry?: Partial<RetryPolicy>;
  /** Rate limit. Omit to disable. */
  rateLimit?: RateLimitPolicy;
  /** Per-call wallclock timeout in ms. Cancels via AbortController. */
  timeoutMs?: number;
  /** Cost tracker. Defaults to a fresh `InMemoryCostTracker`. */
  costTracker?: CostTracker;
}

/**
 * Decorator around any `LLMProvider` that adds:
 *
 *   - retry with exponential backoff (+ jitter) on transient errors
 *   - per-call timeouts via AbortController
 *   - token-bucket rate limiting
 *   - usage accumulation into a `CostTracker`
 *
 * None of this lives in core or in the individual providers, so a caller
 * can plug in a provider that is already wrapped by their own client
 * stack without losing any behavior.
 *
 * **Scope:** the rate limiter and cost tracker are in-process / per-instance.
 * For multi-pod deployments where one quota must be shared across replicas,
 * swap `TokenBucket` for a Redis-backed bucket and pass a `costTracker`
 * implementation that writes to your shared store. See README §
 * "LLMClient — scope and limits" for the wiring sketch.
 */
export class LLMClient implements LLMProvider {
  readonly info: LLMProviderInfo;
  readonly costTracker: CostTracker;
  private readonly provider: LLMProvider;
  private readonly retry: RetryPolicy;
  private readonly timeoutMs: number | undefined;
  private readonly bucket: TokenBucket | undefined;

  constructor(opts: LLMClientOptions) {
    this.provider = opts.provider;
    this.info = opts.provider.info;
    this.costTracker = opts.costTracker ?? new InMemoryCostTracker();
    this.timeoutMs = opts.timeoutMs;
    this.retry = {
      maxAttempts: opts.retry?.maxAttempts ?? 3,
      initialDelayMs: opts.retry?.initialDelayMs ?? 500,
      maxDelayMs: opts.retry?.maxDelayMs ?? 8_000,
      shouldRetry: opts.retry?.shouldRetry ?? defaultShouldRetry,
      random: opts.retry?.random ?? Math.random,
      sleep: opts.retry?.sleep ?? defaultSleep,
    };
    if (opts.rateLimit) {
      this.bucket = new TokenBucket(opts.rateLimit);
    }
  }

  async complete(request: CompletionRequest): Promise<CompletionResponse> {
    return this.withPolicies(async signal => {
      const res = await this.provider.complete(injectSignal(request, signal));
      if (res.usage) this.costTracker.record(res.usage);
      return res;
    });
  }

  async *stream(request: CompletionRequest): AsyncIterable<StreamChunk> {
    // Streaming is typically not retried (would produce duplicate deltas),
    // but we still enforce rate limit + timeout.
    if (this.bucket) await this.bucket.take();
    const signal = this.startTimeout();
    try {
      for await (const chunk of this.provider.stream(injectSignal(request, signal.signal))) {
        if (chunk.finishReason && chunk.usage) {
          this.costTracker.record(chunk.usage);
        }
        yield chunk;
      }
    } finally {
      signal.dispose();
    }
  }

  // --- internals -----------------------------------------------------------

  private async withPolicies<T>(run: (signal: AbortSignal | undefined) => Promise<T>): Promise<T> {
    if (this.bucket) await this.bucket.take();

    let lastErr: unknown;
    for (let attempt = 1; attempt <= this.retry.maxAttempts; attempt++) {
      const timer = this.startTimeout();
      try {
        return await run(timer.signal);
      } catch (err) {
        lastErr = err;
        if (attempt >= this.retry.maxAttempts) break;
        if (!this.retry.shouldRetry!(err)) break;
        const base = Math.min(
          this.retry.maxDelayMs,
          this.retry.initialDelayMs * 2 ** (attempt - 1),
        );
        const jitter = base * 0.25 * (this.retry.random!() - 0.5);
        await this.retry.sleep!(Math.max(0, base + jitter));
      } finally {
        timer.dispose();
      }
    }
    throw lastErr;
  }

  private startTimeout(): { signal: AbortSignal | undefined; dispose: () => void } {
    if (this.timeoutMs === undefined) return { signal: undefined, dispose: () => {} };
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), this.timeoutMs);
    return {
      signal: controller.signal,
      dispose: () => clearTimeout(id),
    };
  }
}

// --- rate limiter ------------------------------------------------------------

/**
 * Token bucket. `maxRequests` tokens refill linearly over `windowMs`.
 *
 * Implementation notes:
 *   - We lazily refill on each `take()` rather than using a background timer,
 *     so the bucket doesn't keep the event loop alive.
 *   - `take()` resolves as soon as a token is available; it does NOT cut in
 *     line if other callers are already waiting (FIFO via an internal chain).
 */
class TokenBucket {
  private tokens: number;
  private readonly capacity: number;
  private readonly windowMs: number;
  private lastRefill: number;
  private waitChain: Promise<void> = Promise.resolve();
  private readonly nowFn: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(policy: RateLimitPolicy) {
    this.capacity = Math.max(1, policy.maxRequests);
    this.windowMs = policy.windowMs ?? 60_000;
    this.tokens = this.capacity;
    this.nowFn = policy.now ?? (() => Date.now());
    this.sleep = policy.sleep ?? defaultSleep;
    this.lastRefill = this.nowFn();
  }

  async take(): Promise<void> {
    // FIFO: each caller chains onto the previous one's resolution.
    const run = async (): Promise<void> => {
      while (true) {
        this.refill();
        if (this.tokens >= 1) {
          this.tokens -= 1;
          return;
        }
        // Not enough tokens: wait until the next one is due.
        const perToken = this.windowMs / this.capacity;
        const elapsedSinceRefill = this.nowFn() - this.lastRefill;
        const waitMs = Math.max(1, perToken - elapsedSinceRefill);
        await this.sleep(waitMs);
      }
    };

    const mine = this.waitChain.then(run);
    // Swallow the rejection on waitChain so one failed call doesn't
    // permanently poison the queue. Errors still surface to the caller
    // through `mine`.
    this.waitChain = mine.catch(() => undefined);
    return mine;
  }

  private refill(): void {
    const now = this.nowFn();
    const elapsed = now - this.lastRefill;
    if (elapsed <= 0) return;
    const add = (elapsed / this.windowMs) * this.capacity;
    if (add <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + add);
    this.lastRefill = now;
  }
}

// --- helpers -----------------------------------------------------------------

function injectSignal(request: CompletionRequest, signal: AbortSignal | undefined): CompletionRequest {
  if (!signal) return request;
  return {
    ...request,
    extra: { ...(request.extra ?? {}), signal },
  };
}

function defaultShouldRetry(err: unknown): boolean {
  if (err instanceof LLMError) {
    if (err.code === 'http_error') {
      const s = err.status;
      if (s === undefined) return true;
      return s === 408 || s === 429 || (s >= 500 && s < 600);
    }
    // bad_json, timeouts, etc. are worth one more try
    return err.code === 'bad_json' || err.code === 'timeout' || err.code === 'network';
  }
  // AbortError is a timeout; retry. TypeError usually means network failure.
  if (err instanceof Error) {
    if (err.name === 'AbortError') return true;
    if (err.name === 'TypeError') return true;
  }
  return false;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
