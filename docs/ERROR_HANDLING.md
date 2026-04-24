# Error Handling Strategy

OpenHand distinguishes **four** error categories. The category drives three
orthogonal decisions: **do we retry?**, **do we surface the message to the
user verbatim?**, and **which log level do we use?**

| Category | Retry? | User-visible? | Log level |
| --- | --- | --- | --- |
| `UserError` | No | Yes, verbatim | `info` |
| `ProviderError` | Yes, conditionally | Summarised | `warn` |
| `SandboxError` | No | Summarised | `warn` |
| `InternalError` | No | Generic ("something went wrong") | `error` |

## UserError

**Definition.** The caller did something wrong: bad input, missing required
field, unknown slash command, tool that isn't installed, permission denied by
policy.

**Detection.** Thrown deliberately by our own code, e.g.
`throw new Error('Tool "shell" not found')` in `Agent.executeTask`. Policy
denials, validation failures, `/model bogus:x` in the REPL.

**Rules.**
- **Never retry.** The outcome will be identical.
- **Show the full message to the user.** They need it to self-correct.
- **Log at `info`.** This is expected traffic; it is not an alarm.
- **Never wrap.** Propagate the original `Error` object so callers (CLI, REPL,
  SSE route) can render it as-is.

## ProviderError

**Definition.** A third-party LLM provider (OpenAI, Anthropic, Ollama)
returned something we couldn't use: HTTP 4xx/5xx, timeout, malformed JSON,
rate limit, authentication failure.

**Detection.** `@openhand/llm` always throws `LLMError` (see
`packages/llm/src/types.ts`) with fields `{ code, status, provider }`.

**Rules.**
- **Retry if the error is transient.** `LLMClient` does this automatically
  via `defaultShouldRetry` in `packages/llm/src/client.ts`:
  - HTTP **408**, **429**, **5xx** → retry with exponential backoff + jitter.
  - HTTP **401**, **403** → do NOT retry. Auth failures are permanent until
    the user fixes their API key.
  - `TypeError` / network errors → retry.
- **Surface a summary.** Show the user "Provider failed: <code>". Do NOT leak
  raw stack traces, response bodies, or headers — they can contain
  internal IP addresses or correlation IDs.
- **Log at `warn`.** Include `{ provider, code, status, attempt }` as
  structured fields so operators can see rate-limit spikes.
- **Tag every `LLMError`.** Use the `code` field (`http_error`, `bad_json`,
  `no_choice`, `stream_closed`, …) — these are stable and greppable.

## SandboxError

**Definition.** The sandbox refused to execute something, or a child process
crashed / timed out / exceeded its memory or output limit.

**Detection.** Thrown from `SecureSandbox.runInSandbox` or
`checkCommand` / `checkPath`. The message starts with one of:
- `Command "X" is not in the allowed list`
- `Path "X" is not in the allowed list`
- `stdout exceeded 10 MiB cap`
- `Execution timeout after Nms`
- `Process exited with code N: <stderr>`

**Rules.**
- **Never retry.** A policy denial does not become allowed by retrying. A
  timeout suggests the command was CPU-bound or misconfigured — retrying
  would burn more time.
- **Surface a one-line summary.** Include the command name and the failure
  reason, *not* the full stderr (which may contain secrets).
- **Log at `warn`.** Sandbox denials are security-relevant — plumbing them
  into your SIEM is valuable. Use structured fields:
  `{ action, command, reason, taskId }`.
- **Emit a `violation` event on the sandbox EventEmitter** so downstream
  consumers (agent-manager, metrics) can react independently of logs.

## InternalError

**Definition.** Everything else. `TypeError`, `RangeError`, null-deref,
`EADDRINUSE`, unexpected filesystem errors during plugin load, inconsistent
state in the task stream, anything that indicates a bug in OpenHand itself.

**Detection.** Implicit — if none of the above match, treat as internal.

**Rules.**
- **Never retry.** The caller probably has no way to recover, and retrying
  a null-deref is a tight crash loop.
- **Hide the details from the user.** Render a generic message:
  "Something went wrong. See the logs for details." Expose only a
  correlation ID (we suggest `crypto.randomUUID()`) so users can quote it
  in bug reports.
- **Log at `error` with full stack trace** and every piece of structured
  context you have (taskId, sessionId, agentId, attempt, provider).
- **Consider a process-level handler.** In long-running servers, install
  `process.on('uncaughtException')` and `process.on('unhandledRejection')`
  to log + exit non-zero; systemd / k8s will restart the pod. **Do not**
  swallow unhandled rejections — they mask real bugs.

## Retry semantics

All retry budgets are bounded in two dimensions:

1. **Attempts.** `LLMClient.retry.maxAttempts` defaults to 3 (so 2 retries
   after the original). Keep this *low* — endless retries amplify outages.
2. **Delay.** Exponential backoff, capped by `maxDelayMs` (default 8s), with
   ±25% jitter so synchronized clients don't thunder the provider on
   recovery.

The retry loop also calls `shouldRetry(err)` — if it returns `false`, we
break immediately and surface the error. This is the hook callers use to
refuse retries on specific auth codes, or to *add* retries for a
provider-specific transient error we don't yet know about.

## User-visible messages: what to show

From the user's perspective:

- **UserError** → "Tool 'shell' is not installed. Run `/plugins list` to see
  what's available."
- **ProviderError** → "OpenAI returned HTTP 429. Retrying with backoff…"
  (and eventually, if all retries fail, "OpenAI is rate-limiting us. Try
  again in a minute.")
- **SandboxError** → "Sandbox refused to run `rm`: not in the allowed
  command list."
- **InternalError** → "Something went wrong (error id: 7f2a). Please file a
  bug with this id."

## Log level guidance

| Level | When |
| --- | --- |
| `debug` | Full LLM request/response bodies, per-attempt backoff timings, every SSE frame. Gated behind `OPENHAND_DEBUG=1`. |
| `info` | Task lifecycle transitions, plugin load events, REPL interactions. |
| `warn` | ProviderError, SandboxError, plugin failed to load, rate-limit saturated. |
| `error` | InternalError, failed task with no retry path, unhandled rejection. |

Structured logging is preferred over string-formatted messages: downstream
log aggregators filter by keys, not by regex on the message. See
`AGENTS.md` for the broader observability conventions.

## Testing error paths

Every category needs at least one test that:
- exercises the code path (bad input for UserError, mocked 5xx for
  ProviderError, disallowed command for SandboxError, throw-in-promise for
  InternalError);
- asserts the retry count (0 for UserError/SandboxError, >1 for transient
  ProviderError);
- asserts the user-visible message does not leak sensitive fields.

The existing test suite covers most of these — see
`packages/llm/tests/client.test.ts` for retry semantics and
`packages/sandbox/tests/policy.test.ts` for sandbox refusal paths.
