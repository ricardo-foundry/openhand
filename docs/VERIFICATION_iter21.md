# Iter-21 Verification Report

> Verification-only iteration — no source/code changes.
> Branch: `iter-21-verify`  ·  Base: `iter-20-fortune-and-polish` (`1ce0067`)
> Date: 2026-04-25
> Host: macOS Darwin 25.3.0, Node `node --version` ≥ v20

This iteration locks down everything iter-20 shipped. No production
files were touched; the only artifact this branch produces is this
report.

---

## 1. `npm run typecheck` — PASS

```
> openhand@0.7.0 typecheck
> npm run typecheck --workspaces --if-present
```

All 7 typed workspaces (`core`, `llm`, `mcp`, `sandbox`, `tools`, `cli`,
`server`, `web`) compile with zero diagnostics. `web` is `tsc --noEmit`,
the rest run their own `typecheck` script. Strict mode +
`noUncheckedIndexedAccess` are still on.

---

## 2. `npm test` — two independent runs, both PASS, both stable

`npm test` chains: workspaces (unit) → plugins → examples → integration
→ e2e → chaos → bench.

| suite        | run 1   | run 2   |
|--------------|---------|---------|
| core         | 44 / 44 | 44 / 44 |
| llm          | 42 / 42 | 42 / 42 |
| mcp          | 17 / 17 | 17 / 17 |
| sandbox      | 42 / 42 | 42 / 42 |
| tools        | 22 / 22 | 22 / 22 |
| cli          | 52 / 52 | 52 / 52 |
| server       |  7 /  7 |  7 /  7 |
| plugins      | 82 / 82 | 82 / 82 |
| examples     |  5 /  5 |  5 /  5 |
| integration  | 35 / 35 | 35 / 35 |
| e2e          | 18 / 18 | 18 / 18 |
| chaos        | 36 / 36 | 36 / 36 |
| bench        | 10 / 10 | 10 / 10 |
| **total**    | **412** | **412** |

Zero failures, zero cancelled, zero skipped on both runs. Wall-clock for
each chained run was ~35 s (chaos + integration dominate).

---

## 3. `npm run bench` — PASS, no regression

10 / 10 bench cases pass. Sampled throughput on this host:

| op                                  | ops/s     | ns/op |
|-------------------------------------|-----------|-------|
| `LLMClient.complete()` idle         | 105,106   | 9,514 |
| `complete()` + retry policy         | 138,609   | 7,215 |
| `LLMClient.stream()` idle           | 151,484   | 6,601 |
| `complete()` + rate limit           | 117,892   | 8,482 |
| `PluginLoader.loadAll(100)`         | —         | 0.022 ms / plugin |
| `TaskStreamBus.publish()` (no sub)  | 462,268   | 2,163 |
| `TaskStreamBus.publish()` (10 sub)  | 3,594,859 | 278   |
| `formatSseFrame()`                  | 4,114,478 | 243   |

All numbers within historical bands (no >2× regression vs iter-20). The
benchmarks are also test-asserted (each has an upper-bound ms/op or
linearity check) and they all green.

---

## 4. `npm audit` — PASS

```
found 0 vulnerabilities
```

Zero across all severities. Matches `landing/build-meta.json:audit.vulnerabilities=0`.

---

## 5. `scripts/runtime-integration.sh` — PASS

End-to-end smoke driving the *built* artifacts (CLI binary, server
process, examples) — not just `node --test`.

```
=== runtime-integration: PASS — 412 tests + 7 examples + CLI + server ===
```

Sub-stages all green:

- `unit` / `examples-tests` / `integration` / `e2e` / `chaos` / `bench`
- 7 example scripts each exit 0 with non-empty stdout and clean stderr
  (`hello-world`, `agent-shell-loop`, `shell-automation`, `ollama-local`,
  `rss-digest-agent`, `router-worker`, `streaming-tool-use`)
- CLI subcommands: `--help`, `--version`, `status`, `plugins list`,
  `chat` REPL — all spawn cleanly
- Server: boots, `/api/health` returns 200, SSE `_demo` flow drains 4
  frames before EOF

---

## 6. `scripts/demo-walkthrough.sh` — PASS

`docs/DEMO.md` regenerates cleanly. Diff vs committed copy is
timestamp + `$TMPDIR` only — no command failures, no stderr noise. The
generated file was reverted (this iteration is verification-only) so
the working tree stays clean.

---

## 7. Per-plugin self-tests — all PASS

Each plugin's `tests/` runs in isolation against its own source — no
cross-plugin coupling.

| plugin           | tests |
|------------------|------:|
| calculator       | 10    |
| code-reviewer    |  7    |
| code-translator  |  9    |
| file-organizer   |  9    |
| fortune-cookie   |  6    |
| git-summary      | 10    |
| mcp-bridge       |  6    |
| rss-digest       |  8    |
| web-scraper      | 17    |
| **subtotal**     | **82**|

`weather` ships index + README only (no test dir, by design — it's the
"minimum viable plugin" example).

---

## 8. `landing/build-meta.json` — numbers verified

The committed `build-meta.json` was generated against iter-19 (`7d52e9c`),
but the *numbers* it carries are still accurate for HEAD. Re-running
`node scripts/build-meta.js` on this branch produced identical counts:

| field                  | committed | regenerated |
|------------------------|----------:|------------:|
| `tests.unit`           | 231       | 231         |
| `tests.e2e`            | 18        | 18          |
| `tests.integration`    | 35        | 35          |
| `tests.plugins`        | 82        | 82          |
| `tests.bench`          | 10        | 10          |
| `tests.total`          | 376       | 376         |
| `audit.vulnerabilities`| 0         | 0           |
| `plugins`              | 10        | 10          |

`tests.unit = 231` decomposes as 226 workspace unit + 5
`examples/*.test.ts` — that's how `scripts/build-meta.js` defines `unit`
(packages + apps + examples). The 36 chaos tests are intentionally not
counted in `build-meta` (they're stress tests, not assertion tests in
the user-facing sense). Total `412` from runtime-integration =
`376 + 36 chaos`.

The regenerated file was reverted; `lastCommit` will refresh
automatically the next time `deploy-pages.yml` runs on `main`.

---

## 9. README + cookbook link reachability — PASS

All 34 internal markdown links from `README.md`, `cookbook/README.md`
and `cookbook/0[1-9]-*.md` resolve to real files on disk. Spot-checked
external badge URLs (img.shields.io, starchart.cc, CI workflow badge)
and they're well-formed. No 404s introduced since iter-20.

---

## 10. Conclusion

iter-20's surface — fortune-cookie plugin, cookbook 09, MCP adapter,
runtime smoke harness — is **stable, deterministic, and zero-vuln** on
two consecutive full runs. No regressions vs iter-19. Safe to tag.

**Decision: PROMOTE.**
