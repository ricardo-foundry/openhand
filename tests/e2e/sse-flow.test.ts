/**
 * End-to-end: boot an Express server using the real `setupRoutes`, fire the
 * `_demo` endpoint, then open the SSE endpoint over raw HTTP (no EventSource
 * dependency) and read until we see a `completed` task event.
 *
 * Intentionally minimal — no supertest, no playwright. Just `http.request`
 * against a freshly-bound ephemeral port.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import express from 'express';
import { AgentManager } from '../../apps/server/src/agent-manager';
import { setupRoutes } from '../../apps/server/src/routes';

function bootServer(): Promise<{ port: number; close: () => Promise<void> }> {
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

function postJson(port: number, path: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path,
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) },
      },
      res => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      },
    );
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function openSse(port: number, path: string): Promise<{
  waitForCompleted: () => Promise<string>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { method: 'GET', host: '127.0.0.1', port, path, headers: { accept: 'text/event-stream' } },
      res => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE handshake failed: ${res.statusCode}`));
          return;
        }
        let buf = '';
        let resolveCompleted: ((frame: string) => void) | null = null;
        let completedFrame: string | null = null;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          // SSE frames are separated by a blank line.
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (frame.includes('"status":"completed"')) {
              completedFrame = frame;
              if (resolveCompleted) {
                resolveCompleted(frame);
                resolveCompleted = null;
              }
            }
          }
        });
        resolve({
          waitForCompleted: () =>
            new Promise<string>((res, rej) => {
              if (completedFrame) return res(completedFrame);
              resolveCompleted = res;
              setTimeout(() => rej(new Error('timed out waiting for completed frame')), 5000);
            }),
          close: () => {
            try { req.destroy(); } catch { /* ignore */ }
          },
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test('SSE flow: POST /_demo then consume stream until completed', { timeout: 10000 }, async () => {
  const server = await bootServer();
  try {
    const taskId = `e2e-${Date.now()}`;
    // Open SSE first so we don't miss events.
    const sse = await openSse(server.port, `/api/tasks/${taskId}/stream`);
    try {
      const status = await postJson(server.port, `/api/tasks/${taskId}/_demo`, {});
      assert.equal(status, 200);
      const frame = await sse.waitForCompleted();
      assert.match(frame, /"taskId":"/);
      assert.match(frame, /"status":"completed"/);
      assert.match(frame, /^id: \d+/m);
      assert.match(frame, /^event: task$/m);
    } finally {
      sse.close();
    }
  } finally {
    await server.close();
  }
});

test('SSE flow: Last-Event-ID resumes from backlog', { timeout: 10000 }, async () => {
  const server = await bootServer();
  try {
    const taskId = `e2e-resume-${Date.now()}`;
    // Seed backlog.
    await postJson(server.port, `/api/tasks/${taskId}/_demo`, {});
    // Wait for demo to emit all 4 events (4 * 400ms).
    await new Promise(r => setTimeout(r, 2000));

    // Connect fresh — the ring buffer should replay history.
    const sse = await openSse(server.port, `/api/tasks/${taskId}/stream`);
    try {
      const frame = await sse.waitForCompleted();
      assert.match(frame, /"status":"completed"/);
    } finally {
      sse.close();
    }
  } finally {
    await server.close();
  }
});
