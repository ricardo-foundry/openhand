import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  Tracer,
  exporterFromEnv,
  fileExporter,
  stdoutExporter,
  getTracer,
  _resetTracerForTests,
  type Exporter,
  type FinishedSpan,
  SPAN_AGENT_EXECUTE,
  SPAN_TOOL_INVOKE,
  SPAN_LLM_COMPLETE,
  SPAN_PLUGIN_LOAD,
} from '../src/telemetry';

function collectingExporter(): { exporter: Exporter; spans: FinishedSpan[] } {
  const spans: FinishedSpan[] = [];
  return {
    exporter: { export: (s) => { spans.push(s); } },
    spans,
  };
}

test('tracer.start() exports a finished span with status=ok and a positive duration', async () => {
  const tracer = new Tracer();
  const { exporter, spans } = collectingExporter();
  tracer.setExporter(exporter);

  const span = tracer.start('agent.execute', { 'session.id': 's1' });
  span.setAttribute('iteration', 3);
  await new Promise(r => setTimeout(r, 5));
  span.end();

  assert.equal(spans.length, 1);
  const s = spans[0]!;
  assert.equal(s.name, 'agent.execute');
  assert.equal(s.kind, 'agent');
  assert.equal(s.status, 'ok');
  assert.equal(s.parentSpanId, null);
  assert.equal(s.attributes['session.id'], 's1');
  assert.equal(s.attributes['iteration'], 3);
  assert.ok(s.durationMs >= 0);
  assert.equal(s.error, undefined);
  assert.match(s.traceId, /^[0-9a-f]{16}$/);
  assert.match(s.spanId, /^[0-9a-f]{16}$/);
});

test('nested spans share traceId and link parentSpanId implicitly', () => {
  const tracer = new Tracer();
  const { exporter, spans } = collectingExporter();
  tracer.setExporter(exporter);

  const outer = tracer.start('agent.execute');
  const inner = tracer.start('tool.invoke');
  inner.end();
  outer.end();

  assert.equal(spans.length, 2);
  // child finishes first → exported first
  const child = spans[0]!;
  const parent = spans[1]!;
  assert.equal(child.name, 'tool.invoke');
  assert.equal(parent.name, 'agent.execute');
  assert.equal(child.traceId, parent.traceId);
  assert.equal(child.parentSpanId, parent.spanId);
  assert.equal(parent.parentSpanId, null);
});

test('recordError flips status to error and attaches the message', () => {
  const tracer = new Tracer();
  const { exporter, spans } = collectingExporter();
  tracer.setExporter(exporter);

  const span = tracer.start('llm.complete');
  span.recordError(new Error('rate limited'));
  span.end();

  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.status, 'error');
  assert.equal(spans[0]!.error?.message, 'rate limited');
});

test('end() is idempotent — calling twice does not double-export', () => {
  const tracer = new Tracer();
  const { exporter, spans } = collectingExporter();
  tracer.setExporter(exporter);

  const span = tracer.start('plugin.load');
  span.end();
  span.end();
  span.end('error'); // no-op once ended

  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.status, 'ok');
});

test('withSpan() ends the span on success and propagates errors with status=error', async () => {
  const tracer = new Tracer();
  const { exporter, spans } = collectingExporter();
  tracer.setExporter(exporter);

  const ok = await tracer.withSpan('tool.invoke', async () => 42, { tool: 'calc_eval' });
  assert.equal(ok, 42);

  await assert.rejects(
    tracer.withSpan('tool.invoke', async () => { throw new Error('boom'); }),
    /boom/,
  );

  assert.equal(spans.length, 2);
  assert.equal(spans[0]!.status, 'ok');
  assert.equal(spans[0]!.attributes['tool'], 'calc_eval');
  assert.equal(spans[1]!.status, 'error');
  assert.equal(spans[1]!.error?.message, 'boom');
});

test('exporterFromEnv parses stdout/file/noop/unknown deterministically', () => {
  // stdout
  const a = exporterFromEnv('stdout');
  assert.equal(typeof a.export, 'function');

  // file:<path>
  const tmp = path.join(os.tmpdir(), `openhand-tel-${Date.now()}.jsonl`);
  const b = exporterFromEnv(`file:${tmp}`);
  assert.equal(typeof b.export, 'function');

  // unknown / unset → noop (no-op export, no throw)
  const c = exporterFromEnv(undefined);
  c.export({
    traceId: '00', spanId: '01', parentSpanId: null,
    name: 'x', kind: 'x', startTime: 0, endTime: 0, durationMs: 0,
    status: 'ok', attributes: {},
  });

  const d = exporterFromEnv('lol-not-real');
  d.export({
    traceId: '00', spanId: '01', parentSpanId: null,
    name: 'x', kind: 'x', startTime: 0, endTime: 0, durationMs: 0,
    status: 'ok', attributes: {},
  });

  // file:<empty> → noop
  const e = exporterFromEnv('file:');
  assert.equal(typeof e.export, 'function');
});

test('fileExporter writes one JSON line per span and survives flush()', async () => {
  const tmp = path.join(os.tmpdir(), `openhand-tel-${Date.now()}-${Math.random()}.jsonl`);
  const exporter = fileExporter(tmp);
  const tracer = new Tracer();
  tracer.setExporter(exporter);

  tracer.start('plugin.load', { id: 'calc' }).end();
  tracer.start('plugin.load', { id: 'rss' }).end('error');
  if (exporter.flush) await exporter.flush();

  const body = fs.readFileSync(tmp, 'utf-8');
  const lines = body.trim().split('\n').filter(Boolean);
  assert.equal(lines.length, 2);
  const first = JSON.parse(lines[0]!);
  const second = JSON.parse(lines[1]!);
  assert.equal(first.name, 'plugin.load');
  assert.equal(first.attributes.id, 'calc');
  assert.equal(first.status, 'ok');
  assert.equal(second.status, 'error');
  fs.unlinkSync(tmp);
});

test('reserved span name constants are stable strings', () => {
  assert.equal(SPAN_AGENT_EXECUTE, 'agent.execute');
  assert.equal(SPAN_TOOL_INVOKE, 'tool.invoke');
  assert.equal(SPAN_LLM_COMPLETE, 'llm.complete');
  assert.equal(SPAN_PLUGIN_LOAD, 'plugin.load');
});

test('singleton getTracer() respects setExporter() after reset', () => {
  _resetTracerForTests();
  const tracer = getTracer();
  const { exporter, spans } = collectingExporter();
  tracer.setExporter(exporter);
  tracer.start('custom.thing').end();
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.kind, 'custom');
  _resetTracerForTests();
});

test('stdoutExporter is a real exporter (smoke; we do not capture stdout here)', () => {
  const exp = stdoutExporter();
  assert.equal(typeof exp.export, 'function');
  // We do not actually write — just confirm the shape.
});
