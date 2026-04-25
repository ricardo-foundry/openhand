// OpenHand Telemetry — zero-dependency, OpenTelemetry-shaped span recorder.
//
// We deliberately avoid pulling in `@opentelemetry/*` for v0.7. The runtime
// surface area is small (start a span, set attributes, end with a status,
// optionally record an error) and the whole point of the file is that it
// stays trivially auditable. If a downstream user wants real OTEL, they can
// wire `setExporter()` to an adapter that ships spans to a collector.
//
// Span model:
//   - Each span has an id, parent id (for nesting), trace id (shared across
//     the whole tree), kind, attributes, and a status ('ok' | 'error' |
//     'unset'). Timings are millisecond Date.now() values. Parent/child
//     stacking is per-tracer and tracked via a stack.
//
// Exporters:
//   - `stdout`: writes one JSON line per finished span to process.stdout.
//   - `file:<path>`: appends one JSON line per finished span to <path>.
//   - `noop`:    drop everything (default; keeps tests quiet).
//   - Custom:    pass `{ export: (span) => void }` to `setExporter`.
//
// Configuration:
//   - `OTEL_EXPORTER=stdout`           → stdout exporter
//   - `OTEL_EXPORTER=file:/var/log/oh.jsonl` → file exporter
//   - unset / anything else            → noop exporter
//
// Reserved span names used by the rest of the codebase:
//   - `agent.execute`   — one Agent.chat(...) turn
//   - `tool.invoke`     — one tool.execute(...) call
//   - `llm.complete`    — one LLMClient.complete(...) request
//   - `plugin.load`     — one PluginLoader.load(...) cycle
//
// Whatever calls `tracer.start(name, attrs)` MUST end the returned handle,
// even on failure — we expose `withSpan(name, fn)` for the common case.

import * as fs from 'fs';

export type SpanStatus = 'unset' | 'ok' | 'error';

export interface SpanAttributes {
  [key: string]: string | number | boolean | null | undefined;
}

export interface FinishedSpan {
  /** Hex-ish 16-char trace id, shared across the span tree. */
  traceId: string;
  /** Hex-ish 16-char span id, unique per span. */
  spanId: string;
  /** Parent span id, or null for root. */
  parentSpanId: string | null;
  name: string;
  /** Free-form category (`agent`, `tool`, `llm`, `plugin`, `custom`). */
  kind: string;
  /** Unix-ms start time. */
  startTime: number;
  /** Unix-ms end time. */
  endTime: number;
  /** endTime - startTime, ms. */
  durationMs: number;
  status: SpanStatus;
  /** Set when status === 'error'. */
  error?: { message: string; stack?: string } | undefined;
  attributes: SpanAttributes;
}

export interface SpanHandle {
  setAttribute(key: string, value: string | number | boolean | null | undefined): void;
  setAttributes(attrs: SpanAttributes): void;
  /** Mark the span as failed. Calling end() afterwards still records duration. */
  recordError(err: unknown): void;
  /** Finish the span with the given status. Calling twice is a no-op. */
  end(status?: SpanStatus): void;
  /** Read-only fields a caller might want for logging. */
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
}

export interface Exporter {
  /** Called once per finished span. Must not throw. */
  export(span: FinishedSpan): void;
  /** Optional flush hook (e.g. fsync a file exporter). */
  flush?(): void | Promise<void>;
}

const NOOP_EXPORTER: Exporter = { export() {} };

/**
 * Stable 16-hex-char id. Crypto-strong if `globalThis.crypto` is available
 * (Node 20+, browsers); otherwise falls back to Math.random — fine for the
 * non-security-critical id role here.
 */
function randomId(): string {
  const cryptoObj: { getRandomValues?: (a: Uint8Array) => Uint8Array } | undefined =
    (globalThis as any).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const buf = new Uint8Array(8);
    cryptoObj.getRandomValues(buf);
    let out = '';
    for (const b of buf) out += b.toString(16).padStart(2, '0');
    return out;
  }
  // Fallback — two 32-bit chunks of Math.random.
  const a = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  const b = Math.floor(Math.random() * 0xffffffff).toString(16).padStart(8, '0');
  return a + b;
}

