/**
 * Smallest possible end-to-end LLM call against the OpenHand provider stack.
 *
 * Defaults to Ollama on `http://localhost:11434` so you can run it without
 * any API key. Override with env:
 *
 *   LLM_PROVIDER=openai|anthropic|ollama
 *   LLM_MODEL=<model-id>
 *   OPENAI_API_KEY=...   (only when LLM_PROVIDER=openai)
 *   ANTHROPIC_API_KEY=... (only when LLM_PROVIDER=anthropic)
 *
 * Run:
 *   npx tsx examples/hello-world.ts
 */
import { resolveProvider, LLMClient } from '../packages/llm/src/index';

async function main(): Promise<void> {
  const provider = resolveProvider();
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
    maxTokens: 80,
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
    case 'openai':
    default:
      return 'gpt-4o-mini';
  }
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
