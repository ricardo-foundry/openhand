# Observability

OpenHand ships with a tiny, zero-dependency span recorder shaped like
OpenTelemetry. It lives in `@openhand/core/telemetry` and is meant to give
operators just enough signal — span name, attributes, duration, status,
parent/child links — without dragging in the full OTEL SDK.

If your stack already uses OTEL, the design lets you bolt on a real exporter
in ~30 lines (see [Custom exporter](#custom-exporter) below).

---

## Quick start

```ts
import { getTracer, SPAN_TOOL_INVOKE } from '@openhand/core';

const tracer = getTracer();

await tracer.withSpan(SPAN_TOOL_INVOKE, async (span) => {
  span.setAttribute('tool.name', 'calc_eval');
  return await tool.execute(params, ctx);
}, { 'tool.name': 'calc_eval' });
```

By default the tracer uses a **noop** exporter — spans are recorded but
discarded. Turn one on via `OTEL_EXPORTER`:

```bash
# JSON Lines on stdout (great for piping into jq / lnav)
OTEL_EXPORTER=stdout openhand chat

# Append to a file (one line per finished span)
OTEL_EXPORTER=file:/tmp/openhand-spans.jsonl openhand chat
```

---

## Span model

Every span exports:

| Field | Type | Notes |
| --- | --- | --- |
| `traceId` | 16-hex string | Shared across a span tree |
| `spanId` | 16-hex string | Unique per span |
| `parentSpanId` | 16-hex string \| null | `null` for root |
| `name` | string | e.g. `agent.execute` |
| `kind` | string | First segment of the name (`agent`, `tool`, `llm`, `plugin`, `custom`) |
| `startTime` / `endTime` | unix-ms | `Date.now()` epoch ms |
| `durationMs` | number | `endTime - startTime` |
| `status` | `'ok' \| 'error' \| 'unset'` | Set by the caller via `end(status)` or `recordError` |
| `error` | `{ message, stack? }` | Present only on `status: 'error'` |
| `attributes` | `Record<string, primitive>` | Free-form; conventionally dotted (`tool.name`, `llm.model`) |

### Reserved span names

Core code uses (and reserves) these four names. Use them yourself when you're
extending the agent loop so dashboards stay consistent.

| Constant | Name | Where |
| --- | --- | --- |
| `SPAN_AGENT_EXECUTE` | `agent.execute` | One `Agent.chat()` turn |
| `SPAN_TOOL_INVOKE` | `tool.invoke` | One tool execution |
| `SPAN_LLM_COMPLETE` | `llm.complete` | One LLM request |
| `SPAN_PLUGIN_LOAD` | `plugin.load` | One plugin load cycle |

### Recommended attributes

Adopt these where it makes sense — they're what our future dashboards lean on:

- `agent.execute` → `session.id`, `iteration`, `message.length`
- `tool.invoke`   → `tool.name`, `tool.permissions`, `tool.sandbox_required`
- `llm.complete`  → `llm.provider`, `llm.model`, `llm.tokens_in`, `llm.tokens_out`, `llm.cost_usd`
- `plugin.load`   → `plugin.id`, `plugin.version`, `plugin.tool_count`

---

## Exporters

### `stdout`

```bash
OTEL_EXPORTER=stdout
```

One JSON line per finished span on `process.stdout`. Easy to pipe:

```bash
OTEL_EXPORTER=stdout openhand ask "ping" 2>/dev/null \
  | jq -c 'select(.kind=="tool")'
```

### `file:<path>`

```bash
OTEL_EXPORTER=file:/var/log/openhand/spans.jsonl
```

Appends one JSON line per span. The exporter opens the file lazily on the
first span and degrades to noop if the open fails — never crashes the host.
Call `getTracer().getExporter().flush?.()` at shutdown if you want a clean
file fsync.

### `noop` (default)

Anything that isn't `stdout` or `file:<path>` resolves to noop. We intentionally
**fail closed** on unknown exporter strings so a typo doesn't silently leak
spans to stdout.

### Custom exporter

```ts
import { getTracer, type Exporter, type FinishedSpan } from '@openhand/core';

const otlp: Exporter = {
  export(span: FinishedSpan) {
    fetch('http://localhost:4318/v1/traces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(toOtlp(span)),
    }).catch(() => {});
  },
  async flush() { /* drain queue */ },
};

getTracer().setExporter(otlp);
```

The exporter contract is two methods: `export(span)` (must not throw, called
sync after each span ends) and an optional `flush()` (drain at shutdown).

---

## Patterns

### Wrap an operation

`withSpan` runs your fn inside a span, captures errors, and ends the span
unconditionally. Prefer it over manual `start()` + `end()`:

```ts
const result = await tracer.withSpan('agent.execute', async (span) => {
  span.setAttribute('iteration', i);
  return await runOneTurn(state);
}, { 'session.id': sessionId });
```

### Manual lifecycle (when you can't wrap)

```ts
const span = tracer.start('llm.complete', { 'llm.provider': 'openai' });
try {
  const r = await client.complete(req);
  span.setAttributes({ 'llm.tokens_in': r.usage.in, 'llm.tokens_out': r.usage.out });
  span.end('ok');
  return r;
} catch (e) {
  span.recordError(e);
  span.end('error');
  throw e;
}
```

### Test helper

Tests can swap the exporter without touching env:

```ts
import { Tracer } from '@openhand/core';

const spans: FinishedSpan[] = [];
const tracer = new Tracer();
tracer.setExporter({ export: (s) => spans.push(s) });
```

For tests that consume the singleton, use `_resetTracerForTests()` (test-only
export) to drop the global instance between cases.

---

## Performance

A noop exporter pays one `Date.now()` and one object alloc per span. The file
exporter does one `JSON.stringify` and an append-mode write per span — fast
enough for tens of thousands of spans/sec on commodity hardware. If you go
higher, switch to a custom exporter that batches in memory and flushes on a
timer.

---

## What about OTEL SDK?

We deliberately don't ship `@opentelemetry/api` in core for v0.7. Reasons:

1. **Audit budget.** Pulling OTEL adds ~30 transitive deps; we're at 0 npm
   audit findings and want to stay there.
2. **Surface area.** Most operators want "JSON lines I can grep" or "ship to
   our backend"; both fit in 30 lines of code.
3. **Adapter is trivial.** `Exporter` is a single-method interface — wiring
   it to the OTEL SDK is a downstream package, not a core concern.

If a future round adds an official OTLP exporter it'll live in
`@openhand/observability` so the runtime stays small.
