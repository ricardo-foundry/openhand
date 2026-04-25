/**
 * Multi-agent orchestration: router + worker.
 *
 * A *router* agent classifies the incoming request and dispatches it to one
 * of several specialised *worker* agents. Both are just `LLMClient`
 * instances over `MockProvider` so this file runs offline with no API key.
 *
 * See `cookbook/06-multi-agent-orchestration.md` for the full walkthrough.
 *
 * Run:
 *   npx tsx examples/router-worker.ts
 */
import {
  LLMClient,
  MockProvider,
  type ChatMessage,
} from '../packages/llm/src/index';

type WorkerId = 'code' | 'research' | 'math';

interface Worker {
  id: WorkerId;
  systemPrompt: string;
}

const WORKERS: Record<WorkerId, Worker> = {
  code: {
    id: 'code',
    systemPrompt:
      'You are a senior engineer. Reply in code blocks; explain only when asked.',
  },
  research: {
    id: 'research',
    systemPrompt:
      'You are a research assistant. Cite primary sources, never speculate.',
  },
  math: {
    id: 'math',
    systemPrompt:
      'You are a math tutor. Show every step; box the final answer with `**`.',
  },
};

const ROUTER_SYSTEM = [
  'You are a router. Pick one worker for the user request.',
  'Respond with JSON only:',
  '{ "worker": "code"|"research"|"math", "reason": string }',
  'No prose, no code fences.',
].join('\n');

export async function route(
  client: LLMClient,
  request: string,
  model: string,
): Promise<{ worker: WorkerId; reason: string }> {
  const res = await client.complete({
    model,
    messages: [
      { role: 'system', content: ROUTER_SYSTEM },
      { role: 'user', content: request },
    ],
    temperature: 0,
    maxTokens: 80,
  });
  // Tolerate fences / leading prose without depending on a JSON repair lib.
  const json = res.content.replace(/```[a-z]*\n?/gi, '').replace(/```$/g, '').trim();
  const m = json.match(/\{[\s\S]*\}/);
  const parsed = m
    ? (JSON.parse(m[0]) as { worker: WorkerId; reason: string })
    : { worker: 'research' as WorkerId, reason: 'fallback' };
  if (!(parsed.worker in WORKERS)) parsed.worker = 'research';
  return parsed;
}

export async function runWorker(
  client: LLMClient,
  worker: Worker,
  request: string,
  model: string,
): Promise<string> {
  const messages: ChatMessage[] = [
    { role: 'system', content: worker.systemPrompt },
    { role: 'user', content: request },
  ];
  const res = await client.complete({
    model,
    messages,
    temperature: 0.2,
    maxTokens: 600,
  });
  return res.content;
}

export { WORKERS };
export type { Worker, WorkerId };

async function main(): Promise<void> {
  // Two providers so we can prove "router cheap, worker rich" in tests.
  // Swap for resolveProvider() to talk to OpenAI / Anthropic / Ollama.
  const router = new LLMClient({
    provider: new MockProvider({
      reply: '{"worker":"math","reason":"contains an equation"}',
    }),
    retry: { maxAttempts: 1 },
  });
  const worker = new LLMClient({
    provider: new MockProvider({
      reply: 'Step 1: x + 2 = 5\nStep 2: x = 3\n**3**',
    }),
    retry: { maxAttempts: 1 },
  });

  const userMsg = 'Solve x + 2 = 5 and show the work.';

  const decision = await route(router, userMsg, 'router-mini');
  console.log('[router]', decision);

  const reply = await runWorker(
    worker,
    WORKERS[decision.worker],
    userMsg,
    'worker-large',
  );
  console.log(`[worker: ${decision.worker} ]\n${reply}`);
  console.log('[done] router/worker demo finished');
}

// Only run main() when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof require !== 'undefined' && require.main === module;
if (invokedDirectly) {
  main().catch(err => {
    console.error('[error]', err);
    process.exit(1);
  });
}
