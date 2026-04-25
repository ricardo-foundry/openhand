# Sandbox v2

> Audience: plugin authors and operators who need defence-in-depth beyond the v1 path/command allowlists.

The v1 `SecureSandbox` (in `packages/sandbox/src/sandbox.ts`) covers the cases a single-host AI agent has to get right by default: command allowlisting, path containment, NUL-byte rejection, no-shell spawning, wallclock kill escalation. Sandbox **v2** layers three additional guards on top, all opt-in and zero-dependency.

| Guard               | API                          | Mechanism                                     | Portable? |
| ------------------- | ---------------------------- | --------------------------------------------- | --------- |
| CPU time limit      | `wrapWithCpuLimit`           | `timeout(1)` from coreutils                   | Linux + macOS (with `coreutils` installed) — fall back to v1 wallclock SIGKILL on bare macOS |
| Memory limit        | `wrapWithMemoryLimit`        | `prlimit --as=<bytes>`, fallback `sh -c 'ulimit -v'` | Linux first-class; macOS via `prlimit` is rare — fallback path used |
| Network isolation   | `createNetGuardedFetch`      | `NET=none` env flag → fetch wrapper rejects   | Universal — pure JS check |

All three are exported from `@openhand/sandbox`.

```ts
import {
  wrapWithCpuLimit,
  wrapWithMemoryLimit,
  createNetGuardedFetch,
  NetworkBlockedError,
} from '@openhand/sandbox';
```

## 1. CPU-time limits

`wrapWithCpuLimit(command, args, cpuMs)` returns a `WrappedSpawn` describing how to spawn the same logical process with a hard CPU-time cap:

```ts
const out = wrapWithCpuLimit('node', ['big-calc.js'], 5_000);
// out.command = '/usr/bin/timeout' (or similar)
// out.args    = ['--kill-after=2', '-s', 'TERM', '5', 'node', 'big-calc.js']
// out.applied = true
spawn(out.command, out.args, { stdio: 'inherit' });
```

Why not cgroups? cgroup v2 would give us real user-CPU accounting, but it's not portable to macOS, the API drifts between distros, and an unprivileged plugin author shouldn't have to mount a cgroup hierarchy to run `cat`. The contract here is intentionally weaker: **wallclock seconds, killed with SIGTERM then SIGKILL**.

When `timeout(1)` is not on `PATH`, the helper returns `applied: false` and you keep the original spawn pair. `SecureSandbox.runInSandbox` already enforces a wallclock SIGKILL escalation with a 5-second TERM grace, so you still have a hard upper bound — it just isn't named `timeout`.

## 2. Memory limits

`wrapWithMemoryLimit(command, args, memoryMb)` sets `RLIMIT_AS` (address-space) on the child:

```ts
const out = wrapWithMemoryLimit('node', ['solver.js'], 256);
// On Linux with prlimit:
//   command = 'prlimit', args = ['--as=268435456', 'node', 'solver.js']
// Fallback shell:
//   command = 'sh', args = ['-c', 'ulimit -v 262144; exec "$0" "$@"', 'node', 'solver.js']
```

The shell fallback uses `"$0" "$@"` so positional args are forwarded **verbatim** by the shell built-in — no interpolation, no risk of metacharacter expansion in user-supplied paths. We tested that path explicitly with adversarial args like `"/tmp/oh; rm -rf /"` (see `packages/sandbox/tests/v2.test.ts`).

What `RLIMIT_AS` actually caps:
- Heap allocations.
- mmap'd files.
- Stack (combined with the kernel's stack accounting).

What it does **not** cap:
- Disk writes (use the v1 `allowedPaths` instead).
- Number of file descriptors (use `RLIMIT_NOFILE` separately if needed — out of scope here).

## 3. Network isolation via `NET=none`

`createNetGuardedFetch()` returns a `fetch`-shaped function whose behaviour is determined at *construction time* by the `NET` env var:

```ts
const fetchSafe = createNetGuardedFetch();
process.env.NET = 'none';                              // operator policy
const fetchSafe2 = createNetGuardedFetch();            // re-read env

await fetchSafe2('https://api.openai.com/v1/models');
// → throws NetworkBlockedError { url, reason: 'NET=none …' }
```

Two design decisions worth flagging:

1. **Strict string equality.** Only `NET=none` blocks. Truthy values like `0`, `false`, `off` do nothing. This is deliberate — operator intent must be unambiguous.
2. **Snapshot at construction.** Once the wrapper is built, flipping `NET` mid-process won't change behaviour. This matches how `RLIMIT_AS` works (set once at exec) and prevents racy half-isolation.

Plugins that want to honour the policy should adopt the wrapper instead of using `globalThis.fetch`:

```ts
// plugins/web-scraper/index.js
const { createNetGuardedFetch } = require('@openhand/sandbox');
const fetchSafe = createNetGuardedFetch();
async function getPage(url) {
  return fetchSafe(url, { redirect: 'manual' });
}
```

The host runtime can also pass the wrapper into providers that accept a `fetchImpl` (`OpenAIProvider`, `AnthropicProvider`, `OllamaProvider` all take one) — that gives you a single chokepoint for "this plugin must not reach the network" without modifying provider code.

## End-to-end recipe

```ts
import {
  SecureSandbox,
  wrapWithCpuLimit,
  wrapWithMemoryLimit,
  createNetGuardedFetch,
} from '@openhand/sandbox';

// v1: command + path + arg allowlists
const sandbox = new SecureSandbox({
  allowedCommands: ['node'],
  allowedPaths: [process.cwd()],
  timeout: 30_000,
});

// v2: stack the three caps before handing the spawn pair to the OS
let { command, args } = wrapWithCpuLimit('node', ['child.js'], 5_000);
({ command, args } = wrapWithMemoryLimit(command, args, 256));

// network: hand plugins this fetch instead of globalThis.fetch
const fetch = createNetGuardedFetch();
```

## What v2 is NOT

- It's **not** a container — there's no namespace isolation, no rootfs separation, no syscall filter.
- It's **not** a defence against a malicious plugin author with arbitrary-code-execution capability inside the host. The v1 boundary (no `bash -c`, no `node -e`, command allowlist) is what stops that path.
- It's **not** rate-limiting — that lives in `LLMClient` (`packages/llm/src/client.ts`).

For workloads that need a real container, run OpenHand inside Docker / Firecracker / nsjail and treat the sandbox as the inner ring.