/**
 * Tracer keeps an in-memory parent stack so nested `start()` calls without
 * an explicit parent get a sensible default. Every call to `start()` allocates
 * exactly one span object — no hidden async hops, so behaviour is identical
 * under sync and async fns.
 */
export class Tracer {
  private exporter: Exporter = NOOP_EXPORTER;
  private stack: Array<{ traceId: string; spanId: string }> = [];

  /** Replace the exporter. Pass `null`/`undefined` to disable. */
  setExporter(exporter: Exporter | null | undefined): void {
    this.exporter = exporter ?? NOOP_EXPORTER;
  }

  getExporter(): Exporter {
    return this.exporter;
  }

  /**
   * Start a span. If `parent` is omitted, the current top-of-stack span (if
   * any) is used as parent so nested code blocks compose without ceremony.
   */
  start(
    name: string,
    attributes: SpanAttributes = {},
    options: { kind?: string; parent?: { traceId: string; spanId: string } | null } = {},
  ): SpanHandle {
    const explicitParent = options.parent;
    const implicitParent = this.stack[this.stack.length - 1];
    const parent = explicitParent === undefined ? implicitParent : explicitParent;

    const traceId = parent?.traceId ?? randomId();
    const spanId = randomId();
    const parentSpanId = parent?.spanId ?? null;
    const kind = options.kind ?? deriveKind(name);
    const startTime = Date.now();
    const attrs: SpanAttributes = { ...attributes };

    let status: SpanStatus = 'unset';
    let error: FinishedSpan['error'] = undefined;
    let ended = false;
    const tracer = this;

    // Push our id onto the stack so nested start() calls treat us as parent.
    this.stack.push({ traceId, spanId });

    const handle: SpanHandle = {
      traceId,
      spanId,
      parentSpanId,
      setAttribute(key, value) {
        attrs[key] = value;
      },
      setAttributes(more) {
        Object.assign(attrs, more);
      },
      recordError(err) {
        status = 'error';
        if (err instanceof Error) {
          error = { message: err.message, stack: err.stack ?? '' };
        } else {
          error = { message: String(err) };
        }
      },
      end(finalStatus) {
        if (ended) return;
        ended = true;
        // Pop our id off the stack, defending against out-of-order ends:
        // we only pop the top frame if it matches our spanId, otherwise we
        // leave the stack alone (caller bug, but we don't want to corrupt it).
        const top = tracer.stack[tracer.stack.length - 1];
        if (top && top.spanId === spanId) tracer.stack.pop();
        if (finalStatus !== undefined) status = finalStatus;
        if (status === 'unset') status = 'ok';
        const endTime = Date.now();
        const span: FinishedSpan = {
          traceId,
          spanId,
          parentSpanId,
          name,
          kind,
          startTime,
          endTime,
          durationMs: endTime - startTime,
          status,
          ...(error !== undefined ? { error } : {}),
          attributes: attrs,
        };
        try {
          tracer.exporter.export(span);
        } catch {
          // Exporter must never break the user's code. Swallow silently.
        }
      },
    };
    return handle;
  }

  /**
   * Convenience wrapper. Runs `fn` inside a span, records exceptions, and
   * always ends the span. Returns whatever `fn` returns (await-aware).
   */
  async withSpan<T>(
    name: string,
    fn: (span: SpanHandle) => T | Promise<T>,
    attributes: SpanAttributes = {},
    options: { kind?: string } = {},
  ): Promise<T> {
    const span = this.start(name, attributes, options);
    try {
      const out = await fn(span);
      span.end('ok');
      return out;
    } catch (err) {
      span.recordError(err);
      span.end('error');
      throw err;
    }
  }

  /**
   * Synchronous variant of withSpan — caller asserts `fn` is sync. Useful in
   * hot paths where we don't want to wrap everything in microtasks.
   */
  withSpanSync<T>(
    name: string,
    fn: (span: SpanHandle) => T,
    attributes: SpanAttributes = {},
    options: { kind?: string } = {},
  ): T {
    const span = this.start(name, attributes, options);
    try {
      const out = fn(span);
      span.end('ok');
      return out;
    } catch (err) {
      span.recordError(err);
      span.end('error');
      throw err;
    }
  }
}

