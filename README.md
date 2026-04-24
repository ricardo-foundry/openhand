# OpenHand

**LLM-agnostic, plugin-first AI agent platform — sandboxed by default.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![CI](https://github.com/Ricardo-M-L/openhand/actions/workflows/ci.yml/badge.svg)](https://github.com/Ricardo-M-L/openhand/actions/workflows/ci.yml)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-3178c6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![npm workspaces](https://img.shields.io/badge/npm-workspaces-cb3837.svg?logo=npm&logoColor=white)](https://docs.npmjs.com/cli/v10/using-npm/workspaces)
[![Docker ready](https://img.shields.io/badge/Docker-ready-2496ED.svg?logo=docker&logoColor=white)](./docker-compose.yml)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](./CONTRIBUTING.md)

OpenHand is an open-source agent runtime you actually want to point at your
laptop: one provider-neutral LLM interface, a small set of audited tools, a
sandbox you can trust with `shell_exec`, and a plugin system that stays out
of core's way.

---

## Why OpenHand?

|                           | **OpenHand**                          | AutoGPT                     | CrewAI                      | LangChain Agents            |
| ------------------------- | ------------------------------------- | --------------------------- | --------------------------- | --------------------------- |
| Core lines of code        | Small, auditable `packages/core`      | Large, opinionated          | Medium                      | Very large meta-framework   |
| Sandbox by default        | Yes — `packages/sandbox`              | No                          | No                          | Optional                    |
| LLM provider lock-in      | None — `LLMProvider` interface        | OpenAI-first                | OpenAI-first                | Many, but heavy abstractions |
| Plugin story              | Manifest-driven, hot-registered       | Monolithic                  | Role-focused                | Chains / tools              |
| Interfaces shipped        | CLI + Web + HTTP server               | CLI                         | SDK                         | SDK                         |
| Typing                    | TypeScript strict, end-to-end         | Python                      | Python                      | Python / JS                 |

OpenHand is for builders who want **just enough framework** — an agent loop,
tool schema, policy, sandbox, LLM abstraction — and nothing you cannot read in
a weekend.

---

## Features

- **Provider-neutral LLM layer** — swap OpenAI, Anthropic, Ollama, or any
  OpenAI-compatible endpoint through one `LLMProvider` interface.
- **Sandboxed tool execution** — filesystem, shell, network, and email tools
  all run through `packages/sandbox` with configurable roots, timeouts, and
  output limits.
- **Policy-gated actions** — allow, deny, or require human approval per tool
  and per argument pattern.
- **Plugin-first** — drop a folder under `plugins/`, declare a manifest,
  register tools.
- **Three interfaces** — interactive CLI, React + Tailwind web UI, and a
  thin HTTP server you can embed.
- **Monorepo with npm workspaces** — `packages/{core,tools,sandbox,llm}` and
  `apps/{cli,server,web}`, each independently testable.
- **Dockerized web UI** — production-ready `apps/web` image served by nginx.

---

## Architecture

```mermaid
flowchart LR
    user([User])
    subgraph Apps
        CLI["apps/cli"]
        WEB["apps/web<br/>(React + Tailwind)"]
        SRV["apps/server<br/>(HTTP)"]
    end
    subgraph Packages
        CORE["packages/core<br/>agent + planner + policy"]
        TOOLS["packages/tools<br/>file / shell / browser / email"]
        SBX["packages/sandbox<br/>isolated exec"]
        LLM["packages/llm<br/>provider abstraction"]
    end
    PLUG["plugins/*"]
    PROV[("OpenAI / Anthropic /<br/>Ollama / custom")]

    user --> CLI
    user --> WEB
    WEB --> SRV
    CLI --> CORE
    SRV --> CORE
    CORE --> TOOLS
    CORE --> LLM
    TOOLS --> SBX
    LLM --> PROV
    PLUG -.registers tools.-> CORE
```

See **[`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)** for data flow and
module boundaries.

---

## Quickstart

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
npm install
npm run build
npm run dev                          # CLI + server + web in parallel
```

Run only the CLI:

```bash
npm --workspace @openhand/cli start
```

---

## Plugin system

Plugins live in `plugins/*`. Each plugin declares a manifest, exports tools,
and is picked up automatically at boot:

```text
plugins/weather/
├── manifest.json      # id, version, permissions, tool list
├── src/index.ts       # register(tools) { ... }
└── tests/
```

Full guide: **[`docs/PLUGIN_DEVELOPMENT.md`](./docs/PLUGIN_DEVELOPMENT.md)**.

---

## Documentation

- [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md) — modules, data flow, diagrams.
- [`docs/PLUGIN_DEVELOPMENT.md`](./docs/PLUGIN_DEVELOPMENT.md) — ship a plugin in 10 minutes.
- [`docs/SECURITY_MODEL.md`](./docs/SECURITY_MODEL.md) — sandbox, policy, approvals.
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — dev setup, tests, PR flow.
- [`SECURITY.md`](./SECURITY.md) — how to report a vulnerability.
- [`CHANGELOG.md`](./CHANGELOG.md) — what shipped in each release.

---

## Contributing

PRs are welcome — see [`CONTRIBUTING.md`](./CONTRIBUTING.md). Good first issues
are labelled `good first issue` on the tracker. If you want to add an LLM
provider or a tool plugin, start there.

---

## License

[MIT](./LICENSE) — use it, fork it, ship it. Attribution appreciated but not
required.
