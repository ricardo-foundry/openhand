# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Open-source hygiene files: `CODE_OF_CONDUCT.md`, `SECURITY.md`, `.editorconfig`, `.env.example`.
- GitHub issue form templates, PR template, CI and release workflows, Dependabot config.
- `docs/ARCHITECTURE.md`, `docs/PLUGIN_DEVELOPMENT.md`, `docs/SECURITY_MODEL.md`.
- `packages/llm`: `LLMProvider` abstraction with an OpenAI-compatible placeholder implementation and unit tests.

### Changed

- `README.md` rewritten around positioning, architecture diagram, quickstart, and plugin system.
- `CONTRIBUTING.md` expanded with architecture overview, local dev flow, test guidance, and PR checklist.

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
