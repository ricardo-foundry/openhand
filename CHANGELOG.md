# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Ricardo-M-L/openhand/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/Ricardo-M-L/openhand/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/Ricardo-M-L/openhand/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Ricardo-M-L/openhand/releases/tag/v0.1.0
