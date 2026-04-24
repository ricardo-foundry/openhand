# @openhand/plugin-file-organizer

Scan a directory → classify each file (LLM or heuristic) → produce a
dry-run rename plan that moves each file into a category subfolder.

## Why dry-run first

Renaming files is the kind of thing you want to see before you commit to.
So the tools are split:

| Tool               | Side effects                                 |
|--------------------|----------------------------------------------|
| `organize_scan`    | None — just reads the directory.             |
| `organize_propose` | None — produces a plan object.               |
| `organize_apply`   | Actually renames files. Host must approve.   |

`organize_apply` refuses to move anything outside the scan root, refuses to
overwrite existing files, and collects per-entry errors instead of
aborting the whole batch.

## Classification

If a provider is available (`context.llm`), the plugin sends the whole
filename list in one batch and asks for a `{ labels: [{i, category}] }`
JSON response. If there's no provider, or the LLM returns garbage, it
falls back to a built-in extension map (`docs`, `images`, `video`,
`audio`, `archives`, `code`, `data`, `misc`).

## Permissions

- `fs:read` — inventory
- `fs:write` — only used by `organize_apply`
- `llm:chat` — only used by `organize_propose` when `useLlm=true`

## Tests

```bash
cd plugins/file-organizer && npm test
```

Eight tests covering scan, heuristic classification, LLM-batch parsing,
rename collision handling, plan safety (refuses escapes), and
`organize_apply` against an injected fake filesystem.