function deriveKind(name: string): string {
  const dot = name.indexOf('.');
  return dot > 0 ? name.slice(0, dot) : 'custom';
}

/**
 * Stdout exporter — one JSON line per span. We write directly to `process.stdout`
 * (not `console.log`) so callers piping JSON downstream don't have to dodge
 * console formatting.
 */
export function stdoutExporter(): Exporter {
  return {
    export(span) {
      try {
        process.stdout.write(JSON.stringify(span) + '\n');
      } catch {
        /* never throw */
      }
    },
  };
}

/**
 * File exporter — appends one JSON line per span. Opens an append-mode write
 * stream once; if the open fails we degrade to noop without crashing the host.
 */
export function fileExporter(filePath: string): Exporter {
  let stream: fs.WriteStream | null = null;
  let openFailed = false;
  function ensureStream(): fs.WriteStream | null {
    if (stream || openFailed) return stream;
    try {
      stream = fs.createWriteStream(filePath, { flags: 'a' });
      // Errors after open (disk full, EBADF) — don't crash the host.
      stream.on('error', () => {
        openFailed = true;
        stream = null;
      });
    } catch {
      openFailed = true;
      stream = null;
    }
    return stream;
  }
  return {
    export(span) {
      const s = ensureStream();
      if (!s) return;
      try {
        s.write(JSON.stringify(span) + '\n');
      } catch {
        /* never throw */
      }
    },
    flush() {
      return new Promise<void>(resolve => {
        if (!stream) return resolve();
        // `end()` flushes the queue, then closes the fd.
        stream.end(() => resolve());
        stream = null;
      });
    },
  };
}

/**
 * Parse `OTEL_EXPORTER` (or any env-style string) into an exporter. Unknown
 * values resolve to a noop exporter so the runtime never silently mis-routes.
 */
export function exporterFromEnv(value: string | undefined): Exporter {
  if (!value) return NOOP_EXPORTER;
  const trimmed = value.trim();
  if (trimmed === 'stdout') return stdoutExporter();
  if (trimmed.startsWith('file:')) {
    const path = trimmed.slice('file:'.length);
    if (!path) return NOOP_EXPORTER;
    return fileExporter(path);
  }
  if (trimmed === 'noop' || trimmed === 'none' || trimmed === 'off') return NOOP_EXPORTER;
  return NOOP_EXPORTER;
}

/**
 * Singleton tracer used by core/agent/plugin code. Tests can swap exporters
 * via `getTracer().setExporter(...)` — no need to thread an instance through.
 */
let globalTracer: Tracer | null = null;

export function getTracer(): Tracer {
  if (!globalTracer) {
    globalTracer = new Tracer();
    // Boot-time configuration via env. We read once; tests that need to
    // change exporter call setExporter directly.
    const exporter = exporterFromEnv(process.env.OTEL_EXPORTER);
    globalTracer.setExporter(exporter);
  }
  return globalTracer;
}

/** Test helper — throws away the singleton. Not exported via index. */
export function _resetTracerForTests(): void {
  globalTracer = null;
}

// Reserved span name constants — keeps call sites consistent.
export const SPAN_AGENT_EXECUTE = 'agent.execute';
export const SPAN_TOOL_INVOKE = 'tool.invoke';
export const SPAN_LLM_COMPLETE = 'llm.complete';
export const SPAN_PLUGIN_LOAD = 'plugin.load';

// =====================================================================
//  Metrics — counter + histogram, OTEL-shaped, zero-dependency.
// =====================================================================
//
// Spans answer "what happened on this code path?". Metrics answer "how
// often, and how slow?" — they're cheaper to keep, easier to alert on,
// and the typical observability stack already speaks Counter / Histogram
// natively. We model both, mirroring the OTEL Metrics API surface but
// keeping the storage in-memory and synchronous.
//
// Counters are monotonic non-negative — `inc()` only goes up.
// Histograms record a value into a bucket lattice (default OTEL buckets
//   for milliseconds: 0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000,
//   10_000, +Inf). Total + sum + per-bucket count are kept.
//
// Both are tagged with the same string-only `Attributes` so we can group
// by, e.g., `provider=openai` without exploding the cardinality with raw
// numbers (string-only attributes is intentional — we want bounded
// label sets).

