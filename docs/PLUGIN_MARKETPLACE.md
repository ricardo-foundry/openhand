# Plugin Marketplace

This is the contributor guide for proposing a plugin to the **official OpenHand
plugin index** (the eight plugins shipped in-tree under `plugins/*` are the
seed of that index).

It complements the implementation guide at
[`PLUGIN_DEVELOPMENT.md`](./PLUGIN_DEVELOPMENT.md), which explains *how* to
build a plugin. This doc explains *how to ship one to the community*.

> **Status:** v0.7 ships the in-tree marketplace (seven canonical plugins
> under `plugins/`). A separate `openhand-plugins` repo is on the v0.8
> roadmap — until then, "submit" means open a PR against this monorepo.

---

## At a glance — the eight reference plugins

| Plugin | Tools | Permissions | Notes |
| --- | --- | --- | --- |
| `calculator` | `calc_eval` | _none_ | Pure, sandbox-not-required, hand-rolled parser (no `eval`). |
| `weather` | `weather_now` | `network:http` | Uses `@openhand/tools` HTTP client; SSRF-guarded. |
| `git-summary` | `git_status_summary` | `shell:exec` | Talks to local git via the sandbox shell. |
| `file-organizer` | `organize_by_extension` | `file:read`, `file:write` | Path-checked through the sandbox. |
| `rss-digest` | `rss_fetch`, `rss_summary` | `network:http`, `llm:complete` | LLM summary on top of cheerio extract. |
| `code-reviewer` | `code_review`, `code_review_stats` | `llm:complete` | Provider-agnostic LLM consumer. |
| `web-scraper` | `scrape_summary`, `scrape_extract` | `network:http`, `llm:complete` | Defence-in-depth SSRF check at the plugin boundary. |
| `code-translator` *(new in v0.7)* | `code_translate`, `code_scan_secrets` | `llm:complete` | Refuses code containing API-key-like strings. |

These are also the *test bar*: anything you ship must clear the same checks
they do — manifest, README, ≥8 tests, declared permissions, no `eval`.

---

## Submission flow

```
┌──────────┐   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
│  Build   │ → │   PR    │ → │ Triage   │ → │  Audit   │ → │  Merge   │
│ locally  │   │ (label  │   │ (1 wk)   │   │ (≤2 wk)  │   │ + index  │
└──────────┘   │ plugin) │   └──────────┘   └──────────┘   └──────────┘
               └─────────┘
```

### 1. Build

Use the scaffolder so you start with the right shape:

```bash
npm run plugin:new -- my-plugin
```

That gives you `plugins/my-plugin/` with `index.js`, `package.json`,
`README.md`, and a stub test file. The manifest under
`package.json#openhand` is what the loader reads — id, version, entry,
permissions.

### 2. Self-check

Before opening a PR, run **all** of these from the repo root:

```bash
npm test                    # 281+ across the whole repo
npm run typecheck           # strict TS
npm audit --audit-level=high # we hold at 0 vulnerabilities
```

Local dry-run with the doctor:

```bash
node ./apps/cli/dist/index.js doctor
```

### 3. Open the PR

Title format: `feat(plugin): add <id>` (e.g. `feat(plugin): add code-translator`).
Apply the `plugin` label (the `setup-labels.sh` script ensures it exists).
The PR description should answer:

- **What does the plugin do?** One sentence.
- **What permissions does it require, and why?** Match every `permissions:`
  entry to a real reason.
- **What's the failure mode?** What happens if the LLM is down, the network
  flakes, the input is hostile?
- **What's the test coverage?** Number of tests, what they exercise.

### 4. Triage (≤ 1 week)

A maintainer labels the PR within a week. Possible outcomes:

- `accepted-pending-audit` — passes a smell test, queued for security audit.
- `needs-changes` — concrete asks before audit (e.g. "permission missing",
  "no SSRF guard").
