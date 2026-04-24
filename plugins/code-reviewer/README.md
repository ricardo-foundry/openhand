# @openhand/plugin-code-reviewer

Takes a unified diff, asks the LLM for a structured review, and renders a
Markdown report ready to paste into a PR comment.

## What it does

| Tool                 | Description                                                  |
|----------------------|--------------------------------------------------------------|
| `code_review`        | Stats + LLM-generated JSON review + Markdown report.         |
| `code_review_stats`  | Diff stats only — no LLM call, useful as a dry-run.          |

The plugin is **provider-agnostic**. It never imports `@openhand/llm`; it
accepts any object shaped like `{ complete({ model, messages }) }`. That
means the same code path works with `OpenAIProvider`, `AnthropicProvider`,
`OllamaProvider`, or the `MockProvider` used in tests.

## Schema the model is asked to return

```json
{
  "summary": "...",
  "verdict": "approve" | "request-changes" | "comment",
  "scores": { "correctness": 1..5, "safety": 1..5,
              "readability": 1..5, "tests": 1..5 },
  "findings": [
    { "severity": "info"|"minor"|"major"|"blocker",
      "file": "…", "message": "…" }
  ]
}
```

If the model returns non-JSON or gets confused, the plugin falls back to a
neutral `comment` verdict with a placeholder summary — it never throws on
bad LLM output.

## Permissions

- `llm:chat` — the plugin calls `llm.complete(...)` on whichever provider
  the host passes through `context.llm`.

## Tests

```bash
cd plugins/code-reviewer && npm test
```

Six tests cover diff parsing, prompt assembly, tolerant JSON parse,
end-to-end `runReview` against a fake `{complete}` provider, and Markdown
rendering shape.
