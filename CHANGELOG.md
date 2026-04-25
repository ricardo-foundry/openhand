# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-04-25

### Added

- **Cookbook 06 / 07.** Two new recipes wire end-to-end stories without a
  framework:
  - `cookbook/06-multi-agent-orchestration.md` — a *router* `LLMClient`
    classifies the user request, a *worker* `LLMClient` answers in role.
    ~80 lines, both clients backed by `MockProvider` so the recipe runs
    offline. Lifted into the runnable `examples/router-worker.ts` plus a
    5-test smoke (`examples/router-worker.test.ts`).
  - `cookbook/07-streaming-tool-use.md` — drain `client.stream()`,
    detect `finishReason: 'tool_calls'` on the terminal chunk, run the
    tool, resume with appended `assistant` + `tool` messages. Lifted
    into `examples/streaming-tool-use.ts`.
- **Both new examples are gated by `tests/e2e/examples-runtime.test.ts`**
  (now 7 cases) so the cookbook can never silently drift from the code.
- **`plugins/web-scraper`.** Seventh in-tree plugin: SSRF-guarded fetch
  + cheerio extract + LLM summary. Defence in depth — applies its own
  SSRF check even though `@openhand/tools` already does. Now 17 tests
  including a real-`MockProvider` end-to-end smoke that drives the
  `scrape_summary` tool against an example.com fixture and asserts the
  full chain (fetch → extract → LLMClient → JSON parse → cost record).
- **Cookbook 02 walkthrough** for the `npm run plugin:new -- <name>`
  scaffolder so a new plugin lands as a tested, manifest-shaped folder
  in one command.
- **`LLMClient.stream()` `onChunk` progress callback.** Default at the
  client level, per-call override via `client.stream(req, { onChunk })`.
  Errors thrown by the hook are swallowed so a buggy UI listener can
  never abort the stream. 3 new unit tests.
- **`PluginLoader.dispose()`.** Closes the file watcher, fires
  `onDisable` + `onUninstall` on every plugin, evicts the `require`
  cache, drops EventEmitter listeners. Idempotent and safe to call
  before any `loadAll()`. 3 new unit tests.
- **`scripts/setup-labels.sh`.** Idempotent `gh label create` script
  that mirrors `.github/labeler.yml`. Fresh fork → `bash
  scripts/setup-labels.sh` → all 15 labels exist on the remote with the
  documented colours and descriptions.
- **`docs/CONTRIBUTING_QUICKSTART.md` "first PR walkthrough"** — the
  exact 7-step path from `good first issue` → fork → branch → commit →
  push → PR → review, with the conventions we actually enforce.

### Changed

- **All workspace versions bumped to 0.6.0** (`package.json` root +
  `packages/*` + `apps/*`). Lockfile re-resolved (`npm install`,
  zero new external deps).
- **`landing/build-meta.json` regenerated.** Test totals reflect the
  new examples test (+2 e2e) and the new web-scraper smoke (+1 plugin).
- **README + `docs/RELEASE_v0.5.md` cross-links** point at the v0.6
  cookbook entries and the new examples.

### Tests

- **278+ total** (was 273). Breakdown:
  - unit: 154 (unchanged)
  - plugins: 61 (+1 from web-scraper real-MockProvider smoke)
  - integration: 33 (unchanged)
  - e2e: 18 (+2 from router-worker + streaming-tool-use runtime tests)
  - bench: 10 (unchanged)
  - examples (smoke): 5 (new file, but counted under unit by the test
    grid since it lives next to the source).
- `npm audit` still **0 vulnerabilities** — Round 13 added no new deps.

## [0.5.0] - 2026-04-25

### Added

- `SecureSandbox.getPolicy()` — returns a frozen snapshot of the effective
  allow-lists + limits. `openhand status` now consumes the real policy
  instead of the hard-coded strings it used to print.
- `examples/agent-shell-loop.ts` — a minimal chat → decide → exec →
  observe loop that runs offline against `MockProvider` and shells out
  through the sandbox. Doubles as a smoke test of the full pipeline.
