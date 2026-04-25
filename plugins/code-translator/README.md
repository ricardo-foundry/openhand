# @openhand/plugin-code-translator

Translate a code snippet from one language to another via the host LLM, with
a built-in secret-leak heuristic that refuses to send code containing
recognisable API keys / tokens / private keys.

## Tools

- `code_translate(source, target_lang, source_lang?, model?)`
  - Resolves `target_lang` against an 8-language whitelist (python,
    javascript, typescript, go, rust, java, ruby, csharp; common aliases
    like `py`, `js`, `golang`, `c#` accepted).
  - Scans the source for secrets first. **Aborts before any LLM call** if
    found, with `err.code === 'SECRET_DETECTED'` and a `findings` array.
  - On success returns `{ target_lang, source_lang, model, translated,
    bytes_in, bytes_out }` with a single layer of ``` fences stripped.
- `code_scan_secrets(source)` — pure heuristic, no LLM. Returns
  `{ findings, clean }`.

## Limits

- 64 KiB max source size.
- Heuristic only — false positives are by design (better to refuse than leak).
  Don't rely on this as your only secret scanner; use a real one in CI.

## Required permissions

`llm:complete` (declared in the manifest).

## Tests

10 unit tests in `tests/code-translator.test.js`. Run with `npm test`.
