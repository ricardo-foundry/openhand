import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TaskStreamBus, formatSseFrame } from '../src/task-stream';

test('publish records history and stamps id + timestamp', () => {
  const bus = new TaskStreamBus();
  const a = bus.publish({ taskId: 't1', status: 'pending', message: 'queued' });
  const b = bus.publish({ taskId: 't1', status: 'running', message: 'started' });
  assert.equal(a.id, 0);
  assert.equal(b.id, 1);
  assert.ok(a.timestamp > 0);
  const hist = bus.history('t1');
  assert.equal(hist.length, 2);
  assert.equal(hist[0]!.status, 'pending');
  assert.equal(hist[1]!.status, 'running');
});

test('subscribe only delivers future events, not backlog', () => {
  const bus = new TaskStreamBus();
  bus.publish({ taskId: 't1', status: 'pending' });
  const seen: string[] = [];
  bus.subscribe('t1', e => seen.push(e.status));
  bus.publish({ taskId: 't1', status: 'running' });
  bus.publish({ taskId: 't1', status: 'completed' });
  assert.deepEqual(seen, ['running', 'completed']);
});

test('subscribe is scoped to a single task id', () => {
  const bus = new TaskStreamBus();
  const seen: string[] = [];
  bus.subscribe('t1', e => seen.push(e.taskId));
  bus.publish({ taskId: 't2', status: 'running' });
  bus.publish({ taskId: 't1', status: 'running' });
  assert.deepEqual(seen, ['t1']);
});

test('history respects sinceId for resume', () => {
  const bus = new TaskStreamBus();
  bus.publish({ taskId: 't1', status: 'pending' });
  bus.publish({ taskId: 't1', status: 'running' });
  bus.publish({ taskId: 't1', status: 'completed' });
  const later = bus.history('t1', 0);
  assert.equal(later.length, 2);
  assert.equal(later[0]!.status, 'running');
});

test('history respects historyLimit ring size', () => {
  const bus = new TaskStreamBus({ historyLimit: 2 });
  for (let i = 0; i < 5; i++) {
    bus.publish({ taskId: 't1', status: 'running', message: `step ${i}` });
  }
  const hist = bus.history('t1');
  assert.equal(hist.length, 2);
  assert.equal(hist[0]!.message, 'step 3');
  assert.equal(hist[1]!.message, 'step 4');
});

test('forget drops task state', () => {
  const bus = new TaskStreamBus();
  bus.publish({ taskId: 't1', status: 'running' });
  assert.equal(bus.statusOf('t1'), 'running');
  bus.forget('t1');
  assert.equal(bus.statusOf('t1'), undefined);
  assert.equal(bus.history('t1').length, 0);
});

test('formatSseFrame builds a spec-compliant `id/event/data` frame', () => {
  const frame = formatSseFrame({
    id: 3,
    taskId: 't1',
    timestamp: 1700000000000,
    status: 'running',
    message: 'hi',
  });
  assert.match(frame, /^id: 3\n/);
  assert.match(frame, /event: task\n/);
  assert.match(frame, /data: .+\n\n$/);
  // Data line is valid JSON.
  const dataLine = frame.split('\n').find(l => l.startsWith('data:'))!;
  const json = JSON.parse(dataLine.slice('data: '.length));
  assert.equal(json.status, 'running');
});
