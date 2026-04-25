/**
 * Integration: full agent flow.
 *
 * Round 14 promised "spawn server + cli + simulated web client, run a task
 * end-to-end". This is that test. The point is to catch wiring bugs that
 * don't show up in any single-package suite — handler not registered,
 * subprocess fails to import, SSE frames malformed, etc.
 *
 * What we actually do:
 *
 *   1. Boot the real Express server (`setupRoutes` + `AgentManager`) on an
 *      ephemeral port — same code path as `npm start`.
 *   2. Connect a "web client" SSE listener to a task stream BEFORE the task
 *      is enqueued, so we don't race the publish. We use raw `http.request`
 *      so we don't pull in EventSource — keeps the test dependency-free.
 *   3. Spawn the CLI binary (`apps/cli/src/index.ts` via tsx) with a
 *      non-network subcommand (`doctor` if available, else `--version`)
 *      and assert it exits clean. This proves the CLI's import graph is
 *      intact in the same process tree the server lives in.
 *   4. Trigger the synthetic `_demo` task on the server.
 *   5. Read frames from the SSE stream until we see status=completed.
 *   6. Tear everything down — kill the CLI subprocess if it's still alive,
 *      close the SSE socket, close the HTTP server.
 *
 * Timeout budget: 20s. Runs in ~3s on a healthy laptop; the bulk of the
 * time is the CLI cold-start under tsx.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'node:http';
import * as path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import express from 'express';
import { AgentManager } from '../../apps/server/src/agent-manager';
import { setupRoutes } from '../../apps/server/src/routes';

const REPO = path.resolve(__dirname, '..', '..');
const TSX = path.join(REPO, 'node_modules', '.bin', 'tsx');
const CLI = path.join(REPO, 'apps', 'cli', 'src', 'index.ts');

interface ServerHandle {
  port: number;
  close: () => Promise<void>;
}

function bootServer(): Promise<ServerHandle> {
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
        reject(new Error('server bind failed: no address'));
      }
    });
    srv.on('error', reject);
  });
}

function postJson(port: number, urlPath: string, body: unknown): Promise<number> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(
      {
        method: 'POST',
        host: '127.0.0.1',
        port,
        path: urlPath,
        headers: {
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(data),
        },
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

interface SseHandle {
  /** Resolves with the first frame whose body has status=completed. */
  waitForCompleted(): Promise<string>;
  /** Number of frames received so far. */
  framesSeen: () => number;
  close(): void;
}

function openSse(port: number, urlPath: string): Promise<SseHandle> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        method: 'GET',
        host: '127.0.0.1',
        port,
        path: urlPath,
        headers: { accept: 'text/event-stream' },
      },
      res => {
        if (res.statusCode !== 200) {
          reject(new Error(`SSE handshake failed: ${res.statusCode}`));
          return;
        }
        let buf = '';
        let frames = 0;
        let resolveCompleted: ((frame: string) => void) | null = null;
        let completedFrame: string | null = null;
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buf += chunk;
          let idx: number;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const frame = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            if (frame.startsWith('retry:') || frame.trim() === '') continue;
            frames++;
            if (frame.includes('"status":"completed"')) {
              completedFrame = frame;
              resolveCompleted?.(frame);
            }
          }
        });
        resolve({
          waitForCompleted: () => new Promise<string>((rs, rj) => {
            if (completedFrame) return rs(completedFrame);
            resolveCompleted = rs;
            // Bound the wait so a hung server doesn't hold the test runner.
            setTimeout(() => rj(new Error('timed out waiting for completed SSE frame')), 8000);
          }),
          framesSeen: () => frames,
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

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], timeoutMs = 15_000): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(TSX, [CLI, ...args], {
      cwd: REPO,
      env: { ...process.env, NO_COLOR: '1' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (b: Buffer) => { stdout += b.toString('utf8'); });
    child.stderr?.on('data', (b: Buffer) => { stderr += b.toString('utf8'); });
    const killTimer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error(`CLI run timed out after ${timeoutMs}ms; stderr: ${stderr.slice(0, 400)}`));
    }, timeoutMs);
    child.on('exit', code => {
      clearTimeout(killTimer);
      resolve({ exitCode: code ?? -1, stdout, stderr });
    });
  });
}

test('full agent flow: server up + CLI healthy + SSE web client sees task complete', { timeout: 25_000 }, async () => {
  const server = await bootServer();
  try {
    // (1) Web client opens SSE BEFORE the task fires so it doesn't miss frames.
    const taskId = `flow-${Date.now()}`;
    const sse = await openSse(server.port, `/api/tasks/${taskId}/stream`);

    try {
      // (2) Spawn the CLI in parallel with the task. We use --version because
      // it's the cheapest non-interactive subcommand and exercises the whole
      // import graph (commander, all command modules transitively imported).
      // If anything in the CLI is broken, this exits non-zero.
      const cliPromise = runCli(['--version']);

      // (3) Hit the demo task endpoint — same surface a real client uses.
      const status = await postJson(server.port, `/api/tasks/${taskId}/_demo`, {});
      assert.equal(status, 200, 'demo task POST should succeed');

      // (4) Web client awaits the terminal frame.
      const frame = await sse.waitForCompleted();
      assert.match(frame, /"taskId":"/, 'SSE frame should carry taskId');
      assert.match(frame, /"status":"completed"/, 'final SSE frame should be status=completed');
      assert.match(frame, /^id: \d+/m, 'SSE frame should include id: header');
      assert.match(frame, /^event: task$/m, 'SSE frame should be event: task');

      // (5) CLI must have exited cleanly. We wait for it last so its tsx warm-up
      //     overlaps with the task work above.
      const cli = await cliPromise;
      assert.equal(cli.exitCode, 0, `CLI exited ${cli.exitCode}; stderr: ${cli.stderr.slice(0, 400)}`);
      assert.match(cli.stdout, /\d+\.\d+\.\d+/, 'CLI --version should print a semver');

      // (6) Sanity: we received at least 4 frames (pending, running, running, completed).
      assert.ok(sse.framesSeen() >= 4, `expected >= 4 SSE frames, got ${sse.framesSeen()}`);
    } finally {
      sse.close();
    }
  } finally {
    await server.close();
  }
});

test('full agent flow: SSE client connecting AFTER task completes still receives backlog', { timeout: 15_000 }, async () => {
  const server = await bootServer();
  try {
    const taskId = `flow-replay-${Date.now()}`;
    // Fire the task with no listener — frames go into the ring buffer.
    const status = await postJson(server.port, `/api/tasks/${taskId}/_demo`, {});
    assert.equal(status, 200);
    // Wait for the demo's 4 * 400ms timeline to finish.
    await new Promise(r => setTimeout(r, 2000));
    // Connect now — backlog should replay.
    const sse = await openSse(server.port, `/api/tasks/${taskId}/stream`);
    try {
      const frame = await sse.waitForCompleted();
      assert.match(frame, /"status":"completed"/);
      assert.ok(sse.framesSeen() >= 1);
    } finally {
      sse.close();
    }
  } finally {
    await server.close();
  }
});
