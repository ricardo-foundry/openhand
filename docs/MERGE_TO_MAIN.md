# Merge to `main` — Bundle Plan

> Prepared on `iter-23-merge-bundle`. This branch adds **only** this document on
> top of `iter-21-verify`. No code, asset, or other doc changes.

`main` currently sits at `36af7f3` ("URL foundry" rename, completed during
iter-11). Iterations 12 through 21 have shipped on their own `iter-N-*`
branches and been pushed to `origin`, but **none of them has been merged back
into `main`**. As of 2026-04-25 the gap is **13 commits / 10 iterations** of
production work.

Use this document as the single source-of-truth when deciding _how_ to land
those commits on `main`.

---

## 1. What `main` is missing (iter-12 → iter-21)

Listed newest first. Each entry names the iter branch, the headline commit,
and the user-visible payload it added to the toolkit.

| Iter | Branch | Key commit | Headline payload |
| --- | --- | --- | --- |
| 21 | `iter-21-verify` | `c916acb` | Verification-only — typecheck, 2× full test runs, audit, smoke, link check. |
| 20 | `iter-20-fortune-and-polish` | `1ce0067` | `fortune-cookie` plugin + `cookbook/09 quick-plugin` + polish. |
| 19 | `iter-19-mcp-adapter` | `7d52e9c` | MCP adapter — spawn-and-talk JSON-RPC over stdio (no SDK dependency). |
| 18 | `iter-18-launch-ready` | `96164ba` | Launch-ready — release checklist, Show HN draft, cross-promo. |
| 17 | `iter-17-final-consolidation` | `36bbccd` | Final consolidation — JOURNEY, badges, support range, CHANGELOG links. |
| 16 | `iter-16-chaos-bash` | `246719d` | Chaos tests + bug bash — 36 chaos tests, smoke at 383 ✓. |
| —  | `iter-15-real-providers-and-sandbox-v2` | `9ae8543` | `landing/build-meta.json` regenerated for v0.8. |
| 15 | `iter-15-real-providers-and-sandbox-v2` | `9f5015f` | v0.8: real providers + sandbox v2 + audit + metrics + demo walkthrough. |
| —  | `iter-14-observability-and-marketplace` | `18de258` | `landing/build-meta.json` regenerated for v0.7. |
| 14 | `iter-14-observability-and-marketplace` | `5e6fd53` | v0.7: observability spans + plugin marketplace + code-translator + doctor. |
| —  | `iter-13-finishing-touches` | `f28bad5` | `landing/build-meta.json` regenerated for v0.6. |
| 13 | `iter-13-finishing-touches` | `62ee54e` | v0.6: runnable cookbook examples, label bootstrap, first-PR walkthrough. |
| 12 | `iter-12-cookbook-ollama` | `38ca757` | Cookbook 06/07, web-scraper plugin, runtime `onChunk` + `dispose`, scaffolder, in-browser demo. |

Cumulatively: the toolkit goes from v0.5 (the URL-foundry rename baseline) to
v0.8 with real LLM providers, the sandbox v2, observability, the plugin
marketplace, the MCP adapter, the fortune-cookie example, and a full launch
docs set.

`package.json` `version` field on `iter-21-verify`: **`0.7.0`**
(v0.8 work is committed but not yet bumped — see §4).

---

## 2. Recommended path: `squash-merge` per iter

Squashing keeps `main` readable as **one commit per iteration** while still
preserving the full history on the `iter-*` branches (and on `origin`).

```bash
# Land all iterations onto main in chronological order.
# Run from the repo root, on a clean working tree.

git checkout main
git pull --ff-only origin main

for branch in \
    iter-12-cookbook-ollama \
    iter-13-finishing-touches \
    iter-14-observability-and-marketplace \
    iter-15-real-providers-and-sandbox-v2 \
    iter-16-chaos-bash \
    iter-17-final-consolidation \
    iter-18-launch-ready \
    iter-19-mcp-adapter \
    iter-20-fortune-and-polish \
    iter-21-verify
do
  git merge --squash "$branch"
  git commit -m "$branch: squashed merge"
done

git push origin main
```

If you'd rather collapse the entire 13-commit gap into a **single** merge
commit on `main`, do this instead:

