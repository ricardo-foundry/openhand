/**
 * @module @openhand/sandbox/v2
 *
 * Sandbox v2 enhancements layered on top of the v1 `SecureSandbox` —
 * each piece is opt-in and zero-dependency, so v1 callers keep working
 * unchanged.
 *
 * Three independent enhancements live in this file:
 *
 *   1. **CPU-time limits**: `wrapWithCpuLimit(spawnArgs, cpuMs)` returns a
 *      mutated set of spawn arguments that wrap the binary in a `timeout(1)`
 *      call when the platform exposes one. On platforms that don't have
 *      a portable `timeout` (notably bare macOS), we fall back to the
 *      v1 wallclock SIGKILL — `runInSandbox` already does this, so the
 *      caller gets a hard upper bound either way.
 *
 *   2. **Memory limits via setrlimit**: `wrapWithMemoryLimit(spawnArgs, mb)`
 *      uses `prlimit` (util-linux) when available to set RLIMIT_AS on the
 *      child. If `prlimit` isn't on PATH we degrade to wrapping in
 *      `sh -c 'ulimit -v <kb>; exec …'`, which works on every POSIX shell
 *      but is best-effort because the actual cap depends on the kernel.
 *
 *   3. **Network isolation**: when the runtime env carries `NET=none`,
 *      `createNetGuardedFetch()` returns a fetch wrapper that refuses every
 *      call with a deterministic, type-tagged error so plugin code can
 *      detect and surface "no network" rather than crashing on a
 *      vendor-specific TLS error.
 *
 * None of these enhancements punch a hole through v1's allowlists;
 * they're additive caps + a fetch shim that the host plugin runtime can
 * adopt voluntarily.
 */
import * as fs from 'fs';

/** Outcome of a wrap helper. We separate `prefix`/`extraArgs` so callers
 * can decide whether to apply the wrapper, and so we never silently turn
 * an `execve(node)` into an `execve(sh -c node)` without the caller asking. */
export interface WrappedSpawn {
  command: string;
  args: string[];
  /** Human-readable note explaining what (if anything) was changed. */
  note: string;
  /** True iff the helper actually rewrote command/args. */
  applied: boolean;
}

/**
 * Wrap a spawn pair `(command, args)` so the kernel kills the child after
 * `cpuMs` milliseconds of wallclock time. We use `timeout(1)` from
 * coreutils because it's universal on Linux and ships on macOS via
 * Homebrew's `coreutils` (`gtimeout`). When neither is on PATH we leave
 * the spawn alone — the caller's wallclock SIGKILL is still in force.
 *
 * IMPORTANT: This is wallclock seconds, NOT user-CPU seconds. cgroups would
 * give us real CPU accounting but cgroup-v2 isn't portable to macOS or
 * the typical user shell. This is documented in `docs/SANDBOX_v2.md`.
 */
export function wrapWithCpuLimit(
  command: string,
  args: readonly string[],
  cpuMs: number,
): WrappedSpawn {
  if (!Number.isFinite(cpuMs) || cpuMs <= 0) {
    return { command, args: [...args], note: 'cpuMs invalid — left untouched', applied: false };
  }
  const seconds = Math.max(1, Math.ceil(cpuMs / 1000));
  const bin = findOnPath(['timeout', 'gtimeout']);
  if (!bin) {
    return {
      command,
      args: [...args],
      note: 'no timeout(1) on PATH — falling back to wallclock SIGKILL',
      applied: false,
    };
  }
  // `--kill-after=2` so a child that ignores SIGTERM still gets SIGKILL.
  // `-s TERM` is the default; we make it explicit for readability.
  return {
    command: bin,
    args: ['--kill-after=2', '-s', 'TERM', `${seconds}`, command, ...args],
    note: `wrapped with ${bin} ${seconds}s`,
    applied: true,
  };
}

/**
 * Wrap a spawn pair so the child has an address-space (RLIMIT_AS) cap of
 * `memoryMb` megabytes. Order of preference:
 *
 *   1. `prlimit --as=<bytes>` — exact, no extra shell.
 *   2. `sh -c 'ulimit -v <kb>; exec <cmd> "$@"' -- <cmd> <args…>` — works
 *      on any POSIX shell. We use `exec` so the shell doesn't stick around.
 *
 * Both paths preserve argv exactly — we never feed user data through the
 * shell's parser; the shell only ever sees a fixed string with positional
 * args spliced in via `$@`.
 */
