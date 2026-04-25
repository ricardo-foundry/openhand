# Contributing to OpenHand — 5-minute quickstart

Welcome. This page is the **fast** path: clone, run, ship a PR, all in
five minutes. The longer policy doc is [`CONTRIBUTING.md`](../CONTRIBUTING.md).

---

## 1. Clone + bootstrap (1 min)

```bash
git clone https://github.com/ricardo-foundry/openhand.git
cd openhand
npm install
```

The repo is an `npm workspaces` monorepo — `npm install` at the root
hydrates every package and app. No `lerna`, no `pnpm`, nothing exotic.

---

## 2. Verify your tree (1 min)

```bash
npm run typecheck     # tsc --noEmit across every workspace
npm test              # unit + plugins + integration + e2e + bench
```

Green here means your sandbox is identical to CI's. If only one
sub-suite fails, you can iterate faster with:

| Goal | Command |
| --- | --- |
| Just unit tests | `npm run test:unit` |
| Just plugin tests | `npm run test:plugins` |
| Just provider wire tests | `npm run test:integration` |
| Just e2e (REPL/SSE/CLI spawn) | `npm run test:e2e` |
| Full runtime smoke | `bash scripts/runtime-integration.sh` |

---

## 3. Find something to do (30 sec)

We curate easy entry points in
[`docs/GOOD_FIRST_ISSUES.md`](./GOOD_FIRST_ISSUES.md). Three types of work
are extra-welcome from new contributors:

- **New plugin** under `plugins/` — copy `plugins/calculator/` for the
  shape, see [`docs/PLUGIN_DEVELOPMENT.md`](./PLUGIN_DEVELOPMENT.md).
- **New cookbook recipe** under `cookbook/` — short, code-first.
- **Provider hardening** in `packages/llm/` — more wire-format edge
  cases in `tests/integration/provider-wire/`.

If you can't find one that fits, open an issue with the
`question` label and we'll point you at a useful spot.

---

## 4. Make your change (2 min)

```bash
git checkout -b feat/your-thing
# … edit files …
npm run typecheck
npm test
git add -A && git commit -m "feat: your thing"
git push -u origin feat/your-thing
```

Conventions:

- **TypeScript strict.** `strict + noUncheckedIndexedAccess +
  exactOptionalPropertyTypes + noImplicitOverride` is on across every
  workspace. We will not relax these — comment + cast at the seam if you
  must.
- **No vendor SDKs in `packages/llm`.** That package is `fetch` + types
  only by design (see `cookbook/03-custom-llm-provider.md`).
- **Tools that touch the FS / shell / network must respect the
  sandbox.** See `docs/SECURITY_MODEL.md` for the policy contract.

Plugin contributors specifically: the manifest goes in `package.json`
under the `openhand` key. Run `node --test plugins/<your>/tests/*.test.js`
to verify before pushing — it's how `npm run test:plugins` exercises
your code in CI.

---

## 5. Open the PR (30 sec)

```bash
gh pr create
```

The repo's PR template asks for:

- **What** changed (one line).
- **Why** (one line).
- **Tests** added / updated.
- **Risks** (sandbox, network, secrets).

That's it. CI will:

1. typecheck every workspace,
2. run all 200+ tests + benchmarks,
3. run the runtime smoke (`scripts/runtime-integration.sh`),
4. auto-label the PR by file paths (see `.github/labeler.yml`).

A CODEOWNER (currently `@Ricardo-M-L`) is auto-requested by GitHub for
every PR. Expect a first review within a working day.

---

## Your first PR — a guided walkthrough

If you've never opened a PR against this repo, here's the *exact* path that
maintainers expect. Total wall time: about 15 minutes for a one-line fix,
maybe 40 for a small plugin.

### 1. Pick a `good first issue`

Browse [open
issues](https://github.com/ricardo-foundry/openhand/issues?q=is%3Aissue+is%3Aopen+label%3A%22good+first+issue%22),
or skim [`docs/GOOD_FIRST_ISSUES.md`](./GOOD_FIRST_ISSUES.md). Comment on
the issue saying "I'll take this" so two people don't duplicate work. If
maintainers don't reply within a day, just go ahead — we're a small team
and we'd rather merge a PR than gate-keep an issue.

### 2. Fork + clone + branch

```bash
gh repo fork ricardo-foundry/openhand --clone --remote
cd openhand
git checkout -b fix/<short-slug>     # or feat/, docs/, chore/
```

The branch name is purely convention — the labeler workflow keys off file
paths, not branch names. We *don't* squash-merge by topic prefix.

### 3. Code + verify locally

```bash
npm install
# … edit files …
npm run typecheck
npm test
```

`npm test` runs the full 273-test grid in ~60s on a laptop. If you only
changed a plugin, `npm run test:plugins` is enough for the inner loop;
CI will run everything anyway.

### 4. Commit with intent

We follow [Conventional
Commits](https://www.conventionalcommits.org/) loosely — the *type*
matters (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`), the scope
is optional, the body is encouraged for any non-trivial change. One PR
usually maps to one commit; don't be afraid to `git rebase -i` before
pushing.

```bash
git add -p                 # review hunk-by-hunk; avoid `add -A`
git commit -m "fix(plugins/calculator): handle Infinity/-Infinity"
```

### 5. Push + open the PR

```bash
git push -u origin fix/<short-slug>
gh pr create --fill        # uses the PR template + last commit msg
```

Auto-labels land via `.github/labeler.yml`; a CODEOWNER review is
auto-requested. Expect a first response within one working day.

### 6. Iterate on review

Push fixup commits to the same branch — the PR auto-updates. We squash
on merge for plugins / docs / chores, and rebase on merge for
`packages/*` so blame stays accurate. Reviewers pick the strategy; you
don't need to rebase before merge unless asked.

### 7. After merge

Your name lands in the next CHANGELOG entry. If your PR touched
`cookbook/` or `examples/`, the GitHub Pages site rebuilds automatically
and links your new content from the landing page within ~2 minutes.

---

## Where the maps live

- [`README.md`](../README.md) — the elevator pitch.
- [`CONTRIBUTING.md`](../CONTRIBUTING.md) — the long-form policy doc.
- [`docs/ARCHITECTURE.md`](./ARCHITECTURE.md) — module boundaries.
- [`docs/SECURITY_MODEL.md`](./SECURITY_MODEL.md) — sandbox + permission rules.
- [`docs/PLUGIN_DEVELOPMENT.md`](./PLUGIN_DEVELOPMENT.md) — plugin
  manifest + lifecycle.
- [`docs/ERROR_HANDLING.md`](./ERROR_HANDLING.md) — four-category error
  taxonomy.

If something here is wrong or out of date, that itself is a great
first PR.
