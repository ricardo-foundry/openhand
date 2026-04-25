# 06 — Multi-agent orchestration: router + worker

**Goal:** wire a *router* agent that classifies an incoming request and
dispatches it to one of several *worker* agents, all powered by
`packages/core` and `packages/llm` — no extra framework, no extra runtime
dep. Two agents talking to each other in ~80 lines.

## Why a router/worker split?

A single mega-prompt with "you can do X, Y, Z" works until the tool list
grows past about a dozen entries — model accuracy starts to fall off and
context costs balloon. Splitting that into a tiny router (1 tool: pick a
worker) and N specialised workers gives you:

- cheaper, faster routing (you can pin the router to a small/cheap model);
- workers that own a focused tool surface and can be tested in isolation;
- a clean place to inject policy: "this user can route to `code`, but not
  `shell`" lives one switch above the worker logic.

## Architecture (in one diagram)

```text
                      ┌──────────────┐
   user prompt ────▶  │   Router     │  classifies request
                      │   (1 tool:   │  ─▶ {"worker":"code","reason":"..."}
                      │    select)   │
                      └──────┬───────┘
                             │
              ┌──────────────┼──────────────┐
              ▼              ▼              ▼
        ┌─────────┐    ┌─────────┐    ┌─────────┐
        │ code    │    │ research│    │ math    │
        │ worker  │    │ worker  │    │ worker  │
        └─────────┘    └─────────┘    └─────────┘
```

## The whole thing in one file

```ts
// examples/router-worker.ts
import {
  LLMClient,
  MockProvider,
  type ChatMessage,
} from '@openhand/llm';

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

async function route(
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
  const parsed = m ? JSON.parse(m[0]) : { worker: 'research', reason: 'fallback' };
  if (!(parsed.worker in WORKERS)) parsed.worker = 'research';
  return parsed;
}

async function runWorker(
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
      reply:
        'Step 1: x + 2 = 5\nStep 2: x = 3\n**3**',
    }),
    retry: { maxAttempts: 1 },
  });

  const userMsg = 'Solve x + 2 = 5 and show the work.';

  const decision = await route(router, userMsg, 'router-mini');
  console.log('[router]', decision);

  const reply = await runWorker(worker, WORKERS[decision.worker], userMsg, 'worker-large');
  console.log('[worker:', decision.worker, ']\n', reply);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Run it:

```bash
npx tsx examples/router-worker.ts
```

You'll see (trimmed):

```text
[router] { worker: 'math', reason: 'contains an equation' }
[worker: math ]
 Step 1: x + 2 = 5
 Step 2: x = 3
 **3**
```

## What you got for ~80 lines

- **Two distinct LLMs**, each with its own retry/timeout policy via
  `LLMClient`. You can pin the router to a 7B model and the worker to a
  frontier model — same code path.
- **Cost tracking out of the box**: `client.costTracker.totalTokens`
  on each instance — the router and worker bills are *separate*.
- **Deterministic tests**: the `MockProvider` lets you assert
  "router chose math" and "worker echoed back the steps" with zero
  network. See `examples/router-worker.test.ts` (16 lines, runs in <10ms).

## Tighten the loop

- Add a third agent — a *critic* that re-reads the worker's reply and
  re-routes on low confidence. Three `complete()` calls, one extra `if`.
- Replace the JSON-only router with native tool calling
  (`OpenAIProvider` and `AnthropicProvider` both expose `tools` in
  `CompletionRequest`). The mock won't simulate it, but the wire-format
  tests in `tests/integration/provider-wire/` show the exact shape.
- Wire each worker to a different `pluginToolsToMap` subset so e.g. only
  the `code` worker sees the shell + git plugins. Policy stays in core,
  not scattered through prompts.
