# OpenHand Cookbook

Short, copy-pasteable recipes. Each one is **200–400 words, code-first**, and
runs against a real workspace install (`npm install && npm run build` from the
repo root).

If you only have time to read one, read **[01-hello-world](./01-hello-world.md)**.

| #  | Recipe                                              | What you'll learn                                                | Setup    |
|----|-----------------------------------------------------|-------------------------------------------------------------------|----------|
| 01 | [Hello World](./01-hello-world.md)                  | Drive an agent end-to-end with zero API keys (Ollama).            | 5 min    |
| 02 | [Writing a plugin](./02-writing-a-plugin.md)        | Ship a 60-line RSS plugin that the agent can call.                | 15 min   |
| 03 | [Custom LLM provider](./03-custom-llm-provider.md)  | Point the LLM layer at any OpenAI-compatible local server.        | 10 min   |
| 04 | [Sandboxed shell](./04-sandboxed-shell.md)          | Watch the sandbox reject `rm -rf $HOME` at parse time.            | 5 min    |
| 05 | [Streaming UI](./05-streaming-ui.md)                | Tail the SSE task stream from a 30-line React component.          | 10 min   |

## Conventions

- Code blocks are tagged with the language we expect you to run them in
  (`bash`, `ts`, `tsx`, `json`).
- Paths are relative to the repo root unless noted.
- Where a recipe needs an LLM, it defaults to **Ollama** so you don't need to
  spend money or sign up for anything to follow along.

## Companion examples

Each recipe links to a runnable script under [`examples/`](../examples/).
Running an example is always:

```bash
npx tsx examples/<name>.ts
```

## Contributing a recipe

Open a PR with a new `cookbook/NN-title.md`. Keep it under 400 words, lean on
real code, and link to anything in `examples/` that demonstrates the result.
