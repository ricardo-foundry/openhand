# OpenHand Examples

Runnable companion scripts for the [`cookbook/`](../cookbook/). Each one is a
single TypeScript file that you can execute with `npx tsx` after building the
workspaces:

```bash
npm install && npm run build
```

| Script                       | Cookbook recipe                                              | Needs                          |
|------------------------------|---------------------------------------------------------------|--------------------------------|
| `hello-world.ts`             | [01](../cookbook/01-hello-world.md) — Hello World             | Ollama on `localhost:11434`    |
| `rss-digest-agent.ts`        | [02](../cookbook/02-writing-a-plugin.md) — Writing a plugin   | Network access                 |
| `shell-automation.ts`        | [04](../cookbook/04-sandboxed-shell.md) — Sandboxed shell     | Nothing                        |

## Run them

```bash
# 01 — minimal completion against a local Ollama
LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:0.5b npx tsx examples/hello-world.ts

# 02 — fetches Hacker News RSS, prints 5 items
npx tsx examples/rss-digest-agent.ts

# 04 — exercises the sandbox: shows what is allowed and what is denied
npx tsx examples/shell-automation.ts
```

## Caveats

- These examples import from the in-repo workspace packages, so they must run
  from the repo root (or anywhere `node` can resolve `@openhand/*`).
- They are **demonstration code**, not the agent loop. To drive a real agent
  with a planner, tools, and a REPL, run `npm --workspace @openhand/cli start`.
- No example reads any secret. If you switch one to OpenAI / Anthropic, set
  the relevant `*_API_KEY` env var first (see [`.env.example`](../.env.example)).
