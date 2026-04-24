# 01 — Hello World

**Goal:** drive a real OpenHand agent end-to-end with zero API keys, using
[Ollama](https://ollama.com) as the local LLM.

## Prerequisites

```bash
# 1. Get a tiny model running locally
brew install ollama         # or curl -fsSL https://ollama.com/install.sh | sh
ollama serve &              # starts http://localhost:11434
ollama pull qwen2.5:0.5b    # ~400MB, runs on CPU

# 2. Build the workspaces
git clone https://github.com/Ricardo-M-L/openhand.git
cd openhand && npm install && npm run build
```

## Run it

```bash
LLM_PROVIDER=ollama \
LLM_MODEL=qwen2.5:0.5b \
OLLAMA_BASE_URL=http://localhost:11434 \
npx tsx examples/hello-world.ts
```

Expected output:

```text
[ollama] /api/chat -> 200
> Hello! I am OpenHand. I can run shell commands, read files, and call plugins.
[done] 142 prompt tokens, 38 completion tokens
```

## What just happened

```ts
// examples/hello-world.ts (excerpt)
import { resolveProvider, LLMClient } from '@openhand/llm';

const provider = resolveProvider();          // env-driven: ollama
const client   = new LLMClient({ provider, retry: { maxAttempts: 2 } });

const res = await client.complete({
  messages: [{ role: 'user', content: 'Introduce yourself in one sentence.' }],
  model: process.env.LLM_MODEL,
  maxTokens: 80,
});

console.log('>', res.message.content);
console.log(`[done] ${res.usage?.promptTokens} prompt tokens, `
          + `${res.usage?.completionTokens} completion tokens`);
```

Three things to notice:

1. **No vendor SDK.** `@openhand/llm` is a thin `fetch` wrapper. Swap
   `LLM_PROVIDER=openai` (with `OPENAI_API_KEY=...`) or
   `LLM_PROVIDER=anthropic` and the same code works.
2. **`LLMClient` is opt-in.** Retry, timeouts, rate-limit, and cost
   accounting all decorate any provider — see `cookbook/03`.
3. **No agent loop yet.** This recipe is the smallest possible "is the wire
   alive?" test. The agent loop (planner → tools → response) lives in
   `packages/core` — start a CLI REPL with `npm --workspace @openhand/cli start`
   to drive it interactively.

## Next

- [02 — Writing a plugin](./02-writing-a-plugin.md) — give the agent a new tool.
- [04 — Sandboxed shell](./04-sandboxed-shell.md) — let it run shell commands safely.
