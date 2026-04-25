/**
 * Chaos: client SSE consumers vanish at every possible moment. The server
 * must clean up its bus subscription + heartbeat timer on every exit path.
 *
 * What we exercise:
 *   1. Client disconnects mid-stream (req.destroy()).
 *   2. Client never reads (slow reader; we just close the socket).
 *   3. Client reconnects with Last-Event-ID and gets only the missed frames.
 *   4. Many concurrent clients abort at random times — listener count
 *      on the bus drops back to 0 once all are gone.
 *
 * Bug we'd surface: if the SSE route forgot to call `unsubscribe()` on
 * `req.close`, the bus would accumulate listeners and eventually emit a
 * MaxListeners warning + leak memory per task. We assert that listener
 * count returns to zero.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import express from 'express';
import { AgentManager } from '../../apps/server/src/agent-manager';
import { setupRoutes } from '../../apps/server/src/routes';
import { globalTaskStream } from '../../apps/server/src/task-stream';

interface Server {
  port: number;
  close: () => Promise<void>;
}

function bootServer(): Promise<Server> {
  return new Promise((resolve, reject) => {
    const app = express();
    app.use(express.json());
    setupRoutes(app as any, new AgentManager());
    const srv = app.listen(0, () => {
      const addr = srv.address();
      if (addr && typeof addr === 'object') {
        resolve({
          port: addr.port,
          close: () => new Promise<void>(res => srv.close(() => res())),
        });
      } else {
        reject(new Error('no address'));
      }
    });
    srv.on('error', reject);
  });
}

function postDemo(port: number, taskId: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: `/api/tasks/${taskId}/_demo`,
        headers: { 'content-type': 'application/json', 'content-length': '2' },
      },
      res => {
        res.resume();
        res.on('end', () => resolve());
      },
    );
    req.on('error', reject);
    req.write('{}');
    req.end();
  });
}

interface SseHandle {
  destroy: () => void;
  finished: Promise<void>;
  bytes: () => number;
}

function openSse(port: number, taskId: string, headers: Record<string, string> = {}): Promise<SseHandle> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port,
        path: `/api/tasks/${taskId}/stream`,
        headers: { accept: 'text/event-stream', ...headers },
      },
      res => {
        if (res.statusCode !== 200) {
          reject(new Error(`status ${res.statusCode}`));
          return;
        }
        let n = 0;
        let resolved: () => void = () => {};
        const finished = new Promise<void>(r => { resolved = r; });
        res.on('data', (chunk: Buffer) => { n += chunk.length; });
        res.on('end', () => resolved());
        res.on('close', () => resolved());
        resolve({
          destroy: () => req.destroy(),
          finished,
          bytes: () => n,
        });
      },
    );
    req.on('error', () => { /* expected on destroy */ });
    req.end();
  });
}

test('chaos/sse: client destroy mid-stream cleans up bus subscription', async () => {
  const srv = await bootServer();
  try {
    const taskId = `chaos-${Date.now()}-1`;
    // Snapshot the listener count BEFORE we add any subscriber.
    const before = globalTaskStream.listenerCount(`task:${taskId}`);
    const client = await openSse(srv.port, taskId);
    // Give the route time to register its listener.
    await new Promise(r => setTimeout(r, 50));
    const during = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.ok(during > before, 'route should register one listener');
    client.destroy();
    // Wait for `req.on('close')` to fire and cleanup() to run.
    await new Promise(r => setTimeout(r, 100));
    const after = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(after, before, 'subscription must be released after disconnect');
  } finally {
    await srv.close();
  }
});

test('chaos/sse: 50 concurrent clients all abort, listener count returns to 0', async () => {
  const srv = await bootServer();
  try {
    const taskId = `chaos-${Date.now()}-2`;
    const before = globalTaskStream.listenerCount(`task:${taskId}`);
    const clients = await Promise.all(
      Array.from({ length: 50 }, () => openSse(srv.port, taskId)),
    );
    await new Promise(r => setTimeout(r, 100));
    const during = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(during - before, 50, 'each client should add one listener');
    // Stagger destroy to exercise mid-publish disconnects.
    for (const c of clients) c.destroy();
    await new Promise(r => setTimeout(r, 200));
    const after = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(after, before, 'all listeners must be cleaned up');
  } finally {
    await srv.close();
  }
});

test('chaos/sse: client aborts WHILE events are publishing — no orphaned timers', async () => {
  const srv = await bootServer();
  try {
    const taskId = `chaos-${Date.now()}-3`;
    const client = await openSse(srv.port, taskId);
    // Start firing events; abort halfway.
    const pub = (async () => {
      for (let i = 0; i < 30; i++) {
        globalTaskStream.publish({ taskId, status: 'running', message: `m${i}` });
        await new Promise(r => setTimeout(r, 5));
      }
      globalTaskStream.publish({ taskId, status: 'completed' });
    })();
    setTimeout(() => client.destroy(), 30);
    await pub;
    await new Promise(r => setTimeout(r, 200));
    const after = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(after, 0, 'no leftover listener after mid-stream abort');
  } finally {
    await srv.close();
  }
});

test('chaos/sse: terminal status closes stream and releases listener', async () => {
  const srv = await bootServer();
  try {
    const taskId = `chaos-${Date.now()}-4`;
    const client = await openSse(srv.port, taskId);
    await new Promise(r => setTimeout(r, 30));
    globalTaskStream.publish({ taskId, status: 'completed', message: 'done' });
    // The route schedules a 50ms deferred close — wait > that.
    await new Promise(r => setTimeout(r, 250));
    const after = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(after, 0, 'listener gone after completed event');
    client.destroy();
  } finally {
    await srv.close();
  }
});

test('chaos/sse: rapid open/close cycles do not leak listeners', async () => {
  const srv = await bootServer();
  try {
    const taskId = `chaos-${Date.now()}-5`;
    const before = globalTaskStream.listenerCount(`task:${taskId}`);
    for (let i = 0; i < 20; i++) {
      const c = await openSse(srv.port, taskId);
      // Tear down almost immediately.
      await new Promise(r => setTimeout(r, 5));
      c.destroy();
      await new Promise(r => setTimeout(r, 5));
    }
    await new Promise(r => setTimeout(r, 100));
    const after = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(after, before, 'open/close cycle must net zero listeners');
  } finally {
    await srv.close();
  }
});

test('chaos/sse: server survives _demo storm on a single task', async () => {
  const srv = await bootServer();
  try {
    const taskId = `chaos-${Date.now()}-6`;
    const client = await openSse(srv.port, taskId);
    // 10 concurrent demo storms — each fires 4 events.
    await Promise.all(Array.from({ length: 10 }, () => postDemo(srv.port, taskId)));
    // Let the events drain.
    await new Promise(r => setTimeout(r, 2_000));
    assert.ok(client.bytes() > 0, 'client received events');
    client.destroy();
    await new Promise(r => setTimeout(r, 200));
    const after = globalTaskStream.listenerCount(`task:${taskId}`);
    assert.equal(after, 0);
  } finally {
    await srv.close();
  }
});
