# OpenHand Journey — iter-1 → iter-16

A chronological log of every iteration that took OpenHand from an empty
folder to a v0.8 release candidate with 383 tests, 8 plugins, 4 providers,
and zero npm-audit vulns. Each iteration is one focused commit on a short-
lived branch, merged to `main` after a green smoke run.

This file is **append-only** narrative — the per-version "what shipped" list
lives in [`CHANGELOG.md`](../CHANGELOG.md). Use this file to understand
**why** each iteration happened, what the constraint was, and what the next
iteration was forced to address.

---

## iter-1 — Initial import & monorepo skeleton

- npm workspaces (`packages/*`, `apps/*`).
- First pass at `packages/sandbox` — explicit allow-list, shell-metachar
  rejection, path-traversal guard.
- Empty CLI / server / web shells, just enough to compile.
- **Outcome**: scaffolding compiles; no runtime yet.

## iter-2 — OSS scaffolding + LLM package stub

- LICENSE (MIT), CONTRIBUTING, CODE_OF_CONDUCT, SECURITY, GH issue
  templates, release workflow.
- `packages/llm` carved out with `Provider` interface (no real impls yet).
- **Outcome**: project is "fork-able" — a stranger can read the repo and
  see the shape.

## iter-3 — Real wiring

- First real `OpenAIProvider` + `AnthropicProvider` + `OllamaProvider`.
- Plugin hot-reload via `fs.watch` in `packages/core/PluginLoader`.
- CLI REPL (raw readline, no inquirer).
- SSE task-event stream from `apps/server` → web/CLI.
- **Outcome**: end-to-end demo works against a real model.

## iter-4 — Cookbook, runnable examples, JSDoc, landing

- `cookbook/01..05` written as readable Markdown.
- `examples/*.ts` are now real runnable programs, not snippets.
- TypeDoc wiring + GitHub Pages landing.
- **Outcome**: docs catch up to code.

## iter-5 — Strict TS, e2e tests, microbench, error policy

- `tsconfig` flips on `strict` + `noUncheckedIndexedAccess` across all
  workspaces. ~40 latent bugs surfaced and fixed.
- `tests/e2e/*` — REPL spawn, SSE drain, plugin hot-reload.
- `bench/*.bench.ts` — first 6 microbenchmarks.
- `docs/ERROR_HANDLING.md` codifies the typed-error contract.
- **Outcome**: types are load-bearing, not decorative.

## iter-6 — Three official plugins + MockProvider + launch docs

- `plugins/{weather,calculator,code-reviewer}` with full test folders.
- `MockProvider` so unit tests don't need network.
- Launch docs (`HN_POST.md`, `LAUNCH_POST.md`, `TWEET_DRAFTS.md`).
- **Outcome**: ready to be shown publicly.

## iter-7 — v0.5 reflection / hardening

- Drop puppeteer (transitive vulns); real sandbox policy file replaces
  ad-hoc allow-lists.
- Unify REPL across CLI subcommands.
- All workspace versions pinned to 0.5.0.
- **Outcome**: 0 npm audit findings, sandbox is a reviewable artifact.

## iter-8 — npm audit zero-vuln baseline

- (folded into v0.5 release commit) — established the rule that `npm audit`
  must stay at zero.

## iter-9 — Runtime smoke harness

- `scripts/runtime-integration.sh` boots the server, runs every
  `examples/*.ts`, drives the CLI subcommands, drains an SSE flow, and
  fails CI if any byte goes missing.
- Drops the `inquirer` regression caught by the smoke run.
- **Outcome**: "does it actually run end-to-end?" is now a single command.

## iter-10 — Provider wire tests, git-summary plugin, init wizard

- `tests/integration/provider-wire/*` records the exact JSON sent to
  OpenAI / Anthropic / Ollama, so a silent breaking change in payload
  shape now fails a unit test.
- `plugins/git-summary` (4th in-tree plugin).
- `openhand init` wizard (writes `~/.openhand/config.toml`).
- "PR welcomeness" — `docs/GOOD_FIRST_ISSUES.md`, label bootstrap.
- **Outcome**: contributor on-ramp is real.

## iter-11 — Brand consolidation

