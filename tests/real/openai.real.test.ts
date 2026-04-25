/**
 * Real OpenAI smoke test.
 *
 * Runs against the public OpenAI Chat Completions endpoint *only* when
 * `OPENAI_API_KEY` is set. Otherwise the entire suite is skipped — this
 * file exists so a contributor or CI worker with a key can verify the
 * provider against the live wire format without dragging the rest of the
 * test grid through network calls.
 *
 * Trigger via `npm run test:real`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { OpenAIProvider } from '../../packages/llm/src/openai';

const HAS_KEY = typeof process.env.OPENAI_API_KEY === 'string' && process.env.OPENAI_API_KEY.length > 0;
const MODEL = process.env.OPENAI_REAL_MODEL ?? 'gpt-4o-mini';

test(
  'openai (real): returns JSON containing ok=true',
  { skip: HAS_KEY ? false : 'OPENAI_API_KEY not set — skipping live OpenAI smoke' },
  async () => {
    const provider = new OpenAIProvider({
      apiKey: process.env.OPENAI_API_KEY ?? '',
      timeoutMs: 30_000,
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
    // We don't insist on strict JSON.parse-ability — some chat models still
    // wrap with Markdown fences. We just want the literal token `ok` in the
    // response, which is enough to prove the round-trip worked.
    assert.match(res.content, /ok/i, `expected reply to mention "ok": ${res.content}`);
  },
);
