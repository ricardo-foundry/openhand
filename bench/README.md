# OpenHand Micro-benchmarks

Small, deliberately-scoped benchmarks that double as regression tests. Each
file is a `node:test` file, so failures show up in the normal test output and
we don't pull in `tinybench` / `mitata` / any other dependency.

## Running

```bash
# Run every bench:
node --import tsx --test bench/*.bench.ts

# Run one:
node --import tsx --test bench/llm-client.bench.ts
```

Each test prints one `console.log` line with the measured ops/sec and
nanoseconds per op. Example:

```
    complete() idle: 213,417 ops/s (4685 ns/op)
    publish() no subs: 1,512,342 ops/s (661 ns/op)
    loadAll(100): 2.14ms (0.021ms/plugin)
```

## What's measured

| File | What | Expected order of magnitude |
| --- | --- | --- |
| `llm-client.bench.ts` | `LLMClient.complete` overhead above a no-op provider, with + without retry policy and rate limiter | 100k+ ops/s |
| `plugin-loader.bench.ts` | `PluginLoader.loadAll` scan of 100 plugins; sanity check against quadratic regressions | ms, not seconds |
| `task-stream.bench.ts` | `TaskStreamBus.publish` with 0 and 10 subscribers; `formatSseFrame` throughput | 100k–1M+ ops/s |

## Design notes

- **No external dep.** Benches only use `node:test`, `node:assert`,
  `performance.now()`, and the workspace packages themselves.
- **Each bench is also a test.** We wrap measurements in `assert.ok(ops >= …)`
  with *very* generous lower bounds — they catch crashes and order-of-magnitude
  regressions, not 10% drift. For fine-grained tracking, graph the numbers
  from CI logs yourself.
- **Warm-up loop.** Every hot loop runs ~100–1000 warm-up iterations before
  timing, so V8 tier-ups don't bias the first run.
- **Not a replacement for profiling.** If you're hunting a real perf bug,
  pair this with `node --prof` or the Chrome DevTools inspector — the numbers
  here are directional only.

## CI

Benches run as part of `npm test --workspaces` via
`node --import tsx --test bench/*.bench.ts` wired from the root `test`
script. If the thresholds are too tight on a slow CI runner, relax the
`assert.ok(opsPerSec > …)` bounds — don't remove the assertions, they're
the regression guardrail.