- `scripts/generate-demo.sh` — regenerates `docs/demo-transcript.md`
  from a real offline run of `hello-world`, `agent-shell-loop`, and
  `shell-automation`. CI can diff the regen output against the committed
  file to catch silent drift.
- `docs/demo-transcript.md` — 98-line recorded transcript, checked in.
- `docs/RELEASE_v0.5.md` — overview of rounds 1-7.
- `docs/REPO_SETTINGS.md` — reference config for GitHub repo metadata.
- `docs/GOOD_FIRST_ISSUES.md` — 12 candidate good-first-issues.
- `OPENHAND_BENCH_MODE=ci` (and `CI=true`) now relaxes the bench ops/sec
  lower bounds by 4x so shared CI runners don't fail spuriously.

### Changed

- **Security**: dropped the unused `puppeteer` runtime dependency and
  moved `nodemailer` to an optional `peerDependency`. `npm audit` now
  reports **0 vulnerabilities** (down from 16 high/critical in 0.4).
- `uuid` bumped to `^14.0.0` (core), `vite` to `^7.0.0` (web) —
  clears the remaining transitive advisories.
- `apps/cli/src/index.ts` default (no-args) entry now goes through the
  same `chatCommand` → `runRepl` path as `openhand chat`. The legacy
  inquirer-backed `startInteractiveChat` branch is gone.
- `PluginLoader.watch()` retry is now a capped exponential backoff
  (5 attempts, 100ms → 1.6s), and it emits new `retry-scheduled` /
  `retry-recovered` events with attempt counts so operators can see
  what's going on.
- `tsx` moved into the root `devDependencies` so `npm run test:e2e` and
  `npm run bench` work out of the box after `npm install`.

### Removed

- `packages/tools` no longer depends on `puppeteer`; the existing
  browser tools already used `fetch` + `cheerio`, so nothing on the
  user-facing API changed.
- `packages/tools` no longer depends on `nodemailer` as a direct
  runtime dep; it's listed under `peerDependenciesMeta` as optional
  for future real-email support.

## [0.4.0] - 2026-04-25

### Added

- **Three new official plugins** under `plugins/`, each with a full
  `package.json` manifest, README, and hermetic `node:test` tests:
  - `plugins/rss-digest/` — fetches an RSS 2.0 / Atom feed (tiny
    regex-based reader, no XML library), renders a Markdown digest, and
    writes it to `~/.openhand/digests/` with a dated host-qualified
    filename. 8 tests.
  - `plugins/code-reviewer/` — accepts a unified diff, asks the LLM for
    a structured JSON review (summary, verdict, 1–5 scores across
    correctness/safety/readability/tests, findings), and renders a
    Markdown report ready to paste into a PR comment. Provider-
    agnostic — takes any `{complete({model, messages})}` shape, which
    means `MockProvider`, `OpenAIProvider`, and every other provider
    work through the same code path. 7 tests.
  - `plugins/file-organizer/` — scans a directory, classifies files
    via the LLM (with a built-in extension-map fallback), and produces
    a **dry-run** rename plan. `organize_apply` is a separate,
    permission-gated tool that refuses to move anything outside the
    scan root and never overwrites. 9 tests.
- **`@openhand/llm/mock` — `MockProvider`.** Offline-first, in-process
  `LLMProvider` for tests, demos, and first-boot dev machines. Supports
  canned `reply`, a round-robin `replies` queue, a dynamic `handler`,
  tiny chunked `stream()`, synthetic `usage` reporting, and optional
  `latencyMs` for realism. 6 tests under `packages/llm/tests/mock.test.ts`.
- **Zero-setup Hello World.** `examples/hello-world.ts` now defaults to
  `MockProvider` and runs end-to-end with no API key, no Docker, no
  Ollama. `LLM_PROVIDER=openai|anthropic|ollama` still switches to a
  real backend. New `examples/ollama-local.ts` probes
  `localhost:11434`, talks to Ollama when available, and falls back to
  the mock provider otherwise.