export function wrapWithMemoryLimit(
  command: string,
  args: readonly string[],
  memoryMb: number,
): WrappedSpawn {
  if (!Number.isFinite(memoryMb) || memoryMb <= 0) {
    return { command, args: [...args], note: 'memoryMb invalid — left untouched', applied: false };
  }
  const bytes = Math.floor(memoryMb * 1024 * 1024);
  const prlimit = findOnPath(['prlimit']);
  if (prlimit) {
    return {
      command: prlimit,
      args: [`--as=${bytes}`, command, ...args],
      note: `wrapped with prlimit --as=${bytes}`,
      applied: true,
    };
  }
  const sh = findOnPath(['sh']);
  if (sh) {
    const kb = Math.floor(bytes / 1024);
    // The script body never interpolates argv. `"$@"` is the safe argv
    // forwarder — the shell does not re-tokenise array positional params.
    return {
      command: sh,
      args: ['-c', `ulimit -v ${kb}; exec "$0" "$@"`, command, ...args],
      note: `wrapped with sh -c 'ulimit -v ${kb}; exec ...'`,
      applied: true,
    };
  }
  return {
    command,
    args: [...args],
    note: 'neither prlimit nor sh on PATH — memory cap not applied',
    applied: false,
  };
}

/** Result of a guarded fetch when the network policy denies the call. */
export class NetworkBlockedError extends Error {
  override readonly name = 'NetworkBlockedError';
  readonly url: string;
  readonly reason: string;
  constructor(url: string, reason: string) {
    super(`network blocked: ${reason} (url=${url})`);
    this.url = url;
    this.reason = reason;
  }
}

export interface NetGuardConfig {
  /** Override the env. Useful for tests. */
  env?: NodeJS.ProcessEnv;
  /** Inject the underlying fetch. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

/**
 * Build a fetch wrapper that respects the `NET` env flag.
 *
 *   NET=none  → every call rejects with `NetworkBlockedError` *before*
 *               any DNS lookup or TCP socket is opened.
 *   NET=*     → pass through to the underlying fetch.
 *   unset     → pass through.
 *
 * The check is purely string-equal — we deliberately don't accept
 * `0`/`false`/`off` etc. so an operator's intent is unambiguous: they
 * either set `NET=none` or they don't.
 */
export function createNetGuardedFetch(config: NetGuardConfig = {}): typeof fetch {
  const env = config.env ?? process.env;
  const realFetch = config.fetchImpl ?? ((...a: Parameters<typeof fetch>) => globalThis.fetch(...a));
  // We snapshot the env value at construction time. Plugins that run
  // for hours don't want a half-loaded NET=none to flip mid-stream, and
  // this matches how RLIMIT_AS works — set once at process start.
  const blocked = (env.NET ?? '').trim() === 'none';
  const wrapper: typeof fetch = async (input, init) => {
    if (!blocked) return realFetch(input, init);
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : (input as Request).url;
    throw new NetworkBlockedError(url, 'NET=none — sandbox network isolation is on');
  };
  return wrapper;
}

/** Tiny PATH lookup that doesn't require child_process.execSync. */
function findOnPath(candidates: readonly string[]): string | null {
  const pathEnv = process.env.PATH ?? '';
  // No need to handle Windows here — sandbox runs Unix-only and we already
  // bail out of memory caps cleanly when PATH is empty.
  const sep = process.platform === 'win32' ? ';' : ':';
  const dirs = pathEnv.split(sep).filter(Boolean);
  for (const cand of candidates) {
    for (const dir of dirs) {
      const full = `${dir}/${cand}`;
      try {
        const stat = fs.statSync(full);
        if (stat.isFile()) {
          // Best-effort executable check. fs.accessSync with X_OK is the
          // honest signal but throws — we already swallow under try/catch.
          fs.accessSync(full, fs.constants.X_OK);
          return full;
        }
      } catch {
        /* not here, keep looking */
      }
    }
  }
  return null;
}

/** Reserved env-var name the host runtime checks. Exported so callers can
 * mirror the literal in their own checks rather than hardcoding the string. */
export const NET_ENV_VAR = 'NET' as const;
export const NET_ENV_VALUE_NONE = 'none' as const;
