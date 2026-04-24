# Good First Issues

Twelve hand-curated starter tasks. Each has a clear scope, a pointer to the
file(s) that need to change, and a rough size estimate. If you pick one up,
please drop a comment on the corresponding GitHub issue so nobody
duplicates your work.

Size key: **S** ≈ < 1 hr, **M** ≈ 1-3 hrs, **L** ≈ half a day.

---

## 1. Add `/clear` slash command to the REPL (S)

`apps/cli/src/repl.ts` — the slash-command switch already has
`/help`, `/model`, `/reset`, `/save`, `/exit`. Add `/clear` that wipes the
terminal screen (ANSI `\x1b[2J\x1b[H`) without touching config or history.
Mirror the tests in `apps/cli/tests/repl.test.ts`.

## 2. Surface `retry-scheduled` events in `plugins reload` output (S)

`apps/cli/src/commands/plugins.ts`, `packages/core/src/plugin-loader.ts`.
The loader now emits `retry-scheduled` / `retry-recovered`. Hook them up
to the CLI so `openhand plugins reload` prints `retrying weather (attempt
2, in 400ms)` instead of silent waiting.

## 3. Add `MockProvider.recordedReplay()` factory (M)

`packages/llm/src/mock.ts`. Take a JSON array of `(prompt, reply)` tuples
recorded from a real run and replay them in order. This unlocks
deterministic tests for tutorials that want real-ish LLM behavior.

## 4. `openhand config --reset` subcommand (S)

`apps/cli/src/commands/config.ts`. Blow away `~/.openhand/config.json`
after a yes/no prompt. Include a `--yes` flag so scripts can skip the
prompt.

## 5. Document the SSE task-stream event schema (S — docs only)

`docs/ARCHITECTURE.md` has a paragraph; it needs a full reference. List
every event type (`running` / `completed` / `failed`), the `data`
payload shape, and when each is emitted. Cross-link from
`apps/server/src/task-stream.ts`.

## 6. Add `browser_fetch` POST-body JSON parsing shortcut (M)

`packages/tools/src/browser/index.ts`. Accept `bodyJson: object` as an
alternative to `body: string` and wrap it with
`Content-Type: application/json`. Add two tests.

## 7. Flesh out `plugins/weather` with real Open-Meteo (M)

`plugins/weather/index.js` currently returns a stub. Swap in a real call
to `https://api.open-meteo.com/v1/forecast` (no API key required). Honor
`assertSafeUrl` in `packages/tools/src/browser/index.ts`.

## 8. Make `openhand status` output JSON-friendly (S)

`apps/cli/src/commands/status.ts`. Add `--json` flag that emits the same
data as a single JSON document instead of human text. Handy for scripts.

## 9. Add a `--timeout <ms>` global flag to the CLI (M)

`apps/cli/src/index.ts` + `apps/cli/src/cli.ts`. Propagate it into
`SecureSandbox` config and `LLMClient`'s `timeoutMs`. One new test in
`apps/cli/tests/`.

## 10. Cookbook recipe: "Build an allow-list of domains for the fetcher" (M — docs only)

`cookbook/06-fetch-allowlist.md` (new). Show how to wrap
`assertSafeUrl` to additionally enforce a caller-provided domain
allow-list. Cross-link from `SECURITY.md`.

## 11. Dependabot config (S — infra)

`.github/dependabot.yml`. Weekly npm updates, grouped by dev vs runtime,
auto-merge of patch updates once CI is green. Example configs live in
the Dependabot docs; copy-paste and tweak.

## 12. Benchmark: `Agent.chat()` turnaround with MockProvider (L)

`bench/agent-chat.bench.ts` (new). Construct an `Agent` backed by a
`MockProvider`, fire 1000 `chat()` calls, assert ops/sec stays above
a tight bound. Re-uses the same `OPENHAND_BENCH_MODE=ci` pattern as
`bench/llm-client.bench.ts`.

---

## How to claim one

1. Open / pick an issue on GitHub with the `good first issue` label.
2. Comment "I'm taking this" so it's clear to other contributors.
3. Read `CONTRIBUTING.md` for the branch/commit conventions.
4. Run `npm install && npm run typecheck && npm run test:unit` before
   opening your PR — that's what CI will run first.
5. PR reviews happen in public. Feedback is about the code, not you.
