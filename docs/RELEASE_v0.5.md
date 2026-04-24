# OpenHand v0.5.0 — Release Overview

Consolidates seven iteration rounds (v0.1 → v0.5) into a single
contributor-facing narrative. Each round had a narrow focus; together they
turn OpenHand from "demo that boots" into "repo a stranger can actually
open, read, and ship a PR against".

## Timeline at a glance

| Round | Theme                                       | Biggest win                                           |
| ----- | ------------------------------------------- | ----------------------------------------------------- |
| 1     | Foundation                                  | Monorepo layout, `SecureSandbox`, first CLI demo       |
| 2     | Provider abstraction                        | `LLMClient` + OpenAI/Anthropic/Ollama providers        |
| 3     | Agent loop & task streaming                 | `Agent`, SSE task stream, approval-gated tools         |
| 4     | Contributor onramp                          | `CONTRIBUTING`, `SECURITY`, cookbook, launch collateral |
| 5     | Offline-first dev experience                | `MockProvider`, zero-setup `hello-world`                |
| 6     | Plugins + docs + launch assets              | `PluginLoader`, TypeDoc, landing page                   |
| 7     | Reflection, security, and release polish    | 0 audit vulns, `runRepl` unification, demo transcript   |

## What shipped in v0.5 specifically

### Security

- `npm audit` → **0 vulnerabilities** (was 16 in v0.4; 11 high, 1 critical).
- Dropped unused `puppeteer` runtime dep (it only ever appeared in
  `package.json`; the browser tools already used `fetch` + `cheerio`).
- Moved `nodemailer` to an optional `peerDependency` — only users who
  wire up real email provisioning install it.
- Bumped `uuid` to `^14` (core) and `vite` to `^7` (web) to clear
  the remaining transitive advisories.

### Correctness

- `SecureSandbox.getPolicy()` returns a frozen snapshot. `openhand status`
  now prints the real effective policy, not hard-coded strings.
- `PluginLoader.watch()` retries are capped (5 attempts, exponential
  backoff 100ms → 1.6s) and emit `retry-scheduled` / `retry-recovered`
  events so operators can see a flapping plugin instead of silently
  burning CPU.
- CLI default entry (`openhand` with no args) now reuses `runRepl` —
  one code path instead of two.

### Developer experience

- `scripts/generate-demo.sh` records a real run of `hello-world`,
  `agent-shell-loop`, and `shell-automation` into
  `docs/demo-transcript.md`. 98 lines, byte-reproducible because it
  uses the `MockProvider`.
- `examples/agent-shell-loop.ts` — 120-line mini agent loop: chat →
  decide → exec → observe. Good tutorial material and CI smoke test.
- `tsx` moved to root `devDependencies`; `npm run test:e2e` and
  `npm run bench` work immediately after `npm install`.
- `OPENHAND_BENCH_MODE=ci` (or `CI=true`) relaxes bench ops/sec bounds
  by 4x so shared runners don't flake.

## Test matrix at v0.5

| Surface              | Command                  | Result         |
| -------------------- | ------------------------ | -------------- |
| Unit tests           | `npm run test:unit`      | 100+ passing   |
| End-to-end           | `npm run test:e2e`       | 6/6 passing    |
| Benchmarks           | `npm run bench`          | 10/10 passing  |
| Typecheck            | `npm run typecheck`      | clean          |
| `npm audit`          | `npm audit`              | 0 vulns        |

## Upgrade notes

- No breaking changes to the public API of `@openhand/core`, `@openhand/llm`,
  `@openhand/sandbox`, or `@openhand/tools`. Every 0.4 plugin keeps working.
- If a downstream repo relied on `@openhand/tools` pulling in `puppeteer`,
  install it explicitly (`npm i puppeteer`) — or better, prefer `playwright`,
  which is now advertised as an optional peer.

## What's next

See `docs/GOOD_FIRST_ISSUES.md` for 12 candidate contributions.

The biggest open questions:

1. Do we replace `commander` / `inquirer` with a single zero-dep CLI
   module? The REPL already is zero-dep; the top-level command router
   is the last holdout.
2. Should `plugins/*` move to a separate `openhand-plugins` repo so the
   main repo stays core-only?
3. Is `MockProvider` rich enough to power a proper "replay" test mode
   (record real LLM turns, replay offline)?

Welcome PRs.
