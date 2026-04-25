# `@openhand/plugin-git-summary`

Turn a stretch of `git log` output into a structured PR description,
changelog entry, or release-notes block. The plugin handles parsing,
prompts, JSON repair, and Markdown rendering — you bring the LLM and
the log.

## What it gives you

| Tool | Calls LLM? | Returns |
| --- | --- | --- |
| `git_summary` | yes | `{ summary, stats, render }` — `render` is paste-ready Markdown |
| `git_summary_stats` | no | `{ commits, totals, byType }` — pure parser, useful for sanity checks |

The tool is provider-agnostic. Pass any object with a
`complete({ messages, model }) -> { content }` shape — `MockProvider`,
`LLMClient`, or a custom adapter.

## Quick demo

```js
const plugin = require('@openhand/plugin-git-summary');

const log = `
abc1234 feat(api): add /v2/search endpoint
def5678 fix(parser): handle CRLF correctly
9abcdef chore(deps): bump typescript to 5.4
`;

const result = await plugin.runSummary({
  log,
  format: 'pr',          // or 'changelog' | 'release'
  audience: 'reviewers',
  llm: myLLM,            // anything with .complete()
});

console.log(result.render);  // Markdown ready for the PR description
```

## Inside the prompt

We send the LLM a strict JSON schema with `title`, `summary`,
`sections[]`, `breaking[]`, and `callouts[]`. If the LLM strays into
prose or wraps in code fences, we strip + repair before parsing. On
unrecoverable garbage we return a `fallbackSummary` that is still valid
output — never a crash.

## Why this lives in `plugins/` not `core/`

`core` shouldn't know about git or PR conventions. The plugin loader
discovers this folder, the manifest in `package.json` declares
`permissions: ["llm:chat"]`, and the host wires `context.llm` for you.
See `cookbook/02-writing-a-plugin.md` for the full lifecycle.

## Tests

`npm test` inside this directory runs eight unit tests covering the
parser, prompt shape, JSON-repair fallback, conventional-commit
detection, and the Markdown renderer.
