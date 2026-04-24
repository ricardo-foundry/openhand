import type { LLMProvider } from './provider';
import { OpenAIProvider } from './openai';
import { AnthropicProvider } from './anthropic';
import { OllamaProvider } from './ollama';

export type ProviderId = 'openai' | 'anthropic' | 'ollama';

/**
 * Optional source for env variables. Defaults to `process.env`.
 * Inject a plain object in tests so nothing leaks in from the host.
 */
export interface ProviderEnvSource {
  [key: string]: string | undefined;
}

export interface ResolveProviderOptions {
  /** Override provider selection; otherwise read from `LLM_PROVIDER`. */
  provider?: ProviderId;
  /** Env source. Defaults to `process.env`. */
  env?: ProviderEnvSource;
  /** Inject a fetch implementation; applied to every provider. */
  fetchImpl?: typeof fetch;
  /** Per-request timeout override. */
  timeoutMs?: number;
}

/**
 * Pick a provider based on env variables.
 *
 * `LLM_PROVIDER`        one of `openai`, `anthropic`, `ollama`. Default `openai`.
 * `OPENAI_API_KEY`      required for openai
 * `OPENAI_BASE_URL`     optional; override for Azure / self-hosted proxies
 * `ANTHROPIC_API_KEY`   required for anthropic
 * `ANTHROPIC_BASE_URL`  optional
 * `OLLAMA_BASE_URL`     optional; defaults to http://localhost:11434
 */
export function resolveProvider(opts: ResolveProviderOptions = {}): LLMProvider {
  const env = opts.env ?? (process.env as ProviderEnvSource);
  const id = (opts.provider ?? normalizeProviderId(env.LLM_PROVIDER)) as ProviderId;

  switch (id) {
    case 'anthropic':
      return new AnthropicProvider({
        apiKey: env.ANTHROPIC_API_KEY,
        baseUrl: env.ANTHROPIC_BASE_URL,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      });

    case 'ollama':
      return new OllamaProvider({
        baseUrl: env.OLLAMA_BASE_URL,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      });

    case 'openai':
    default:
      return new OpenAIProvider({
        apiKey: env.OPENAI_API_KEY,
        baseUrl: env.OPENAI_BASE_URL,
        fetchImpl: opts.fetchImpl,
        timeoutMs: opts.timeoutMs,
      });
  }
}

/** Enumerate the providers the registry currently knows how to build. */
export const KNOWN_PROVIDERS: readonly ProviderId[] = ['openai', 'anthropic', 'ollama'];

function normalizeProviderId(raw: string | undefined): ProviderId {
  const v = (raw ?? '').toLowerCase().trim();
  if (v === 'anthropic' || v === 'claude') return 'anthropic';
  if (v === 'ollama' || v === 'local') return 'ollama';
  return 'openai';
}
