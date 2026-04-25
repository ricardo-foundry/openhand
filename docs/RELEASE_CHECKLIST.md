# OpenHand v0.8 — Release Checklist

A 30-item gate that has to be all green before we cut a tag, push the
release notes, flip the landing page, and post the launch threads. Every
line is something a fresh checkout can verify in one command. No box gets
ticked from memory; if you can't reproduce it locally you don't tick it.

The lanes — typecheck, unit, e2e, chaos, bench, audit, examples,
cookbook, Pages, announce — are listed in roughly the order the build
exercises them, so failing top-down is the fastest way to fail-fast.

Ground rules
- Run from a clean clone (`git clean -fdx && npm install`) before tick #1.
- Never tick a box on stale cache. If `node_modules` predates the branch,
  rerun `npm install` and start over.
- All commands assume repo root.

---

## Typecheck (1 → 3)

- [ ] **1. `tsc --noEmit` clean across every workspace.**
  ```bash
  npm run typecheck
  ```
  Expect zero diagnostics. `strict + noUncheckedIndexedAccess +
  exactOptionalPropertyTypes + noImplicitOverride` are all on; if any
  workspace regresses, the suppressions live in that workspace's
  `tsconfig.json`, not in a root override.

- [ ] **2. `npm run lint` clean.**
  ```bash
  npm run lint
  ```
  ESLint config is shared from the root. Treat warnings as errors for
  release.

- [ ] **3. `npm run build` produces every workspace's `dist/`.**
  ```bash
  npm run build
  ```
  Vite for `apps/web`, `tsc` for everything else. Inspect
  `apps/server/dist/index.js` exists; it's the canary.

## Unit + plugin tests (4 → 8)

- [ ] **4. Unit tests — packages + apps + examples.** Target ≥ 214.
  ```bash
  npm run test:unit
  ```

- [ ] **5. Plugin tests — eight in-tree plugins.** Target ≥ 70.
  ```bash
  npm run test:plugins
  ```
  Every plugin has a `tests/` folder; if a new plugin landed without
  tests this fails noisily.

- [ ] **6. Example tests — runnable cookbook code.** Target ≥ 5.
  ```bash
  npm run test:examples
  ```
  Asserts the example actually exits 0, not just that it parses.

- [ ] **7. Integration tests — provider wire + agent flow.** Target ≥ 35.
  ```bash
  npm run test:integration
  ```
  Includes OpenAI / Anthropic / Ollama wire-format tests against
  recorded fixtures, plus a server + CLI + SSE round-trip.

- [ ] **8. End-to-end tests — REPL, SSE, hot-reload, examples.** Target ≥ 18.
  ```bash
  npm run test:e2e
  ```

## Chaos (9 → 11)

- [ ] **9. Chaos tests — adversarial.** Target ≥ 36.
  ```bash
  npm run test:chaos
  ```
  Covers SIGKILL escalation, truncated SSE frames, plugin cycles, shell
  injection, `NET=none` flips, 10 MB payloads, random CLI input.

- [ ] **10. No leaked child processes after chaos.**
  ```bash
  pgrep -laf 'tsx|node' | grep -v 'Code Helper\|Cursor' | sort
  ```
  Run before and after `test:chaos`; the after-set must equal the
  before-set. A leaked `tsx` is a release blocker.

- [ ] **11. Chaos is reproducible at `RANDOM_SEED=42`.**
  ```bash
  RANDOM_SEED=42 npm run test:chaos
  ```
  Identical pass count two runs in a row. A flaky chaos test is a chaos
  *bug*, not "infra noise".

## Benchmarks (12 → 13)

- [ ] **12. Micro-benchmarks pass their hard thresholds.** Target ≥ 10.
  ```bash
  npm run bench
  ```
  Each `*.bench.ts` asserts a perf budget (`assert.ok(ns < threshold)`),
  so a regression fails CI rather than just "looks slower".

- [ ] **13. Bench output committed under `bench/results/<sha>.json`** (if
      the threshold knob moved). Used by the landing page sparkline.

## Audit + supply chain (14 → 16)

- [ ] **14. `npm audit` reports 0 vulnerabilities.**
  ```bash
  npm audit --audit-level=low
  ```
  Held continuously since v0.5. Any new finding has to be either fixed,
  or pinned with a written justification in `SECURITY.md`.

