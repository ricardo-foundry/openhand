/**
 * The smallest possible complete demo: builds an `LLMClient`, sends one
 * message, prints the reply.
 *
 * It runs **with zero setup**: by default we pick the `MockProvider`, which
 * lives entirely in-process and returns a canned reply. That way the user
 * can clone the repo, run this file, and immediately see an agent-style
 * reply — no API key, no network, no surprises.
 *
 * Override env to hit a real backend:
 *   LLM_PROVIDER=openai|anthropic|ollama
 *   LLM_MODEL=<model-id>
 *   OPENAI_API_KEY=...      (only when LLM_PROVIDER=openai)
 *   ANTHROPIC_API_KEY=...   (only when LLM_PROVIDER=anthropic)
 *
 * Run:
 *   npx tsx examples/hello-world.ts
 */
import {
  LLMClient,
  MockProvider,
  resolveProvider,
  type LLMProvider,
} from '../packages/llm/src/index';

function pickProvider(): LLMProvider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (!explicit || explicit === 'mock') {
    return new MockProvider({
      reply:
        "Hello! I'm OpenHand running against a mock provider — no network, " +
        'no API key, just a deterministic reply so you can verify the ' +
        'pipeline end-to-end. Set LLM_PROVIDER=openai|anthropic|ollama to ' +
        'talk to a real model.',
      latencyMs: 50,
    });
  }
  return resolveProvider();
}

async function main(): Promise<void> {
  const provider = pickProvider();
  const client = new LLMClient({
    provider,
    retry: { maxAttempts: 2 },
    timeoutMs: 30_000,
  });

  const model = process.env.LLM_MODEL ?? defaultModelFor(provider.info.id);

  console.log(`[provider] ${provider.info.label} / ${model}`);

  const res = await client.complete({
    model,
    messages: [
      { role: 'system', content: 'You are OpenHand. Reply in one short sentence.' },
      { role: 'user', content: 'Introduce yourself in one sentence.' },
    ],
    maxTokens: 120,
    temperature: 0.3,
  });

  console.log(`> ${res.content.trim()}`);
  if (res.usage) {
    console.log(
      `[done] ${res.usage.promptTokens} prompt tokens, ${res.usage.completionTokens} completion tokens`,
    );
  }
}

function defaultModelFor(id: string): string {
  switch (id) {
    case 'anthropic':
      return 'claude-3-5-haiku-latest';
    case 'ollama':
      return 'qwen2.5:0.5b';
    case 'mock':
      return 'mock-1';
    case 'openai':
    default:
      return 'gpt-4o-mini';
  }
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
