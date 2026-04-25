# Tweet drafts

Five launch tweets. Pick one per angle, schedule across a few days.

## 1 — Comparative (vs AutoGPT / BabyAGI)

> Everyone's agent demo can `rm -rf` your home folder if the model
> decides to. OpenHand can't — every shell call and file write goes
> through a sandbox + permission check + approval queue.
>
> MIT, 160+ tests, zero runtime deps in the security packages.
> github.com/ricardo-foundry/openhand

## 2 — Technical (strict TS + zero-dep monorepo)

> Shipped OpenHand v0.4: an AI agent monorepo that's full strict TS
> (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`),
> 0 runtime deps in `@openhand/llm` + `@openhand/sandbox`, and 160+
> `node:test` tests. No Jest, no Vitest, no framework bingo.
>
> github.com/ricardo-foundry/openhand

## 3 — Security sandbox angle

> How do you stop an AI agent from `curl | sh`-ing itself off a cliff?
>
> OpenHand's answer: a pure-function sandbox policy (`(cmd, policy) →
> decision`), memory caps, wall-clock timeouts, a hard `SIGKILL` after
> SIGTERM, and an approval queue for anything destructive.
>
> github.com/ricardo-foundry/openhand

## 4 — Monorepo / DX angle

> OpenHand v0.4 is one `npm install` + `npx tsx examples/hello-world.ts`
> away from a running agent. Zero setup. No API key. No Docker. No
> Ollama required. Mock provider ships in the box so you can verify
> the whole pipeline end-to-end on a fresh clone.
>
> github.com/ricardo-foundry/openhand

## 5 — LLM-agnostic angle

> OpenHand has one `LLMProvider` interface and four implementations:
> OpenAI, Anthropic, Ollama, and a Mock for offline dev. Switching is
> an env var. Your retry / rate-limit / cost-tracking code lives in
> `LLMClient`, not in your provider.
>
> No vendor lock-in by design. github.com/ricardo-foundry/openhand