export type MetricAttributes = Readonly<Record<string, string>>;

export type MetricKind = 'counter' | 'histogram';

export interface MetricSnapshotBase {
  name: string;
  kind: MetricKind;
  description?: string;
  unit?: string;
}

export interface CounterSnapshot extends MetricSnapshotBase {
  kind: 'counter';
  /** One row per unique attribute combination. */
  series: Array<{ attributes: MetricAttributes; value: number }>;
}

export interface HistogramSnapshot extends MetricSnapshotBase {
  kind: 'histogram';
  buckets: readonly number[];
  series: Array<{
    attributes: MetricAttributes;
    count: number;
    sum: number;
    /** Cumulative bucket counts, parallel to `buckets`, with a final
     *  +Inf bucket for values >= last threshold. */
    bucketCounts: number[];
  }>;
}

export type MetricSnapshot = CounterSnapshot | HistogramSnapshot;

/** Stable canonicalisation of an attribute set — used as the series key. */
function attrKey(attrs: MetricAttributes): string {
  const keys = Object.keys(attrs).sort();
  if (keys.length === 0) return '';
  return keys.map(k => `${k}=${attrs[k]}`).join('|');
}

/** Default histogram buckets in milliseconds — close to the OTEL spec
 *  default exponential bucket pattern. Frozen so callers can't mutate. */
export const DEFAULT_HISTOGRAM_BUCKETS_MS: readonly number[] = Object.freeze([
  0, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000,
]);

export interface CounterOptions {
  description?: string;
  unit?: string;
}

export interface HistogramOptions {
  description?: string;
  unit?: string;
  /** Override the bucket lattice. Must be sorted ascending. */
  buckets?: readonly number[];
}

export class Counter {
  readonly name: string;
  readonly description?: string;
  readonly unit?: string;
  private readonly series = new Map<string, { attributes: MetricAttributes; value: number }>();

  constructor(name: string, opts: CounterOptions = {}) {
    this.name = name;
    if (opts.description !== undefined) this.description = opts.description;
    if (opts.unit !== undefined) this.unit = opts.unit;
  }

  /** Increment by `delta` (default 1). Negative deltas are rejected. */
  inc(delta: number = 1, attributes: MetricAttributes = {}): void {
    if (!Number.isFinite(delta) || delta < 0) return;
    const key = attrKey(attributes);
    const cur = this.series.get(key);
    if (cur) {
      cur.value += delta;
    } else {
      this.series.set(key, { attributes: { ...attributes }, value: delta });
    }
  }

  reset(): void {
    this.series.clear();
  }

  snapshot(): CounterSnapshot {
    return {
      name: this.name,
      kind: 'counter',
      ...(this.description !== undefined ? { description: this.description } : {}),
      ...(this.unit !== undefined ? { unit: this.unit } : {}),
      series: Array.from(this.series.values()).map(s => ({
        attributes: { ...s.attributes },
        value: s.value,
      })),
    };
  }
}

export class Histogram {
  readonly name: string;
  readonly description?: string;
  readonly unit?: string;
  readonly buckets: readonly number[];
  private readonly series = new Map<
    string,
    { attributes: MetricAttributes; count: number; sum: number; bucketCounts: number[] }
  >();

  constructor(name: string, opts: HistogramOptions = {}) {
    this.name = name;
    if (opts.description !== undefined) this.description = opts.description;
    if (opts.unit !== undefined) this.unit = opts.unit;
    const raw = opts.buckets ?? DEFAULT_HISTOGRAM_BUCKETS_MS;
    // Sanity: buckets must be sorted ascending. Sort defensively rather
    // than throw — bad input shouldn't bring down the host process.
    this.buckets = Object.freeze([...raw].sort((a, b) => a - b));
  }

