import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  Counter,
  Histogram,
  Meter,
  DEFAULT_HISTOGRAM_BUCKETS_MS,
  getMeter,
  _resetMeterForTests,
  METRIC_AGENT_EXECUTE_COUNT,
  METRIC_LLM_COMPLETE_DURATION_MS,
} from '../src/telemetry';

// --- Counter ----------------------------------------------------------

test('Counter: inc() with no args defaults to +1', () => {
  const c = new Counter('http.requests');
  c.inc();
  c.inc();
  const snap = c.snapshot();
  assert.equal(snap.kind, 'counter');
  assert.equal(snap.series.length, 1);
  assert.equal(snap.series[0]?.value, 2);
});

test('Counter: rejects negative deltas (monotonic invariant)', () => {
  const c = new Counter('x');
  c.inc(5);
  c.inc(-3);
  c.inc(NaN);
  assert.equal(c.snapshot().series[0]?.value, 5);
});

test('Counter: tags split into separate series', () => {
  const c = new Counter('llm.complete.count');
  c.inc(1, { provider: 'openai' });
  c.inc(2, { provider: 'openai' });
  c.inc(1, { provider: 'anthropic' });
  const snap = c.snapshot();
  assert.equal(snap.series.length, 2);
  const openai = snap.series.find(s => s.attributes['provider'] === 'openai');
  const anthropic = snap.series.find(s => s.attributes['provider'] === 'anthropic');
  assert.equal(openai?.value, 3);
  assert.equal(anthropic?.value, 1);
});

test('Counter: same-attribute objects in different orders share a series', () => {
  const c = new Counter('x');
  c.inc(1, { a: '1', b: '2' });
  c.inc(1, { b: '2', a: '1' });
  assert.equal(c.snapshot().series.length, 1);
  assert.equal(c.snapshot().series[0]?.value, 2);
});

test('Counter: reset clears all series', () => {
  const c = new Counter('x');
  c.inc(5, { kind: 'a' });
  c.inc(3, { kind: 'b' });
  c.reset();
  assert.equal(c.snapshot().series.length, 0);
});

// --- Histogram --------------------------------------------------------

test('Histogram: defaults to OTEL-style millisecond buckets', () => {
  const h = new Histogram('latency');
  assert.deepEqual(h.buckets, DEFAULT_HISTOGRAM_BUCKETS_MS);
});

test('Histogram: record() updates count + sum + cumulative buckets', () => {
  const h = new Histogram('latency', { buckets: [10, 50, 100] });
  h.record(5);
  h.record(40);
  h.record(150); // overflow
  const snap = h.snapshot();
  assert.equal(snap.series.length, 1);
  const s = snap.series[0]!;
  assert.equal(s.count, 3);
  assert.equal(s.sum, 5 + 40 + 150);
  // Cumulative buckets:  [<=10, <=50, <=100, <=Inf]
  // 5 → bumps all four
  // 40 → bumps the last three (>=10? no, 40>10 → bump <=50 and onwards)
  // Wait, the contract is "value <= threshold". So 5 fits <=10, 40 fits <=50,
  // 150 fits +Inf only.
  // Final cumulative counts:
  //   <=10  → 1
  //   <=50  → 2
  //   <=100 → 2
  //   +Inf  → 3
  assert.deepEqual(s.bucketCounts, [1, 2, 2, 3]);
});

test('Histogram: ignores non-finite samples', () => {
  const h = new Histogram('x', { buckets: [10] });
  h.record(NaN);
  h.record(Infinity);
  h.record(-Infinity);
  const snap = h.snapshot();
  assert.equal(snap.series.length, 0);
});

test('Histogram: tags split into separate series', () => {
  const h = new Histogram('latency', { buckets: [10, 100] });
  h.record(5, { provider: 'openai' });
  h.record(50, { provider: 'openai' });
  h.record(5, { provider: 'anthropic' });
  const snap = h.snapshot();
  assert.equal(snap.series.length, 2);
});

test('Histogram: defensively sorts unsorted buckets', () => {
  const h = new Histogram('x', { buckets: [100, 10, 50] });
  assert.deepEqual([...h.buckets], [10, 50, 100]);
  h.record(5);
  // 5 fits <=10 → all 4 cumulative buckets get +1
  assert.deepEqual(h.snapshot().series[0]?.bucketCounts, [1, 1, 1, 1]);
});

// --- Meter ------------------------------------------------------------

test('Meter: counter() and histogram() are name-keyed singletons', () => {
  const m = new Meter();
  const a = m.counter('foo');
  const b = m.counter('foo');
  assert.strictEqual(a, b);
  const h1 = m.histogram('bar');
  const h2 = m.histogram('bar');
  assert.strictEqual(h1, h2);
});

test('Meter: snapshotAll returns counters + histograms', () => {
  const m = new Meter();
  m.counter('a').inc(5);
  m.histogram('b').record(50);
  const snaps = m.snapshotAll();
  assert.equal(snaps.length, 2);
  const counter = snaps.find(s => s.kind === 'counter');
  const hist = snaps.find(s => s.kind === 'histogram');
  assert.ok(counter);
  assert.ok(hist);
});

test('Meter: reset clears all instruments without dropping registrations', () => {
  const m = new Meter();
  const c = m.counter('x');
  c.inc(5);
  m.reset();
  assert.equal(m.counter('x').snapshot().series.length, 0);
  // Same instance afterwards.
  assert.strictEqual(m.counter('x'), c);
});

test('getMeter: singleton survives across calls; _resetMeterForTests drops it', () => {
  _resetMeterForTests();
  const a = getMeter();
  const b = getMeter();
  assert.strictEqual(a, b);
  _resetMeterForTests();
  const c = getMeter();
  assert.notStrictEqual(a, c);
});

test('Reserved metric name constants are stable strings', () => {
  assert.equal(METRIC_AGENT_EXECUTE_COUNT, 'agent.execute.count');
  assert.equal(METRIC_LLM_COMPLETE_DURATION_MS, 'llm.complete.duration_ms');
});
