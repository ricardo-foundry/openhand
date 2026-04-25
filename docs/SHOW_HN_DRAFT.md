# Show HN draft — OpenHand v0.8

A throwaway working doc. Final wording goes to `news.ycombinator.com/submit`
unchanged from the **Body** block below. The title cap is 80 chars; HN
strips trailing punctuation, so don't end on `.` or `!`.

---

## Title (pick one — A is the front-runner)

- **A.** `Show HN: OpenHand – LLM-agnostic agent runtime, sandboxed by default`
- **B.** `Show HN: OpenHand – an AI agent runtime that earns its permissions`
- **C.** `Show HN: OpenHand – plugin-first agent framework with 0 SDK deps`

A reads cleanest, tells you what it *is* (runtime, not framework, not
SaaS) and what it *does* differently (sandboxed by default) in one line.

## URL

`https://github.com/ricardo-foundry/openhand`

(NOT a /releases/tag URL — HN's algorithm prefers repo roots, and the
README is the landing page anyway.)

## Body

> Hi HN — I've been building **OpenHand**, an agent runtime where every
> tool call earns its permissions instead of inheriting them. v0.8
> dropped today. Source and docs are at the link.
>
> The short pitch: most "AI agent" repos hand the model a shell at boot
> and then bolt safety on as a wrapper. OpenHand inverts that. The
> sandbox is the default; the agent has to ask, the policy decides, and
> destructive paths go through an approval queue.
>
> Some specifics, in case the README's TL;DR didn't land:
>
> - **LLM-agnostic.** One `LLMClient` interface, four built-in providers
>   (OpenAI, Anthropic, Ollama, Mock). Zero vendor SDKs in the runtime —
>   `@openhand/llm` is implemented in raw `fetch`. Swap providers with a
>   single env var; the same `examples/hello-world.ts` runs against all
>   four.
>
> - **Sandboxed by default.** `@openhand/sandbox` is a pure-function
>   policy engine over `(command, policy) → decision`, plus a
>   `child_process.spawn` wrapper that enforces an allow-list of
>   binaries, an allow-list of paths, a wall-clock timeout, a
>   `ulimit`-backed memory cap, and a hard `SIGKILL` after `SIGTERM`.
>   Shell metachars and `-c` interpreter flags are denied at the policy
>   layer, before the spawn ever happens. 31 sandbox-policy tests cover
>   the shape.
>
> - **0 vulnerabilities.** `npm audit` clean, held since v0.5 and
>   verified at every iteration up to v0.8. The runtime has 4
>   dependencies total (`eventemitter3`, `uuid`, `express`, `cors`).
>   Ripped out `puppeteer` in v0.5 specifically to get there.
>
> - **8 in-tree plugins**, each in its own workspace with its own
>   `tests/` folder: `calculator`, `code-reviewer`, `code-translator`,
>   `file-organizer`, `git-summary`, `rss-digest`, `weather`,
>   `web-scraper`. Hot-reload works in the REPL — drop a file, it shows
>   up in `/plugins`.
>
> - **Monorepo.** npm workspaces — `packages/*` (core/llm/sandbox/policy/
>   plugin-host/runtime), `apps/*` (cli/server/web), `plugins/*`,
>   `examples/*`, `cookbook/*`, `tests/{integration,e2e,chaos}/*`,
>   `bench/*`. One `npm test` from root runs 383+ tests across them all.
>
> - **Cookbook of 7 runnable recipes** — hello-world, writing a plugin,
>   custom LLM provider, sandboxed shell, streaming UI, multi-agent
>   router→worker, streaming tool-use. Every recipe has a sibling
>   `examples/*.ts` that's executed by `node:test` so docs can't drift.
>
> - **Strict TypeScript.** `strict + noUncheckedIndexedAccess +
>   exactOptionalPropertyTypes + noImplicitOverride` in every
>   workspace. `tsc --noEmit` is clean across the repo.
>
> Things I'd love feedback on, in this order:
>
> 1. **The sandbox model.** Pure-function policy + spawn wrapper —
>    enough? Should the `ulimit` lane reach for cgroups when the kernel
>    has them? See `packages/sandbox/src/policy.ts`.
> 2. **Provider plurality vs. depth.** Four providers in v0.8, none of
>    them auto-stream tool calls yet (the wire format is supported, but
>    the deltas land as a single chunk on the terminal frame). Roadmap
>    has it for v0.9 — would you rather we widen first (Bedrock,
>    Together, Fireworks) or finish streaming-tool-use across the
>    existing four?
> 3. **Plugin permissions.** Today they're declared as a string array
>    (`['fs:write', 'network:http']`) and enforced at the runtime. Worth
>    promoting to a typed grammar with capability tokens?
>
> Quickstart is three commands and zero keys (uses `MockProvider`):
>
>     git clone https://github.com/ricardo-foundry/openhand
>     cd openhand && npm install
>     npx tsx examples/hello-world.ts
>
> Real backends:
>
>     LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:0.5b npx tsx examples/hello-world.ts
>     LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npx tsx examples/hello-world.ts
>     LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=sk-... npx tsx examples/hello-world.ts
>
> MIT, no telemetry, no signup. Happy to answer anything in the thread.

## Posting plan

- **Window**: Tue–Thu, 09:00–11:00 ET. Submission timestamp goes in the
  release issue so we don't double-post.
- **First comment** (within 60 s of submit, from author): pin a comment
  with the v0.8 release-notes link and a one-liner on what changed since
  v0.7. HN treats first-comment-as-author as "OP intent", and it
  pre-empts a "what's new?" reply.
- **Refresh discipline**: don't refresh-vote. Don't ask anyone to
  upvote. Don't link the post in Slack/Twitter/Discord until 4 h after
  submit (HN penalises "vote rings"; the front page is detected
  organically).
- **Engagement**: stay in the thread for the first 6 h. Reply within 15
  min for the first hour, hourly after that. Keep replies under 5
  paragraphs.
- **Cross-post** (after the HN window closes, only if it ranked):
  /r/programming, /r/MachineLearning (Show & Tell tag), Lobsters,
  Hackernoon. Never simultaneous with HN.

## Pre-flight (mirrors RELEASE_CHECKLIST.md items 28–30)

- [ ] Title + body proofread out loud.
- [ ] All links resolve to the v0.8 tag, not `main`.
- [ ] `landing/build-meta.json` numbers match what the body claims (8
      plugins, 7 cookbook, 0 vulns, 383+ tests, 4 providers).
- [ ] Sister-project links live (`docs/CROSSPROMO.md`, item 30 of the
      release checklist).
- [ ] First-comment text drafted in a separate scratchpad, ready to
      paste.

## Post-mortem template (fill within 24 h of submit)

| Field | Value |
| --- | --- |
| Submit time (ET) | |
| Peak rank | |
| Front-page minutes | |
| Comments | |
| Stars delta | |
| What landed | |
| What I'd change | |

That last row is the only one that matters — it feeds the next
launch's draft.
