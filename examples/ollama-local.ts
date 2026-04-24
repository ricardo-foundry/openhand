/**
 * Detect a local Ollama daemon and, if found, run a real completion
 * through it. If `http://localhost:11434` is not reachable, fall back to
 * the `MockProvider` so this example always produces output in CI and on
 * first-boot dev machines.
 *
 * Run:
 *   npx tsx examples/ollama-local.ts
 */
import {
  LLMClient,
  MockProvider,
  OllamaProvider,
  type LLMProvider,
} from '../packages/llm/src/index';

const OLLAMA_URL = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434';
const MODEL = process.env.LLM_MODEL ?? 'qwen2.5:0.5b';

async function isOllamaUp(url: string, timeoutMs = 500): Promise<boolean> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/api/tags`, {
      signal: ctl.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function pickProvider(): Promise<{ provider: LLMProvider; mode: 'ollama' | 'mock' }> {
  if (await isOllamaUp(OLLAMA_URL)) {
    return {
      provider: new OllamaProvider({ baseUrl: OLLAMA_URL }),
      mode: 'ollama',
    };
  }
  return {
    provider: new MockProvider({
      reply:
        `(no ollama on ${OLLAMA_URL} — falling back to the mock provider. ` +
        'Install https://ollama.com, run `ollama pull qwen2.5:0.5b`, then ' +
        'rerun this example for a real local completion.)',
      latencyMs: 40,
    }),
    mode: 'mock',
  };
}

async function main(): Promise<void> {
  const { provider, mode } = await pickProvider();
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 1 },
    timeoutMs: 30_000,
  });

  console.log(`[mode=${mode}] ${provider.info.label} / ${mode === 'ollama' ? MODEL : 'mock-1'}`);

  const res = await client.complete({
    model: mode === 'ollama' ? MODEL : 'mock-1',
    messages: [
      {
        role: 'system',
        content:
          'You are OpenHand. Respond in a single short sentence about what you can help with.',
      },
      { role: 'user', content: 'Say hello and tell me what you can do.' },
    ],
    maxTokens: 150,
    temperature: 0.3,
  });

  console.log(`> ${res.content.trim()}`);
  if (res.usage) {
    console.log(
      `[done] ${res.usage.promptTokens} prompt tokens, ${res.usage.completionTokens} completion tokens`,
    );
  }
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