- `out-of-scope` — fine plugin, but outside the marketplace remit (e.g. it
  duplicates an existing plugin, or it requires a runtime dep we won't add).

### 5. Security audit (≤ 2 weeks)

See [Audit checklist](#security-audit-checklist) below for what we review.
Most audits land within a week; complex network-touching plugins may take
longer. The audit comment is filed publicly on the PR for transparency.

### 6. Merge

On merge, the plugin lands in `plugins/<id>/` and is auto-discovered by the
loader. CI runs `test:plugins` against it. The next release notes mention
the new plugin in **Added**.

---

## Naming conventions

| Field | Rule | Example |
| --- | --- | --- |
| Folder | `plugins/<kebab-case>/` | `plugins/code-translator/` |
| Manifest `id` | Same as folder, kebab-case, ≤ 30 chars | `"id": "code-translator"` |
| `package.json#name` | `@openhand/plugin-<id>` | `"@openhand/plugin-code-translator"` |
| Tool names | `snake_case`, prefixed by domain | `code_translate`, `rss_fetch`, `weather_now` |
| Version | SemVer; start at `1.0.0` | `"version": "1.0.0"` |

Reserved prefixes: `core_`, `agent_`, `system_`. Don't use them — they're
for the host runtime.

---

## What MUST be in the package

- `package.json` with the `openhand` block:
  ```json
  {
    "openhand": {
      "id": "<id>",
      "version": "1.0.0",
      "entry": "./index.js",
      "description": "<one sentence>",
      "permissions": ["<scope>", ...]
    }
  }
  ```
- `index.js` (CommonJS) exporting `{ name, version, description, tools, onEnable? }`.
- `README.md` — what it does, tools exposed, permissions required, limits.
- `tests/<id>.test.js` — at least **8** test cases covering happy path,
  validation, error handling, and any security-relevant behaviour.

## What MUST NOT be in the package

- `eval()`, `new Function(string)`, `vm.runInNewContext` on user-supplied
  strings, or any other dynamic code execution. Calculator's hand-rolled
  parser is the model.
- New runtime dependencies. The whole monorepo holds at **0 npm audit
  findings** by adding zero deps in v0.5/0.6/0.7. If you genuinely need a
  dep (say, a binary parser), open an issue first — we'll discuss vendoring
  vs. accepting it.
- Hard-coded secrets, API keys, or credentials of any kind. The
  `code-translator` plugin's `scanForSecrets` is itself a useful CI hook
  for this.
- File reads/writes outside the sandbox-allowed paths. Always go through
  `@openhand/sandbox` or `@openhand/tools`.
- `console.log` in the hot path. Use `getTracer()` spans for diagnostics.

---

## Security audit checklist

Every plugin clears these gates before merge.

### Network plugins (`network:http`)

- [ ] Calls go through `@openhand/tools` (its HTTP client SSRF-checks RFC1918,
      loopback, link-local, IPv6 ULA/link-local, and `file://`/`data://`
      schemes).
- [ ] Body size cap declared (we use 2 MiB by default).
- [ ] Timeout via `AbortController` (we use 15 s by default).
- [ ] Caller-supplied headers stripped of `Cookie`, `Authorization`, `Host`.
- [ ] If you re-implement SSRF (e.g. `web-scraper` does as defence-in-depth),
      tests exercise the loopback / RFC1918 / IPv6 cases.

### Filesystem plugins (`file:read` / `file:write`)

- [ ] All paths normalised before use (`path.resolve` + `path.normalize`).
- [ ] Nothing escapes sandbox allow-listed paths (`policy.allowedPaths`).
- [ ] Symlink-following is opt-in, never the default.
- [ ] Atomic writes for `file:write` (write-to-temp + rename).

### Shell plugins (`shell:exec`)

- [ ] All commands go through `SecureSandbox.execute()`.
- [ ] No string-concatenated commands. Use the sandbox's argv-array form.
- [ ] Timeouts set explicitly.
- [ ] Output truncated before returning to the agent (4 KiB is a good cap).

### LLM plugins (`llm:complete`)

- [ ] Uses `context.llm.complete({ model, messages })` — never imports a
      provider SDK directly.
- [ ] Token-budget aware: caps prompt size before sending.
- [ ] Structured output is JSON-parsed defensively (try/catch, schema check).
- [ ] No prompt injection of user-supplied data into the system role.

### Tests we run on every plugin

- `npm run test:plugins` (the matrix that tests all `plugins/*/tests/`).
- A manual review for `eval` / `Function` / network calls outside the
  approved tools layer.
- A `grep` for hard-coded URLs / IPs / API keys / paths.

---

## Worked example: `code-translator`

The new v0.7 plugin is a useful template:

- **Manifest** declares `permissions: ["llm:complete"]` — minimum scope, no
  network, no fs, no shell.
- **9 tests** cover: manifest shape, alias resolution, fence stripping,
  secret heuristic on common providers, secret heuristic on assignment
  forms, happy-path translation, secret-refusal (LLM never called),
  input validation, scan tool both clean and dirty.
- **No new deps** — it's pure JS.
- **Defence at the plugin boundary** — `scanForSecrets` runs *before* the
  LLM call. If it fires, the source never leaves the host.

Read it end-to-end: it's ~210 lines and that's all you need to ship a
production-grade plugin.

---

## When in doubt

Open an issue with the `plugin-proposal` label and a one-paragraph sketch
*before* writing code. Maintainers will tell you whether the idea fits the
marketplace, what permissions are appropriate, and whether anyone else is
already working on it. Saves both sides time.
