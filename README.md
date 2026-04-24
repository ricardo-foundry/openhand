<!-- Hero -->
<div align="center">

```
  ██████╗ ██████╗ ███████╗███╗   ██╗   ██╗  ██╗ █████╗ ███╗   ██╗██████╗
 ██╔═══██╗██╔══██╗██╔════╝████╗  ██║   ██║  ██║██╔══██╗████╗  ██║██╔══██╗
 ██║   ██║██████╔╝█████╗  ██╔██╗ ██║   ███████║███████║██╔██╗ ██║██║  ██║
 ██║   ██║██╔═══╝ ██╔══╝  ██║╚██╗██║   ██╔══██║██╔══██║██║╚██╗██║██║  ██║
 ╚██████╔╝██║     ███████╗██║ ╚████║   ██║  ██║██║  ██║██║ ╚████║██████╔╝
  ╚═════╝ ╚═╝     ╚══════╝╚═╝  ╚═══╝   ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝
```

**LLM-agnostic, plugin-first, sandboxed by default.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://img.shields.io/github/actions/workflow/status/Ricardo-M-L/openhand/ci.yml?label=CI&logo=githubactions&logoColor=white)](https://github.com/Ricardo-M-L/openhand/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node](https://img.shields.io/badge/Node-%3E%3D20-339933.svg?logo=node.js&logoColor=white)](https://nodejs.org)
[![Monorepo](https://img.shields.io/badge/npm-workspaces-cb3837.svg?logo=npm&logoColor=white)](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./docker-compose.yml)
[![Tests](https://img.shields.io/badge/tests-121%20passing-success.svg)](./CHANGELOG.md)
[![Issues welcome](https://img.shields.io/badge/issues-welcome-brightgreen.svg)](https://github.com/Ricardo-M-L/openhand/issues)

[![Stars over time](https://starchart.cc/Ricardo-M-L/openhand.svg?variant=adaptive)](https://starchart.cc/Ricardo-M-L/openhand)

</div>

OpenHand is a small, **opinionated** agent runtime: one provider-neutral LLM
interface, an audited tool layer, a sandbox you can trust with `shell_exec`,
and a plugin system that stays out of core's way. No vendor SDKs, no meta-
framework — just enough framework that you can read the whole `packages/core`
in a weekend.

---

## ▶ 5-minute Quickstart

```bash
git clone https://github.com/Ricardo-M-L/openhand.git && cd openhand
npm install && npm run build
LLM_PROVIDER=ollama LLM_MODEL=qwen2.5:0.5b npx tsx examples/hello-world.ts
```

That's it — three commands and you have a real agent talking to a local
Ollama daemon. No API key, no signup. Drop `LLM_PROVIDER=openai` (with
`OPENAI_API_KEY=...`) or `=anthropic` and the same code works.

| I want to…                                  | Read this                                                       |
|---------------------------------------------|------------------------------------------------------------------|
| Try the smallest possible example           | [`cookbook/01-hello-world.md`](./cookbook/01-hello-world.md)     |
| Add my own tool to the agent                | [`cookbook/02-writing-a-plugin.md`](./cookbook/02-writing-a-plugin.md) |
| Use my own LLM (vLLM / LM Studio / Bedrock) | [`cookbook/03-custom-llm-provider.md`](./cookbook/03-custom-llm-provider.md) |
| Confirm the sandbox actually denies things  | [`cookbook/04-sandboxed-shell.md`](./cookbook/04-sandboxed-shell.md) |
| Stream task events into a React app         | [`cookbook/05-streaming-ui.md`](./cookbook/05-streaming-ui.md)   |
| Read every recipe                           | [`cookbook/README.md`](./cookbook/README.md)                     |

---

## Why OpenHand?

|                              | **OpenHand**                          | AutoGPT                | CrewAI                  | LangChain Agents       |
| ---------------------------- | ------------------------------------- | ---------------------- | ----------------------- | ---------------------- |
| Provider lock-in             | **none** — `LLMProvider` interface    | OpenAI-first           | OpenAI-first            | many, heavy            |
| Sandbox by default           | **yes** — `packages/sandbox`          | no                     | no                      | opt-in                 |
| Hot-reload plugins           | **yes** (`fs.watch`)                  | no                     | no                      | restart                |
| Core LOC you can read        | **small**, auditable                  | large, opinionated     | medium                  | very large             |
| Typing                       | **TS strict** end-to-end              | Python                 | Python                  | Python / JS            |
| Interfaces shipped           | CLI + Web + HTTP server               | CLI                    | SDK                     | SDK                    |

OpenHand is for builders who want **just enough framework** — an agent loop,
tool schema, policy, sandbox, LLM abstraction — and nothing they cannot
delete in a weekend if priorities shift.

---

## What can you actually build with this?

Concrete projects, all under 100 lines of glue, all already runnable today:

1. **Weather bot** — wire the in-tree `plugins/weather` to the REPL, ask
   *"what's the weather in Tokyo?"*, the agent picks the tool and answers.
2. **Code reviewer** — allow `git`, `cat`, `grep` in the sandbox; ask the
   agent to read `git diff HEAD~1..HEAD` and post inline comments.
3. **RSS digest agent** — 60-line plugin (cookbook 02) + 5-minute cron
   pulls Hacker News and pushes a Markdown digest to Slack/Server酱.
4. **Shell automation helper** — sandboxed shell + agent loop = a deploy
   assistant that can `git pull` and `npm test` but cannot `rm -rf`.

See the working scripts in [`examples/`](./examples/).

---

## How it's organized

```mermaid
flowchart LR
  user([User])
  subgraph Apps["apps/"]
    CLI["cli<br/>(REPL)"]
    WEB["web<br/>(React + Tailwind)"]
    SRV["server<br/>(HTTP + SSE)"]
  end
  subgraph Packages["packages/"]
    CORE["core<br/>agent · planner · policy"]
    TOOLS["tools<br/>file · shell · http · email"]
    SBX["sandbox<br/>spawn · policy · checks"]
    LLM["llm<br/>providers + LLMClient"]
  end
  PLUG["plugins/*<br/>(weather, calculator, rss…)"]
  PROV[("OpenAI · Anthropic · Ollama · custom")]

  user --> CLI
  user --> WEB
  WEB --> SRV
  CLI --> CORE
  SRV --> CORE
  CORE --> TOOLS
  CORE --> LLM
  TOOLS --> SBX
  LLM --> PROV
  PLUG -.discovers + registers tools.-> CORE
```

Apps depend on packages. Plugins are *discovered*, not imported. Providers
are a swap — every provider implements the same `LLMProvider` interface.

See [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) for the data flow and
boundary rules.

---

## Features

- **Provider-neutral LLM layer** — OpenAI, Anthropic Messages, and Ollama
  ship in-box behind one `LLMProvider` interface, selected at runtime by
  `LLM_PROVIDER=...`. Every wire format is a `fetch` wrapper — no vendor
  SDK, no version drift.
- **`LLMClient` decorator** — exponential-backoff retry, AbortController
  timeouts, FIFO token-bucket rate limiter, accumulating cost tracker.
  Wraps any provider.
- **Sandboxed tool execution** — filesystem, shell, network, and email
  tools all route through `packages/sandbox` with configurable roots,
  timeouts, and output limits. Shell metacharacters and interpreter eval
  flags are rejected at parse time so a confused model can't shell-escape.
- **Policy-gated actions** — allow, deny, or require human approval per
  tool and argument pattern. Pure functions, fully unit-tested.
- **Plugin-first with hot reload** — drop a folder under `plugins/`,
  declare an `openhand` manifest in `package.json`, and `PluginLoader`
  finds it. `loader.watch()` reloads on edits via `fs.watch` (with a 100ms
  retry to ride out half-written files).
- **Interactive CLI REPL** — `openhand chat` gives you `/help`, `/model`,
  `/reset`, `/save`, `/exit`, ANSI spinner, ctrl+c handling, and persisted
  config — all with zero extra deps.
- **Live web task stream** — `GET /api/tasks/:id/stream` is a real SSE
  feed with `Last-Event-ID` resume and a per-task ring buffer.
- **Monorepo with npm workspaces** — `packages/{core,tools,sandbox,llm}`
  and `apps/{cli,server,web}`, each independently testable. **121 tests**
  across six workspaces.

---

## Quickstart — full options

### Option A — Docker (web UI + server)

```bash
git clone https://github.com/Ricardo-M-L/openhand.git
cd openhand
cp .env.example .env                 # fill in at least one LLM key
docker compose up --build
# Web:    http://localhost:3000
# Server: http://localhost:3001
```

### Option B — Local dev (all workspaces)

```bash
git clone https://github.com/Ricardo-M-L/openhand.git
cd openhand
cp .env.example .env
npm install && npm run build
npm run dev                          # CLI + server + web in parallel
```

### Option C — REPL only

```bash
npm --workspace @openhand/cli start
# or, after `npm run build`:
openhand chat
```

Inside the REPL:

```text
> /help
Available commands:
  /help             show this list
  /model <name>     switch model (also accepts "<provider>:<model>")
  /reset            clear history for the current session
  /save             persist config to ~/.openhand/config.json
  /exit             leave the REPL
> /model anthropic:claude-3-5-sonnet-latest
switched to anthropic/claude-3-5-sonnet-latest
> summarize CHANGELOG.md
(spinner...)
```

### Option D — Watch a task from the web UI

```bash
# Terminal 1
npm run dev:server
# Terminal 2
curl -N http://localhost:3001/api/tasks/demo-1/stream &
curl -X POST http://localhost:3001/api/tasks/demo-1/_demo
# -> streams 4 SSE events (pending → running → running → completed)
```

---

## LLMClient — scope and limits

`LLMClient` is convenient but **in-process**:

- The token-bucket rate limiter lives in the JS heap of one Node process.
  Two pods of the same service will each have their own bucket.
- `InMemoryCostTracker` is the same story — per-instance.

That's deliberate: we don't want to ship a Redis dependency in the default
path. For multi-pod deployments where one quota must be shared across
replicas, swap in a Redis-backed bucket and a `costTracker` that writes to
your shared store. Both are single-method interfaces — see
`packages/llm/src/client.ts` for the contracts.

---

## Plugin system

Plugins live in `plugins/*`. Each plugin declares a manifest inside
`package.json` under the `openhand` key, exports tools, and is picked up
automatically at boot:

```text
plugins/calculator/
├── package.json       # { "openhand": { "id": "calculator", "entry": "./index.js" } }
├── index.js           # module.exports = { tools: [...], onEnable() {...} }
├── README.md
└── tests/calculator.test.js
```

Three example plugins ship in-tree:

- **`plugins/weather`** — minimal mock API to show the shape of a plugin.
- **`plugins/calculator`** — safe arithmetic evaluator (no `eval`, no
  `new Function`) that agents can call for math.
- **`cookbook/02`** — 60-line RSS plugin you can copy-paste into
  `plugins/rss/`.

Full guide: [`docs/PLUGIN_DEVELOPMENT.md`](./docs/PLUGIN_DEVELOPMENT.md) and
[`cookbook/02-writing-a-plugin.md`](./cookbook/02-writing-a-plugin.md).

---

## Documentation

- [`cookbook/`](./cookbook/) — five short, code-first recipes.
- [`examples/`](./examples/) — runnable companion scripts.
- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — modules, data flow, diagrams.
- [`docs/PLUGIN_DEVELOPMENT.md`](./docs/PLUGIN_DEVELOPMENT.md) — ship a plugin in 10 minutes.
- [`docs/SECURITY_MODEL.md`](./docs/SECURITY_MODEL.md) — sandbox, policy, approvals.
- [`landing/README.md`](./landing/README.md) — GitHub Pages source.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev setup, tests, PR flow.
- [`SECURITY.md`](./SECURITY.md) — how to report a vulnerability.
- [`CHANGELOG.md`](./CHANGELOG.md) — what shipped in each release.

---

## Contributing

PRs are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Good first
issues are labelled `good first issue` on the tracker. If you want to add
an LLM provider or a tool plugin, start there.

---

## License

[MIT](./LICENSE) — use it, fork it, ship it. Attribution appreciated but
not required.
