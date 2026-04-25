# OpenHand Cookbook

Short, copy-pasteable recipes. Each one is **200–400 words, code-first**, and
runs against a real workspace install (`npm install && npm run build` from the
repo root).

If you only have time to read one, read **[01-hello-world](./01-hello-world.md)**.

| #  | Recipe                                                          | What you'll learn                                                | Setup    |
|----|-----------------------------------------------------------------|-------------------------------------------------------------------|----------|
| 01 | [Hello World](./01-hello-world.md)                              | Drive an agent end-to-end with zero API keys (Ollama).            | 5 min    |
| 02 | [Writing a plugin](./02-writing-a-plugin.md)                    | Ship a 60-line RSS plugin that the agent can call.                | 15 min   |
| 03 | [Custom LLM provider](./03-custom-llm-provider.md)              | Point the LLM layer at any OpenAI-compatible local server.        | 10 min   |
| 04 | [Sandboxed shell](./04-sandboxed-shell.md)                      | Watch the sandbox reject `rm -rf $HOME` at parse time.            | 5 min    |
| 05 | [Streaming UI](./05-streaming-ui.md)                            | Tail the SSE task stream from a 30-line React component.          | 10 min   |
| 06 | [Multi-agent orchestration](./06-multi-agent-orchestration.md)  | Router + worker agents in ~80 lines using `core` + `llm`.         | 15 min   |
| 07 | [Streaming + tool use](./07-streaming-tool-use.md)              | Drain `stream()` and run tools mid-flight without buffering.      | 15 min   |
| 08 | [MCP integration](./08-mcp-integration.md)                      | Bridge any Model Context Protocol server's tools into OpenHand.   | 10 min   |
| 09 | [Quick plugin (`plugin:new`)](./09-quick-plugin.md)             | Scaffold + ship a fresh plugin end-to-end with `npm run plugin:new`. | 5 min    |

## Companion runnables (no separate write-up yet)

- [`examples/agent-shell-loop.ts`](../examples/agent-shell-loop.ts) —
  120-line chat → decide → exec → observe loop. Runs offline against
  `MockProvider`.
- [`examples/shell-automation.ts`](../examples/shell-automation.ts) —
  pure-function probe showing exactly which commands / paths the
  sandbox allows and denies. Deterministic, safe for CI.
- [`docs/demo-transcript.md`](../docs/demo-transcript.md) — recorded
  transcript of every example above, regenerable via
  `scripts/generate-demo.sh`.

## Conventions

- Code blocks are tagged with the language we expect you to run them in
  (`bash`, `ts`, `tsx`, `json`).
- Paths are relative to the repo root unless noted.
- Where a recipe needs an LLM, it defaults to the **in-process `MockProvider`**
  so you don't need an API key, Docker, or even Ollama. Set
  `LLM_PROVIDER=openai|anthropic|ollama` to point at a real backend.

## Companion examples

Each recipe links to a runnable script under [`examples/`](../examples/).
Running an example is always:

```bash
npx tsx examples/<name>.ts
```

## Contributing a recipe

Open a PR with a new `cookbook/NN-title.md`. Keep it under 400 words, lean on
real code, and link to anything in `examples/` that demonstrates the result.
