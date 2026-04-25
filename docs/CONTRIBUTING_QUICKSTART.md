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
