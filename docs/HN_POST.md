# HN launch post

**Title:** `Show HN: OpenHand – an AI agent that earns its permissions`

**URL:** `https://github.com/Ricardo-M-L/openhand`

**Body:**

Hi HN — I've been building OpenHand, a secure, LLM-agnostic AI agent
framework. Source and docs at the link.

The short pitch: the "AI agent" category is mostly demos where the
model is the trusted logic and the shell is its toy. OpenHand inverts
that. Every tool the agent can call is declared with explicit
permissions (`fs:write`, `network:http`, `shell:exec`, …). Every shell
command runs through a sandbox policy — allow-listed binaries,
allow-listed paths, memory cap, wall-clock timeout, hard SIGKILL
after SIGTERM. Anything destructive goes through an approval queue.

A few things I'm happy with:

- **Zero runtime deps** in `@openhand/llm` (four providers: OpenAI,
  Anthropic, Ollama, Mock) and `@openhand/sandbox`. Both are
  implemented with raw `fetch` and `child_process.spawn`.
- **160+ tests**, all `node:test`. No Jest, no Vitest. The full test
  suite includes end-to-end tests that spin a real HTTP server + drive
  the CLI REPL, plus micro-benchmarks with hard perf thresholds so
  regressions fail CI.
- **Strict TypeScript**: `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`, `noImplicitOverride` across every
  workspace. `tsc --noEmit` is clean.
- **Zero-setup demo**: `npm install && npx tsx examples/hello-world.ts`
  runs against an in-process `MockProvider` and prints a reply. No API
  key, no network, no Docker.
- **Plugins in 30 lines**. A plugin is a folder with a manifest and an
  `index.js` exporting a `tools[]` array. This release ships
  `rss-digest`, `code-reviewer` (hand it a `git diff`, get a scored
  Markdown review), and `file-organizer` (dry-run by default — won't
  rename anything without a second explicit call).

Anti-goals I want to be upfront about:

- It is **not** a LangChain replacement. The planner is intentionally
  simple; I'd rather read 400 lines of planning code than pull in a
  flowchart framework.
- It is **not** an auto-pilot. Destructive actions need approval.
  "Just run it" is not a mode the agent ships with.
- It is **not** a hosted product. It runs on your machine, your
  server, your cluster. No telemetry, no phone-home.

Things I'd love feedback on: the sandbox policy surface (is the
command/path allow-list the right shape?), the plugin permission spec
(should it be tighter / capability-based?), and the provider
interface (is one `complete()` + one `stream()` enough?).

Repo: https://github.com/Ricardo-M-L/openhand — MIT licensed.

Happy to answer anything in the thread.