- Repo migrated to `ricardo-foundry/openhand`. All URLs / badges / docs
  rewritten in one pass so nothing dangles at the old org.

## iter-12 — Cookbook 06/07, web-scraper, streaming hooks, in-browser demo

- `cookbook/06-multi-agent-orchestration.md` (router → worker pattern).
- `cookbook/07-streaming-tool-use.md`.
- `plugins/web-scraper` (5th plugin).
- Runtime exposes `onChunk` + a clean `dispose()` contract.
- `landing/` gets an in-browser demo (no backend required).

## iter-13 — v0.6 polish

- All cookbook examples become runnable + asserted by `node:test`.
- Label bootstrap, first-PR walkthrough.
- Workspace versions unified to 0.6.0.

## iter-14 — v0.7 observability + marketplace

- `packages/core/telemetry.ts` — span model with parent-child links.
- `docs/PLUGIN_MARKETPLACE.md` + `openhand plugins list` aware of remote
  manifest entries.
- `plugins/code-translator` (6th plugin).
- `openhand doctor` subcommand (env / network / sandbox preflight).

## iter-15 — v0.8-rc real providers + sandbox v2 + audit + metrics

- `tests/real/*.real.test.ts` — opt-in smoke against a real
  OpenAI / Anthropic / Ollama, gated on credentials/daemon and skipped
  otherwise. Hermetic CI keeps its budget; a contributor with a key can
  validate the wire format against a live backend.
- `packages/sandbox/v2.ts` — opt-in CPU/memory/network guards layered on
  top of v1. cgroup-v2 explicitly rejected as non-portable; portable
  fallbacks documented in `docs/SANDBOX_v2.md`.
- `openhand audit` — additive risk scoring per plugin permission, prints
  Markdown.
- `Counter` + `Histogram` + `Meter` in telemetry; reserved metric names
  exported as constants. No background push loop — that's a deployment
  concern.
- `scripts/demo-walkthrough.sh` produces `docs/DEMO.md` from a real CLI
  run, hermetic via `OPENHAND_HOME` + `LLM_PROVIDER=mock`.

## iter-16 — Chaos tests + bug bash

- `tests/chaos/*` — 36 adversarial tests. SIGKILL escalation paths,
  truncated SSE frames, plugin manifests with self-referential cycles,
  shell injection through positional args, `NET=none` flips mid-process,
  prlimit fallback when the binary is absent.
- All bugs found by chaos run fixed in the same commit.
- Smoke run still 383 tests, examples + CLI + server all green.

## iter-17 — Final consolidation (this iteration)

- This file (`docs/JOURNEY.md`).
- README badges synced to current reality (tests 383+, plugins 8,
  providers 4, cookbook 7).
- CHANGELOG verified to cover v0.1 → v0.8-rc with no gaps.
- `SECURITY.md` "Supported versions" expanded to a real range.
- Dead-link scan across `docs/`, `cookbook/`, `README.md`.
- **Constraint of this iteration**: no new features, no version bump, no
  new dependencies, no source-code edits. Pure documentation closure.

---

## Invariants we held across all 17 iterations

| Invariant                             | Mechanism                                     |
| ------------------------------------- | --------------------------------------------- |
| `npm audit` stays at 0 vulns          | iter-7 baseline; CI fails on any new finding  |
| `npm test` is hermetic                | `MockProvider` + `tests/real/*` opt-in only   |
| Sandbox denies by default             | policy file + 31 sandbox tests                |
| TypeScript is strict                  | `strict` + `noUncheckedIndexedAccess` on all  |
| Examples actually run                 | `scripts/runtime-integration.sh` on every PR  |
| One commit per iteration              | small, reviewable, revertable                 |

## What we deliberately did NOT do

- No vendor SDK imports — providers talk to vendor HTTP APIs directly so
  one company's breaking change doesn't ripple through the tree.
- No meta-framework — `packages/core` is small enough to read in a
  weekend on purpose.
- No background telemetry push loop — that's a deployment concern.
- No production isolation claim for `packages/sandbox` — `docs/SANDBOX_v2.md`
  points at Docker / Firecracker / nsjail for callers that need it.