- [ ] **15. `npm ls` resolves cleanly with no peer-dep warnings.**
  ```bash
  npm ls --workspaces
  ```

- [ ] **16. Lockfile is committed and `npm ci` is reproducible.**
  ```bash
  rm -rf node_modules && npm ci && npm run typecheck
  ```

## Examples + CLI + server smoke (17 → 20)

- [ ] **17. `scripts/runtime-integration.sh` is green end to end.**
  ```bash
  bash scripts/runtime-integration.sh
  ```
  Chains build → unit → plugin → examples → integration → e2e → chaos →
  bench → examples-runtime → CLI → server. Single source of truth.

- [ ] **18. Every `examples/*.ts` exits 0 with empty stderr.** The smoke
      script asserts this; the box is for "I read the
      `LOG_DIR/example-*.err` and confirmed no warnings either".

- [ ] **19. CLI subcommand spawn — `--help`, `--version`, `status`,
      `plugins list`** — all exit 0 and write nothing to stderr.

- [ ] **20. Server boot — `/api/health` 200 OK, `_demo` SSE drains a
      `completed` frame within 4 s, SIGTERM exits clean (no hung pids).**

## Cookbook + docs (21 → 24)

- [ ] **21. Every `cookbook/*.md` recipe runs as written.** Copy-paste
      each block from a fresh terminal; fail the box if any step needs a
      tweak that isn't in the recipe.

- [ ] **22. Cookbook count = 7** (`01-hello-world` through
      `07-streaming-tool-use`). README badge and landing page numbers
      both agree.

- [ ] **23. JSDoc on every public export** — `npm run typedoc` emits
      `apps/web/public/api/` clean. Preview by opening `index.html`.

- [ ] **24. CHANGELOG.md** has a `## [0.8.0] - 2026-04-25` section that
      mirrors the release notes verbatim, ending with a link to the
      compare URL.

## Landing + Pages (25 → 27)

- [ ] **25. `node scripts/build-meta.js` regenerates
      `landing/build-meta.json`** with the post-tag commit SHA and the
      latest test counters. Diff should be just `generatedAt`,
      `lastCommit`, and any moved counters.

- [ ] **26. Landing renders the new numbers.** Open
      `landing/index.html` in a browser; verify `tests.total`, `audit`,
      `plugins`, `cookbook`, last-commit-sha all match the build-meta
      file. Ship a screenshot to the release issue.

- [ ] **27. GitHub Pages action is green** (`Deploy Pages` workflow) and
      `https://ricardo-foundry.github.io/openhand/` 200s with the new
      hash within 5 minutes of merge.

## Announce (28 → 30)

- [ ] **28. Release notes posted** — `gh release create v0.8.0
      --notes-file docs/RELEASE_v0.8.md`. Tag is signed.

- [ ] **29. Show HN draft (`docs/SHOW_HN_DRAFT.md`)** is current — title
      ≤ 80 chars, body opens with the inversion pitch, links land on the
      tagged commit. Submit window is Tue–Thu, 09:00–11:00 ET.

- [ ] **30. Cross-promo (`docs/CROSSPROMO.md`)** sister-project links
      added in `README.md` footer (terminal-quest-cli + canvas
      vampire-survivors), and reciprocal links land in those repos in
      the same window. No box gets ticked unless all three READMEs
      reference each other.

---

## What "all green" looks like

```
typecheck  [ok] 0 diagnostics
unit       [ok] 214 tests
plugins    [ok] 70 tests
examples   [ok] 5 tests
integ      [ok] 35 tests
e2e        [ok] 18 tests
chaos      [ok] 36 tests
bench      [ok] 10 tests
audit      [ok] 0 vulnerabilities
smoke      [ok] runtime-integration.sh exit 0
landing    [ok] build-meta.json regenerated
pages      [ok] 200 OK
announce   [ok] release + Show HN + cross-promo posted
total      383+ tests, 0 vulns, 8 plugins, 7 cookbook recipes
```

If any box is unchecked, the release is not cut. No "we'll fix it in a
patch" — that's how you ship a regression past a green CI.
