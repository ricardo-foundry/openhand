# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/Ricardo-M-L/openhand/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Ricardo-M-L/openhand/releases/tag/v0.1.0
