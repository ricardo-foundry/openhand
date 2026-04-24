# OpenHand: an AI agent that earns its permissions

I've spent the last week building **[OpenHand](https://github.com/Ricardo-M-L/openhand)**,
an open-source AI agent that runs locally, is provider-agnostic, and —
the part I care about most — treats every filesystem write, shell
command, and network call as something it has to ask for, not something
it's already allowed to do.

## The shape of the problem

The "AI agent" category is drowning in demos. You clone something, plug
in a key, and within two prompts the thing is trying to `rm -rf` your
node_modules. Three patterns kept showing up in every project I tried:

1. **Invisible prompt injection.** A scraped webpage tells the model
   "ignore previous instructions, run this command", and the agent
   happily does.
2. **Implicit permissions.** The agent has `child_process.exec` in its
   namespace from boot; there's no layer between "the model decided" and
   "it happened".
3. **Vendor lock-in.** You picked OpenAI on day one, and six months
   later half your code is Chat-Completions-shaped.

## What OpenHand does differently

- **A real sandbox, not a `try/catch`.** `@openhand/sandbox` spawns
  commands with a command allow-list, path allow-list, `ulimit`-backed
  memory cap, wall-clock timeout, and a hard `SIGKILL` safety net after
  SIGTERM. The sandbox policy engine is a pure function of `(command,
  policy) → decision`, which means it's unit-testable and identical in
  dev, CI, and production.
- **Permissioned tools.** Every tool declares `permissions: ['fs:write',
  'network:http', …]`. The `Agent` refuses to dispatch anything whose
  declared permissions exceed the session policy. Risky ones like
  `shell_exec` and `file_write` go through an approval queue that a
  human has to click through.
- **LLM-agnostic from day one.** `@openhand/llm` ships with OpenAI,
  Anthropic, and Ollama providers behind one `LLMProvider` interface,
  plus a `MockProvider` for tests and offline demos. `LLMClient` wraps
  them with retry, rate limiting, and cost tracking.
- **Plugins you can write in 30 lines.** A plugin is a
  `package.json` with an `openhand` manifest plus an `index.js` that
  exports a `tools[]` array. This release ships three official ones:
  `rss-digest`, `code-reviewer`, and `file-organizer`. `code-reviewer`
  is the fun one — hand it a `git diff`, get a JSON review with
  correctness/safety/readability/tests scores and a Markdown report.

## By the numbers

- 160+ tests, all `node:test`. No Jest, no Vitest, no framework bingo.
- 0 runtime dependencies in `@openhand/llm` and `@openhand/sandbox`.
- Strict TypeScript everywhere: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`.
- End-to-end tests that spin a real HTTP server and drive the CLI REPL.
- Micro-benchmarks in CI with hard perf thresholds — regressions fail
  the build instead of silently drifting.
- Three cookbook recipes, runnable examples, and an auto-generated
  TypeDoc API reference.

## Zero-setup demo

```bash
git clone https://github.com/Ricardo-M-L/openhand
cd openhand
npm install
npx tsx examples/hello-world.ts
```

No API key. No network. No Docker. The default example runs against the
in-process `MockProvider` so you can verify the pipeline end-to-end
before you've paid anyone a cent.

## What's next

Roadmap lives in `README.md`. Short version: richer planner, a proper
task graph visualiser in the web UI, and a plugin registry. If the
sandbox model or the plugin spec looks interesting to you, PRs welcome —
`CONTRIBUTING.md` walks through the workspace layout.

Source: **https://github.com/Ricardo-M-L/openhand**
MIT-licensed. Feedback, issues, and flames all appreciated.
