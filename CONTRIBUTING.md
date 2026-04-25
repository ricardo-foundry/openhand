# Contributing to OpenHand

Thanks for your interest in OpenHand! This document walks you through the
architecture, how to run the project locally, our coding conventions, and how
to land a pull request.

> By participating, you agree to the [Code of Conduct](./CODE_OF_CONDUCT.md)
> and to [report security issues privately](./SECURITY.md).

---

## 1. Architecture in one screen

```
apps/cli ─┐                       ┌─► packages/core    (agent loop, planner, policy)
apps/web ─┼─► apps/server ───────►│   packages/tools   (file, shell, browser, email, ...)
          │                       │   packages/sandbox (isolated execution)
          └───────────────────────┘   packages/llm     (provider abstraction)

plugins/* ─► registered into packages/core at startup
```

More detail in [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md).

---

## 2. Local development

### Prerequisites

- Node.js **20.x** (the CI matrix only tests 20).
- npm **10+** (ships with Node 20).
- Optional: Docker, for `docker-compose up`.

### First run

```bash
git clone https://github.com/ricardo-foundry/openhand.git
cd openhand
cp .env.example .env      # fill in at least one LLM provider
npm install               # installs all workspaces
npm run build             # TypeScript build for every package
npm test --workspaces     # run all unit tests
```

### Dev loop

```bash
# Everything at once (CLI + server + web)
npm run dev

# Or individually
npm run dev:server        # apps/server on :3001
npm run dev:web           # apps/web on :3000 (Vite)
npm run dev:cli           # interactive CLI
```

### Testing

All packages use the Node built-in test runner (`node --test`) plus `tsx`:

```bash
# Everything
npm test --workspaces

# One package
npm --workspace @openhand/core test

# Watch a single file
node --import tsx --test --watch packages/core/tests/planner.test.ts
```

Guidelines:

- Unit-test the public surface of each package.
- Stub `fetch` when testing LLM code — do **not** hit real provider APIs in CI.
- Sandbox tests must exercise both allowed and denied paths.

---

## 3. Coding conventions

- **Language**: TypeScript (`strict: true`). No `any` in new code unless
  narrowed immediately.
- **Module style**: CommonJS output (matches existing `tsconfig.json`), ESM
  source style. Use `import type` for type-only imports.
- **Errors**: throw `Error` subclasses, never strings; include a machine-
  readable `code` where it helps the UI.
- **Logs**: no `console.log` in library code (`packages/*`). Apps may use it,
  but prefer a structured logger.
- **Secrets**: never commit `.env`, credentials, or provider keys. Use
  `.env.example` to document new variables.
- **Formatting**: `.editorconfig` is the source of truth (LF, 2-space indent,
  UTF-8). Set your editor to respect it.
- **Commits**: Conventional Commits — `feat:`, `fix:`, `docs:`, `refactor:`,
  `test:`, `chore:`, `ci:`, `perf:`.

---

## 4. Branching & PR flow

1. Fork the repo (or create a topic branch if you have write access).
2. Branch from `main`: `git checkout -b feat/my-thing`.
3. Keep PRs **small and focused** — one logical change per PR.
4. Rebase onto `main` before asking for review; we squash-merge.
5. Open the PR against `main` using the [PR template](./.github/PULL_REQUEST_TEMPLATE.md).
6. CI must be green (build + tests + required OSS files).
7. A maintainer will review within a few days.

Please update `CHANGELOG.md` under `## [Unreleased]` for any user-visible change.

---

## 5. Writing a plugin

The shortest path to extending OpenHand is a plugin — it does not require
modifying core. See **[`docs/PLUGIN_DEVELOPMENT.md`](./docs/PLUGIN_DEVELOPMENT.md)**
for a full walkthrough using `plugins/weather/` as the template.

---

## 6. Reporting bugs / asking questions

- Reproducible bug? Open a [Bug Report](./.github/ISSUE_TEMPLATE/bug_report.yml).
- Feature idea? Open a [Feature Request](./.github/ISSUE_TEMPLATE/feature_request.yml).
- Question? Use GitHub Discussions.
- Security? Follow [SECURITY.md](./SECURITY.md) — do not file a public issue.

Thanks for contributing.
