# OpenHand — FAQ

## 1. How is OpenHand different from AutoGPT / BabyAGI / Open Interpreter?

AutoGPT and BabyAGI are mostly prompt graphs — they wire a loop around
an LLM and give it open access to the filesystem and shell. OpenHand
starts from the opposite direction: every action is a tool, every tool
declares permissions, every shell call runs through a sandbox, and
destructive calls hit an approval queue before they fire. If the
interesting thing is the loop, AutoGPT is simpler. If the interesting
thing is being able to run the agent on code you care about, OpenHand
is the one.

## 2. Why not use LangChain / LlamaIndex / CrewAI?

I tried. Those frameworks are each bigger than this entire repo, and
most of the size is indirection for abstractions I didn't need. The
parts I did need (retry, rate-limit, streaming, tool dispatch) are 1-2
files each; I kept them and stopped. If LangChain works for you, use
LangChain — OpenHand is not a drop-in replacement, and isn't trying to
be.

## 3. Does OpenHand work fully offline?

Yes. `npm install && npx tsx examples/hello-world.ts` uses the
in-process `MockProvider` — no API key, no network. For real
completions offline, point `OllamaProvider` at your local Ollama
daemon (`examples/ollama-local.ts` auto-detects it and falls back to
the mock if it's not running).

## 4. Can I use it with a model that isn't OpenAI / Anthropic / Ollama?

Yes, two ways. First, the `OpenAIProvider` takes a `baseUrl`, so
anything speaking `/v1/chat/completions` (vLLM, LM Studio, LiteLLM,
Together, Groq, llama.cpp) works out of the box. Second, write a
45-line class that implements `LLMProvider` — see
`cookbook/03-custom-llm-provider.md`.

## 5. How do I self-host the server + web UI?

`docker compose up` from the repo root. That brings up
`apps/server` (API + SSE stream), `apps/web` (UI), and a Redis for
session state. The landing page + API docs publish to GitHub Pages via
`.github/workflows/deploy-pages.yml`, or you can `npm run docs:api`
and serve `docs/api/` yourself.

## 6. How trustworthy is the sandbox, really?

It is not a kernel-level sandbox. It's a command- and path-level
policy engine, a memory cap via `ulimit`, and a wall-clock timeout
backed by `SIGTERM → SIGKILL`. That is a meaningful layer of defense,
but it is not a replacement for running the agent inside a VM or
container if you're handling untrusted input that might try to escape.
`docs/SECURITY_MODEL.md` is explicit about what it does and doesn't
stop.

## 7. How do plugins get their permissions checked?

Each plugin's `package.json` has an `openhand.permissions` field, and
each tool the plugin exports can further declare per-tool
`permissions: [...]`. The loader surfaces those; the agent's policy
engine decides whether to dispatch. The sandbox is the enforcement
layer — a plugin that claims `fs:read` and tries `fs:write` gets its
`spawn` blocked by path policy.

## 8. Will you accept external plugins?

Yes. The plugin manifest is stable. Community plugins can live in any
npm package named `@openhand/plugin-*` or published
anywhere; drop them into the plugins directory and the loader picks
them up on next scan. A central registry is on the roadmap but not
shipped yet — for now, link yours in your README and I'll list it.

## 9. What's the minimum Node version?

Node 20 LTS. The codebase uses built-in `fetch`, `AbortController`,
`node:test`, and `fs.promises` — all stable on 20. We don't test older
versions.

## 10. Is telemetry enabled?

No. No analytics, no crash reports, no phone-home. The only network
traffic OpenHand makes is the LLM calls you explicitly configure and
whatever your enabled plugins do (which they have to declare up front
via `permissions: ['network:http']`, so you can see it). `grep -r
"api/track\|analytics\|telemetry"` — you won't find one.