- **`apps/cli` subcommands.** `openhand plugins <list|enable|disable|
  reload>` wraps `PluginLoader` with a pure, injectable `runPluginsCommand`
  that's fully unit-tested (7 tests). `openhand status` prints the active
  provider, sandbox policy, and loaded plugins via a pure `renderStatus`
  formatter (5 tests). Every subcommand got richer `.description()` text,
  and the top-level `openhand --help` now lists common flows.
- **TypeDoc API reference.** `npm run docs:api` generates a static HTML
  reference into `docs/api/` from `packages/*/src/index.ts`. The
  `deploy-pages.yml` workflow now runs `docs:api` on every push to
  `main` and publishes `landing/` + `docs/api/` as `/` and `/api/` on
  GitHub Pages. `typedoc` is the only new devDependency.
- **Launch collateral under `docs/`.**
  - `LAUNCH_POST.md` — ~600-word launch blog (Dev.to / HN preamble).
  - `PRESS_KIT.md` — one-liner, elevator pitch, 2-min explainer, tweet.
  - `TWEET_DRAFTS.md` — five launch tweets (comparative / technical /
    security / monorepo / LLM-agnostic angles).
  - `HN_POST.md` — "Show HN: OpenHand" title + full body.
  - `FAQ.md` — 10 Q&As (AutoGPT, LangChain, offline, multi-model,
    self-hosting, sandbox trust, plugin permissions, external plugins,
    Node version, telemetry).
- `package.json` scripts: `test:plugins` (runs every
  `plugins/*/tests/*.test.js`), `docs:api` (typedoc).

### Changed

- `apps/cli/src/index.ts`: top-level `--help` now includes a "Common
  flows" block and every subcommand describes what it actually does
  (sandbox gating, approval gating, path-checking) rather than a
  one-word label.
- `examples/README.md`: reflects the new zero-setup default, documents
  the provider resolution rule, and lists `ollama-local.ts`.
- `.github/workflows/deploy-pages.yml`: now builds (`npm ci` +
  `docs:api`), assembles a `_site/` tree with `landing/` at the root
  and `docs/api/` under `/api/`, and uploads that as the Pages
  artifact.

### Total tests

137 → **188** (+51). Breakdown:
- `plugins/*` tests: 34 (10 calculator + 8 rss-digest + 7 code-reviewer +
  9 file-organizer).
- `packages/llm/tests/mock.test.ts`: 6.
- `apps/cli/tests/{plugins,status}.test.ts`: 12.

