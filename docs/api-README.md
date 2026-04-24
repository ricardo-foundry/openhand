# OpenHand — API reference

This directory is **auto-generated** from the TypeScript source by
[TypeDoc](https://typedoc.org/). Do not edit anything under `docs/api/`
by hand — your changes will be overwritten on the next publish.

## How it's produced

At the repo root:

```bash
npm run docs:api
```

That runs TypeDoc against every workspace package (`@openhand/core`,
`@openhand/llm`, `@openhand/sandbox`, `@openhand/tools`) and writes a
static HTML site into this folder.

The CI workflow `.github/workflows/deploy-pages.yml` regenerates the API
reference on every push to `main` and publishes it to GitHub Pages
alongside the landing page.

## What you'll find here

- **@openhand/core** — `Agent`, `Context`, `PluginLoader`, policy engine.
- **@openhand/llm** — `LLMClient`, provider implementations
  (`OpenAIProvider`, `AnthropicProvider`, `OllamaProvider`,
  `MockProvider`), retry + rate-limit policies, cost tracking.
- **@openhand/sandbox** — `SecureSandbox`, path + command policy checks.
- **@openhand/tools** — file, shell, browser, system, email tool packs.

## Conventions

- Every public symbol has a JSDoc `@module` or per-symbol comment.
- Private / `@internal`-marked symbols are excluded from the generated
  output (`--excludePrivate --excludeInternal`).
- Types are resolved at the package entry-point
  (`packages/*/src/index.ts`); anything not re-exported from there is
  implementation detail.

## Reading offline

Once generated, point any static server at this directory:

```bash
npx http-server docs/api -p 8080
```

Or just open `docs/api/index.html` in a browser.
