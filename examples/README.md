# OpenHand Examples

Runnable companion scripts for the [`cookbook/`](../cookbook/). Each one is
a single TypeScript file you can execute with `npx tsx` straight from the
repo root — no build step needed.

```bash
npm install       # once
npx tsx examples/hello-world.ts
```

| Script                       | Cookbook recipe                                              | Needs                                |
|------------------------------|---------------------------------------------------------------|--------------------------------------|
| `hello-world.ts`             | [01](../cookbook/01-hello-world.md) — Hello World             | **Nothing** (mock provider default)  |
| `ollama-local.ts`            | [01](../cookbook/01-hello-world.md) — Hello World             | Ollama on `localhost:11434` optional |
| `rss-digest-agent.ts`        | [02](../cookbook/02-writing-a-plugin.md) — Writing a plugin   | Network access                       |
| `shell-automation.ts`        | [04](../cookbook/04-sandboxed-shell.md) — Sandboxed shell     | Nothing                              |

## Run them

```bash
# 01 — works with zero setup (MockProvider). No API key, no network.
npx tsx examples/hello-world.ts

# 01 (real local) — talks to a real model via Ollama if available, otherwise
# falls back to the mock provider.
npx tsx examples/ollama-local.ts

# hello-world against real providers:
LLM_PROVIDER=openai    OPENAI_API_KEY=sk-…    npx tsx examples/hello-world.ts
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-…  npx tsx examples/hello-world.ts
LLM_PROVIDER=ollama    LLM_MODEL=qwen2.5:0.5b npx tsx examples/hello-world.ts

# 02 — fetches Hacker News RSS, prints 5 items
npx tsx examples/rss-digest-agent.ts

# 04 — exercises the sandbox: shows what is allowed and what is denied
npx tsx examples/shell-automation.ts
```

## Provider selection

The examples share one resolution rule:

1. If `LLM_PROVIDER` is unset or `mock`, the `MockProvider` runs in-process.
2. Otherwise, `resolveProvider()` reads env variables and constructs the
   requested provider (`openai`, `anthropic`, `ollama`).
3. `examples/ollama-local.ts` additionally probes `localhost:11434` and
   auto-falls-back to the mock provider if Ollama isn't running.

That means `npx tsx examples/hello-world.ts` is guaranteed to print a
reply, even in a fresh clone with no keys and no daemons.

## Caveats

- These examples import from the in-repo workspace packages, so run them
  from the repo root (or anywhere `node` can resolve `@openhand/*`).
- They are **demonstration code**, not the agent loop. To drive a real
  agent with a planner, tools, and a REPL, run `npm --workspace
  @openhand/cli start`.
- No example reads any secret. If you switch one to OpenAI / Anthropic,
  set the relevant `*_API_KEY` env var first (see
  [`.env.example`](../.env.example)).
