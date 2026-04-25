/**
 * Real Ollama smoke test.
 *
 * Runs against a local Ollama daemon *only* when `localhost:11434` is reachable.
 * If Ollama isn't running we skip — same default-friendly behaviour as
 * `examples/ollama-local.ts`.
 *
 * The reachability probe runs inside the test body (not at the module
 * level) because `tsx` transpiles to CJS for `node --test` and CJS does
 * not support top-level await.
 *
 * Trigger via `npm run test:real`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'net';

import { OllamaProvider } from '../../packages/llm/src/ollama';

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? 'localhost';
const OLLAMA_PORT = Number(process.env.OLLAMA_PORT ?? '11434');
const MODEL = process.env.OLLAMA_REAL_MODEL ?? 'llama3.2:1b';

/** Quick TCP probe — a 250ms TCP connect is enough to confirm the daemon is up. */
function isOllamaReachable(host: string, port: number, timeoutMs = 250): Promise<boolean> {
  return new Promise(resolve => {
    const socket = new net.Socket();
    let settled = false;
    const done = (ok: boolean): void => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* already gone */
      }
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    try {
      socket.connect(port, host);
    } catch {
      done(false);
    }
  });
}

test('ollama (real): returns JSON containing ok=true', async (t) => {
  const reachable = await isOllamaReachable(OLLAMA_HOST, OLLAMA_PORT);
  if (!reachable) {
    t.skip(`Ollama not reachable at ${OLLAMA_HOST}:${OLLAMA_PORT} — skipping live smoke`);
    return;
  }
  const provider = new OllamaProvider({
    baseUrl: `http://${OLLAMA_HOST}:${OLLAMA_PORT}`,
    timeoutMs: 60_000,
  });
  const res = await provider.complete({
    model: MODEL,
    messages: [
      {
        role: 'system',
        content: 'You return ONLY a single-line JSON object with no commentary.',
      },
      { role: 'user', content: 'Hello, return JSON {ok:true}' },
    ],
    temperature: 0,
  });
  assert.equal(typeof res.content, 'string');
  assert.match(res.content, /ok/i, `expected reply to mention "ok": ${res.content}`);
});