```bash
git checkout main
git pull --ff-only origin main
git merge --squash iter-21-verify
git commit -m "release v0.8: iter-12 → iter-21 squashed onto main"
git push origin main
```

Trade-off: zero per-iteration granularity on `main`, but a clean one-commit
delta. The `iter-*` branches still keep the granular history for archaeology.

---

## 3. Alternative: fast-forward `main` to `iter-21-verify`

Because `iter-21-verify` is a **direct linear descendant** of `main`
(`36af7f3` is its first ancestor), a fast-forward is possible and preserves
every single commit on `main`.

```bash
git checkout main
git pull --ff-only origin main
git merge --ff-only iter-21-verify
git push origin main
```

Use this if you want `main` to mirror the iter timeline 1:1 — you'll see all
13 commits show up on `main` exactly as they exist on the iter branches
(including the three `landing/build-meta.json` regen commits).

`git log --oneline main` after the FF will start with `c916acb` and run all
the way down to the original modular import.

---

## 4. Side-effects to plan for

### 4.1 GitHub Pages will redeploy (only if landing/packages/api-README change)

`.github/workflows/deploy-pages.yml` triggers on `push: branches: [main]` but
is **path-filtered** to:

- `landing/**`
- `packages/**`
- `docs/api-README.md`
- `.github/workflows/deploy-pages.yml`

The pending merge touches all four (landing got the v0.6/v0.7/v0.8
build-meta regens; `packages/**` is where the real-provider, observability,
marketplace, MCP adapter, and fortune-cookie code lives). Expect a Pages
rebuild to fire **once** on the merge push.

After the deploy:

- The landing site reflects the v0.8 build-meta (commit hash, plugin count,
  cookbook count).
- The TypeDoc / `api-README.md` reference picks up every new public symbol
  added since iter-11.

### 4.2 CI test count will jump significantly

`main` today predates the iter-16 chaos suite. Post-merge expect:

- The chaos suite (**36 chaos tests**) added in iter-16.
- The smoke suite at **383 ✓** (per the iter-16 commit message).
- Whatever provider-wire / cookbook / MCP-adapter tests landed in iter-12
  through iter-21.

Don't be alarmed by the spike — the iter-21 verification pass already ran the
full suite green twice.

### 4.3 `npm` publish workflow is **not** push-triggered

There is a `release.yml` workflow but it's tag-gated, not push-gated. Merging
will **not** auto-publish to npm. A version bump and tag are still manual
follow-ups.

### 4.4 `package.json` version is not bumped to 0.8 yet

`iter-21-verify` still reports `"version": "0.7.0"` across the workspace even
though v0.8 features (real providers, sandbox v2) have landed. Decide before
the merge:

- **Option A — bump first**: cut a small `chore: 0.7.0 → 0.8.0` follow-up
  branch (touching every `package.json` in the workspace, mirroring the
  v0.5 unify pattern from `1eb622f`), merge that first, then merge the iter
  bundle.
- **Option B — bump after**: merge as-is, then push a `chore: bump to 0.8.0`
  commit on top. Simpler. The landing build-meta will continue to display
  whatever version `iter-15` regenerated until the bump.

### 4.5 Branch hygiene

The 10 `iter-*` branches (12–21) will still exist locally and on `origin`
after the merge. They're not strictly needed once `main` catches up, but
**don't delete them yet** — they're the fallback if a regression appears
post-merge. A safe cleanup window is ~2 weeks of `main` running green.

### 4.6 Open PRs / forks

If a contributor is tracking `main` they will need to rebase / reset their
fork after the merge. The FF path adds 13 new commits; the squash path
rewrites very little but adds 1–10 new commits depending on how many squash
points you take.

---

## 5. Pre-merge checklist

- [ ] CI on `iter-21-verify` is green (verified during iter-21).
- [ ] `pnpm -r typecheck` and `pnpm -r test` pass locally on `iter-21-verify`.
- [ ] `pnpm audit` clean (verified during iter-21).
- [ ] Decide on §2 vs §3 path; document the choice in the merge commit message.
- [ ] Decide on §4.4 version-bump timing.
- [ ] Pages workflow has not been disabled in repo settings.
- [ ] Confirm the npm release flow is intentionally **not** triggered by this
      merge (it's tag-gated; see §4.3).

Once those check out, the merge itself is a 30-second operation. The work
is in choosing the strategy, not in running it.
