/**
 * Real Anthropic smoke test.
 *
 * Runs against the public `https://api.anthropic.com/v1/messages` endpoint
 * *only* when `ANTHROPIC_API_KEY` is set. Otherwise skipped.
 *
 * Trigger via `npm run test:real`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { AnthropicProvider } from '../../packages/llm/src/anthropic';

const HAS_KEY = typeof process.env.ANTHROPIC_API_KEY === 'string' && process.env.ANTHROPIC_API_KEY.length > 0;
const MODEL = process.env.ANTHROPIC_REAL_MODEL ?? 'claude-3-5-haiku-latest';

test(
  'anthropic (real): returns JSON containing ok=true',
  { skip: HAS_KEY ? false : 'ANTHROPIC_API_KEY not set — skipping live Anthropic smoke' },
  async () => {
    const provider = new AnthropicProvider({
      apiKey: process.env.ANTHROPIC_API_KEY ?? '',
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
      maxTokens: 64,
    });
    assert.equal(typeof res.content, 'string');
    assert.match(res.content, /ok/i, `expected reply to mention "ok": ${res.content}`);
  },
);
