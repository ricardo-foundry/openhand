/**
 * Micro-benchmark: SSE ring-buffer write throughput.
 *
 * The task-stream bus is the hot path between agent-manager and the SSE
 * route. A single `publish()` enters the ring buffer and fans out to every
 * subscriber. We measure:
 *
 *   1. publish() with no subscribers (pure ring-buffer cost)
 *   2. publish() with 10 subscribers (fan-out cost)
 *   3. formatSseFrame() throughput (JSON encode cost)
 *
 * Expected order of magnitude on a modern laptop: millions of ops/s for (1)
 * and (3); tens/hundreds of thousands for (2).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import {
  TaskStreamBus,
  formatSseFrame,
  type TaskStreamEvent,
} from '../apps/server/src/task-stream';

function fmt(ops: number, nsPerOp: number): string {
  return `${ops.toLocaleString()} ops/s (${nsPerOp.toFixed(0)} ns/op)`;
}

function bench(label: string, iters: number, fn: () => void): { opsPerSec: number; nsPerOp: number } {
  for (let i = 0; i < Math.min(1000, iters); i++) fn();
  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const elapsedMs = performance.now() - start;
  const opsPerSec = Math.round((iters / elapsedMs) * 1000);
  const nsPerOp = (elapsedMs * 1_000_000) / iters;
  // eslint-disable-next-line no-console
  console.log(`    ${label}: ${fmt(opsPerSec, nsPerOp)}`);
  return { opsPerSec, nsPerOp };
}

test('TaskStreamBus.publish() with no subscribers', () => {
  const bus = new TaskStreamBus({ historyLimit: 1000 });
  const r = bench('publish() no subs', 50_000, () => {
    bus.publish({ taskId: 't1', status: 'running', message: 'ok' });
  });
  assert.ok(r.opsPerSec > 10_000, `too slow: ${r.opsPerSec} ops/s`);
});

test('TaskStreamBus.publish() with 10 subscribers', () => {
  const bus = new TaskStreamBus({ historyLimit: 1000 });
  let sink = 0;
  for (let i = 0; i < 10; i++) bus.subscribe('t1', () => { sink++; });
  const r = bench('publish() 10 subs', 20_000, () => {
    bus.publish({ taskId: 't1', status: 'running' });
  });
  assert.ok(sink > 0, 'subscribers ran');
  assert.ok(r.opsPerSec > 5_000, `too slow: ${r.opsPerSec} ops/s`);
});

test('formatSseFrame() throughput', () => {
  const evt: TaskStreamEvent = {
    id: 1,
    taskId: 'bench',
    timestamp: Date.now(),
    status: 'running',
    message: 'hello world',
    data: { step: 1, total: 10 },
  };
  const r = bench('formatSseFrame()', 100_000, () => {
    formatSseFrame(evt);
  });
  assert.ok(r.opsPerSec > 50_000, `too slow: ${r.opsPerSec} ops/s`);
});

test('TaskStreamBus ring-buffer eviction stays bounded', () => {
  const bus = new TaskStreamBus({ historyLimit: 100 });
  for (let i = 0; i < 10_000; i++) {
    bus.publish({ taskId: 'evict', status: 'running', message: `m${i}` });
  }
  const hist = bus.history('evict');
  assert.equal(hist.length, 100, 'history respects the limit');
});