  record(value: number, attributes: MetricAttributes = {}): void {
    if (!Number.isFinite(value)) return;
    const key = attrKey(attributes);
    let cur = this.series.get(key);
    if (!cur) {
      cur = {
        attributes: { ...attributes },
        count: 0,
        sum: 0,
        // +1 for the implicit +Inf overflow bucket.
        bucketCounts: new Array(this.buckets.length + 1).fill(0),
      };
      this.series.set(key, cur);
    }
    cur.count++;
    cur.sum += value;
    // Find the lowest bucket index whose threshold is >= value.
    let placed = false;
    for (let i = 0; i < this.buckets.length; i++) {
      const threshold = this.buckets[i] ?? 0;
      if (value <= threshold) {
        // Cumulative bucketing — bump every bucket from `i` onward.
        for (let j = i; j < cur.bucketCounts.length; j++) {
          cur.bucketCounts[j] = (cur.bucketCounts[j] ?? 0) + 1;
        }
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Overflow → only the +Inf bucket gets incremented.
      const last = cur.bucketCounts.length - 1;
      cur.bucketCounts[last] = (cur.bucketCounts[last] ?? 0) + 1;
    }
  }

  reset(): void {
    this.series.clear();
  }

  snapshot(): HistogramSnapshot {
    return {
      name: this.name,
      kind: 'histogram',
      ...(this.description !== undefined ? { description: this.description } : {}),
      ...(this.unit !== undefined ? { unit: this.unit } : {}),
      buckets: this.buckets,
      series: Array.from(this.series.values()).map(s => ({
        attributes: { ...s.attributes },
        count: s.count,
        sum: s.sum,
        bucketCounts: [...s.bucketCounts],
      })),
    };
  }
}

/**
 * `Meter` is the registry. Use `meter.counter('name')` /
 * `meter.histogram('name')` to look up or create an instrument by name —
 * subsequent calls with the same name return the same instance.
 *
 * The whole registry is in-memory; callers wanting to ship metrics should
 * call `snapshotAll()` on a tick (e.g. every 30s) and forward the result
 * to a Prometheus pushgateway / OTLP / log line. We deliberately don't
 * embed a push loop — that's a deployment concern.
 */
export class Meter {
  private readonly counters = new Map<string, Counter>();
  private readonly histograms = new Map<string, Histogram>();

  counter(name: string, opts: CounterOptions = {}): Counter {
    const existing = this.counters.get(name);
    if (existing) return existing;
    const c = new Counter(name, opts);
    this.counters.set(name, c);
    return c;
  }

  histogram(name: string, opts: HistogramOptions = {}): Histogram {
    const existing = this.histograms.get(name);
    if (existing) return existing;
    const h = new Histogram(name, opts);
    this.histograms.set(name, h);
    return h;
  }

  snapshotAll(): MetricSnapshot[] {
    const out: MetricSnapshot[] = [];
    for (const c of this.counters.values()) out.push(c.snapshot());
    for (const h of this.histograms.values()) out.push(h.snapshot());
    return out;
  }

  reset(): void {
    for (const c of this.counters.values()) c.reset();
    for (const h of this.histograms.values()) h.reset();
  }

  /** Test helper: drop every instrument. Use sparingly. */
  clearForTests(): void {
    this.counters.clear();
    this.histograms.clear();
  }
}

let globalMeter: Meter | null = null;

export function getMeter(): Meter {
  if (!globalMeter) globalMeter = new Meter();
  return globalMeter;
}

export function _resetMeterForTests(): void {
  globalMeter = null;
}

// Reserved metric names — kept in lockstep with the span names so a
// dashboard can correlate "agent.execute count" with "agent.execute
// duration histogram".
export const METRIC_AGENT_EXECUTE_COUNT = 'agent.execute.count';
export const METRIC_AGENT_EXECUTE_DURATION_MS = 'agent.execute.duration_ms';
export const METRIC_TOOL_INVOKE_COUNT = 'tool.invoke.count';
export const METRIC_TOOL_INVOKE_DURATION_MS = 'tool.invoke.duration_ms';
export const METRIC_LLM_COMPLETE_COUNT = 'llm.complete.count';
export const METRIC_LLM_COMPLETE_DURATION_MS = 'llm.complete.duration_ms';
export const METRIC_LLM_TOKENS = 'llm.tokens';
