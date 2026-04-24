# OpenHand — Press Kit

## One-liner

> OpenHand is an open-source, LLM-agnostic AI agent that treats every
> filesystem, shell, and network action as a permission it has to earn.

## Elevator pitch (30 seconds)

OpenHand is a secure AI agent framework for developers. It runs
locally, speaks OpenAI / Anthropic / Ollama (or your own provider),
and executes every shell command and file write inside a sandbox with
an explicit permission allow-list. Risky actions go through an
approval queue. The whole thing is a tiny monorepo with zero runtime
dependencies in the security-critical packages, 160+ tests, and an
auto-generated TypeDoc reference.

## Two-minute explainer

AI agents are great at writing code, summarising repos, triaging
email. They are also great at `rm -rf /` when a scraped webpage
convinces them to. OpenHand is built on the assumption that the model
is untrusted input, not trusted logic.

That shows up in four places:

1. **Sandbox.** `@openhand/sandbox` spawns every command through a
   policy engine: allow-listed binaries, allow-listed paths, memory
   cap, wall-clock timeout, and a hard `SIGKILL` after SIGTERM.
2. **Permissioned tools.** Each tool declares what it needs
   (`fs:write`, `network:http`, `shell:exec`, …). The agent refuses to
   dispatch anything whose declared permissions exceed the session
   policy. Risky ones go through an approval queue.
3. **LLM-agnostic client.** One `LLMProvider` interface, four
   implementations (OpenAI, Anthropic, Ollama, Mock). Retry,
   rate-limit, and cost tracking live in `LLMClient`, not in the
   providers.
4. **Plugin isolation.** Plugins are folders with a manifest. The
   loader hot-reloads them, evicts the require cache, and asserts
   their declared permissions against policy before routing calls.

## At a glance

| Dimension              | Value                                               |
|------------------------|-----------------------------------------------------|
| License                | MIT                                                 |
| Repo                   | https://github.com/Ricardo-M-L/openhand             |
| Tests                  | 160+ (`node:test`, no framework)                    |
| Runtime deps           | 0 in `@openhand/llm`, `@openhand/sandbox`           |
| Providers              | OpenAI, Anthropic, Ollama, Mock, custom             |
| Strict TS              | Yes (`noUncheckedIndexedAccess`, `exactOptional…`)  |
| Plugins shipped        | 5 (`calculator`, `weather`, `rss-digest`, `code-reviewer`, `file-organizer`) |
| Docs                   | Cookbook + ARCHITECTURE + SECURITY + auto TypeDoc  |

## Tweet (270 chars)

> Shipped OpenHand: an MIT-licensed AI agent with a real sandbox,
> permissioned tools, pluggable LLM providers (OpenAI / Anthropic /
> Ollama / Mock), and zero runtime deps in the security packages.
> 160+ tests, strict TS. Runs offline on first clone.
> github.com/Ricardo-M-L/openhand

## Quote

> "The model is untrusted input. Every action has to earn its way out
> of the sandbox." — OpenHand README

## Assets

- `landing/` — static landing page, deployed to GitHub Pages.
- `docs/api/` — auto-generated TypeDoc API reference.
- `docs/ARCHITECTURE.md` — deep dive into the agent loop and event flow.
- `docs/SECURITY_MODEL.md` — sandbox + permission design.