Strict TypeScript still clean on every workspace
(`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
`noImplicitOverride`, `noFallthroughCasesInSwitch`).

## [0.3.0] - 2026-04-25

### Added

- **Strictest TypeScript across every workspace.** `tsconfig.json` in
  `packages/{core,llm,sandbox,tools}` and `apps/{cli,server,web}` all now
  enforce `strict` plus `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride`, and
  `noFallthroughCasesInSwitch`. `tsc --noEmit` is clean on every
  workspace.
- `tests/e2e/`: three end-to-end smoke tests (6 cases total) using
  `node:test` + raw `http` — no Playwright, no Jest, no new deps:
  - `sse-flow.test.ts`: boots a real Express server and verifies the SSE
    stream emits a `completed` frame for both live and resume scenarios.
  - `cli-repl.test.ts`: drives `runRepl` with scripted stdin/stdout to
    exercise `/help`, `/model`, `/save`, `/exit`, and error propagation.
  - `plugin-hot-reload.test.ts`: watches an empty plugins dir, drops a
    new plugin in, and asserts the loader emits `loaded`.
- `bench/`: three micro-benchmarks (10 cases total) for the perf-sensitive
  paths (`LLMClient` overhead, `PluginLoader.loadAll` at 100 plugins, SSE
  ring buffer throughput). Each bench is also a test — it asserts basic
  order-of-magnitude thresholds so regressions fail CI rather than just
  drift numbers. `bench/README.md` documents how to read the output.
- `docs/ERROR_HANDLING.md`: four-category taxonomy (`UserError` /
  `ProviderError` / `SandboxError` / `InternalError`) with explicit
  retry rules, user-visibility guidance, and log-level conventions.
- `packages/core/src/types.ts`: `Tool.cleanup?` hook, invoked from
  `Agent.executeTask` in a `finally` block. Tools that own sockets, temp
  files, or browser tabs can now release them even when `execute` throws
  or the task is cancelled.
- Root `package.json` scripts: `test:unit`, `test:e2e`, `bench`,
  `typecheck`. `test` now runs unit + e2e + benchmarks.
- README: `At a glance` table (total test/bench counts, strict-TS badge),
  `Roadmap` with shipped + next milestones, `TS strict` badge in the
  header row.

### Fixed

- **Sandbox kill-signal race** (`packages/sandbox/src/sandbox.ts`):
  `runInSandbox` now guards against double-settle, clears the hard-kill
  timer on normal exit (so we no longer leak a 5-second handle on every
  timed-out command), and only fires `SIGKILL` if the child is still
  alive. Uncovered while tightening types — the old code would fire
  `SIGKILL` on an already-exited process in a rare race.
- **SSE subscription leak** (`apps/server/src/routes.ts`): the task-stream
  SSE route now runs its cleanup exactly once (`cleaned` flag) and also
  unsubscribes proactively when `res.write` throws mid-stream. Previously
  the ring-buffer's listener list could grow by one entry per disconnected
  client if the socket died between the heartbeat ticks.
- **REPL `SIGINT` leaves zombie config** (`apps/cli/src/repl.ts`): ctrl+c
  now stops any running spinner, best-effort persists the current config,
  and removes the handler before exit. Previously a `/model` change
  made mid-session was lost if the user ctrl+c'd before `/save`.
- `packages/llm/src/{openai,ollama,anthropic}.ts`: response construction
  now conditionally sets optional fields (`toolCalls`, `usage`) instead
  of assigning `undefined`, which `exactOptionalPropertyTypes: true`
  correctly rejects. Same pattern in `LLMError` for `status`.
- `packages/llm/src/registry.ts`: `resolveProvider` now builds provider
  options with conditional spreads (`...(env.X !== undefined ? {…} : {})`)
  so an unset env variable becomes "key omitted" rather than
  "key is undefined" — required by `exactOptionalPropertyTypes`.
- `packages/tools/src/file/index.ts`: regex capture groups now default to
  empty string when undefined, surfaced by
  `noUncheckedIndexedAccess`. No behaviour change for matching input, but
  the type is now honest.

### Changed

- `apps/server/src/routes.ts`: all `req.params.X` accesses now default to
  `''` instead of destructuring (`const { taskId } = req.params` would
  have inferred `string | undefined` under
  `noUncheckedIndexedAccess`). Behaviourally equivalent — Express
  guarantees the param is present when the route matches — but the types
  no longer lie.
- `apps/cli/src/cli.ts`: slash-command split now tolerates empty input
  (`parts[0] ?? ''`).

### Tests

- **121 unit tests** across six packages — all still green after the
  strict-mode migration.
- **6 E2E tests** under `tests/e2e/` — runnable via `npm run test:e2e`.
- **10 benchmarks** under `bench/` — runnable via `npm run bench`.
- All tests and benchmarks pass on Node 20 macOS/Linux.

## [0.2.0] - 2026-04-25

### Added

- `cookbook/`: five short, code-first recipes (hello-world, plugin authoring,
  custom LLM provider, sandboxed shell, streaming UI).
- `examples/`: three runnable companion scripts (`hello-world.ts`,
  `rss-digest-agent.ts`, `shell-automation.ts`) plus an index README.
- `landing/`: single-file static landing page (HTML + CSS + mermaid)
  designed for GitHub Pages, with an OG card SVG.
- `.github/workflows/deploy-pages.yml`: auto-deploys `landing/` to GitHub
  Pages on pushes that touch the directory.
- `packages/core/src/plugin-loader.ts`: 100ms one-shot retry on watcher
  load failures, so half-written plugin files (mid-`npm install`,
  mid-checkout) don't surface as spurious errors. Covered by a new test.
- JSDoc module-level headers on the agent core, server routes, sandbox
  runtime, and all three LLM providers.

### Changed

- `README.md`: rebuilt around a 5-minute Quickstart, a tighter compare
  table, "What can you actually build?" section, mermaid architecture
  diagram, "Stars over time" badge, and links into the new cookbook.
- `apps/cli/src/cli.ts`: `sendMessage` now resolves only after the agent
  emits its terminal `message` (assistant) or `system` (error) event,
  making the REPL spinner stop in lockstep with output.
- `packages/llm/src/client.ts`: documented the in-process scope of the
  rate limiter and cost tracker, with a pointer to the README guidance
  on multi-pod deployment.

### Tests

- 121 tests across six workspaces (added a watcher-retry test in
  `packages/core/tests/plugin-loader.test.ts`).

## [0.1.1] - 2026-04-25

### Added

- `packages/llm/src/anthropic.ts`: first-class Anthropic Messages provider.
- `packages/llm/src/ollama.ts`: native Ollama `/api/chat` provider with ndjson streaming.
- `packages/llm/src/registry.ts`: `resolveProvider()` / `KNOWN_PROVIDERS` driven by `LLM_PROVIDER` env.
- `packages/llm/src/client.ts`: `LLMClient` decorator with exponential-backoff retry, AbortController timeouts, FIFO token-bucket rate limiter, and `InMemoryCostTracker`.
- `packages/core/src/plugin-loader.ts`: filesystem plugin discovery (`package.json` → `openhand` manifest), enable/disable/unload, optional `fs.watch` hot reload.
- `plugins/calculator`: safe arithmetic evaluator (recursive-descent parser, no `eval`) with README and 10 tests.
- `apps/cli/src/repl.ts`: native REPL with `/help /model /reset /save /exit`, ctrl+c handling, ANSI spinner, and `~/.openhand/config.json` persistence — zero dependencies.
- `apps/server/src/task-stream.ts`: `TaskStreamBus` with per-task ring buffer + `Last-Event-ID` replay, wired into `GET /api/tasks/:id/stream`.
- `apps/web/src/pages/Tasks.tsx`: now consumes the SSE stream and auto-scrolls a live log.
- `packages/sandbox/src/policy.ts`: pure-function `checkPath` / `checkCommand` with explicit deny codes, plus 20 unit tests covering prefix-bypass, NUL bytes, interpreter flags, and shell metacharacters.
- Open-source hygiene files: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.editorconfig`, `.env.example`.
- GitHub issue form templates, PR template, CI and release workflows, Dependabot config.
- `docs/ARCHITECTURE.md`, `docs/PLUGIN_DEVELOPMENT.md`, `docs/SECURITY_MODEL.md`.

### Changed

- `.env.example` updated with the new `LLM_PROVIDER`, `ANTHROPIC_BASE_URL`, `OLLAMA_BASE_URL`, and `LLMClient` retry/rate-limit variables.
- `docs/ARCHITECTURE.md` now diagrams `PluginLoader`, `LLMClient`, `resolveProvider`, and the SSE `TaskStreamBus`, plus documents the SSE wire format.
- `README.md` feature list rewritten around real runnable examples; status badge promoted to `actively developed`.
- Test suite grew from 47 to 120+ tests across six workspaces (plus 10 in the calculator plugin).

## [0.1.0] - 2026-04-25

### Added

- `packages/core`: agent loop, planner, policy engine, types.
- `packages/tools`: file, shell, browser, email, system tools with schema validation.
- `packages/sandbox`: isolated execution environment for tool calls.
- `apps/cli`: interactive CLI with chat/ask/exec commands.
- `apps/server`: HTTP server that drives the agent loop.
- `apps/web`: React + Tailwind SPA, Docker + nginx image.
- `plugins/weather`: reference plugin demonstrating the plugin manifest + lifecycle.
- Monorepo scaffolding via npm workspaces, TypeScript build, `node:test` harness.

[Unreleased]: https://github.com/ricardo-foundry/openhand/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/ricardo-foundry/openhand/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/ricardo-foundry/openhand/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/ricardo-foundry/openhand/releases/tag/v0.1.0
