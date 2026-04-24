/**
 * Mini agent loop: chat -> decide -> exec -> observe.
 *
 * Runs entirely offline with MockProvider by default, so it doubles as a
 * smoke test of the full pipeline — no API key, no network, no Docker.
 *
 * The "decide" step is a tiny deterministic planner: we scan the LLM reply
 * for lines shaped like
 *
 *     SHELL: <cmd> <args...>
 *
 * and run each through `SecureSandbox.execute`. Any output comes back as an
 * "observation" message the next turn sees. That's enough to demonstrate the
 * four building blocks without hiding them behind a framework.
 *
 * Run:
 *   npx tsx examples/agent-shell-loop.ts
 *
 *   LLM_PROVIDER=openai OPENAI_API_KEY=sk-... npx tsx examples/agent-shell-loop.ts
 */
import { LLMClient, MockProvider, resolveProvider, type LLMProvider } from '../packages/llm/src/index';
import { SecureSandbox } from '../packages/sandbox/src/index';
import * as path from 'path';

function pickProvider(): LLMProvider {
  const explicit = process.env.LLM_PROVIDER?.toLowerCase();
  if (!explicit || explicit === 'mock') {
    // Canned replies cycle through the queue; after the last one the mock
    // loops back, which is fine for a demo.
    return new MockProvider({
      replies: [
        'Let me check the repo layout first.\nSHELL: ls -la',
        'Now let me peek at the README title.\nSHELL: head -n 1 README.md',
        "Looks good. I'm done.",
      ],
      latencyMs: 30,
    });
  }
  return resolveProvider();
}

interface Turn {
  role: 'system' | 'user' | 'assistant' | 'observation';
  content: string;
}

function parseShellLines(text: string): string[] {
  // Simple line-based parser. Each `SHELL:` line becomes one tool call.
  return text
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.toUpperCase().startsWith('SHELL:'))
    .map(l => l.slice('SHELL:'.length).trim())
    .filter(Boolean);
}

async function runShellLine(
  sandbox: SecureSandbox,
  line: string,
): Promise<{ ok: boolean; out: string }> {
  const parts = line.match(/"[^"]*"|\S+/g) ?? [];
  if (parts.length === 0) return { ok: false, out: 'empty shell line' };
  const cmd = parts[0]!.replace(/^"|"$/g, '');
  const args = parts.slice(1).map(a => a.replace(/^"|"$/g, ''));
  const r = await sandbox.execute(cmd, args);
  return {
    ok: r.success,
    out: (r.success ? r.output : r.error ?? 'no error message').trim().slice(0, 500),
  };
}

async function main(): Promise<void> {
  const provider = pickProvider();
  const client = new LLMClient({ provider, timeoutMs: 30_000 });
  const model = process.env.LLM_MODEL ?? 'mock-1';

  const sandbox = new SecureSandbox({
    timeout: 5_000,
    memoryLimit: 128,
    allowedPaths: [process.cwd()],
    // Keep the allow-list small for the demo; SecureSandbox default
    // deliberately excludes shells and code-eval flags.
  });

  console.log(`[demo] provider=${provider.info.label}, model=${model}`);
  console.log(`[demo] policy=${JSON.stringify(sandbox.getPolicy(), null, 0)}`);

  const transcript: Turn[] = [
    {
      role: 'system',
      content:
        'You are an agent that may emit SHELL: <cmd> lines to inspect the ' +
        'working directory. Use allow-listed commands only (ls, head, cat, grep, …).',
    },
    {
      role: 'user',
      content: `Summarize this repository at ${path.basename(process.cwd())}.`,
    },
  ];

  const MAX_TURNS = 3;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.complete({
      model,
      messages: transcript.map(t => ({
        role: t.role === 'observation' ? 'user' : t.role,
        content: t.role === 'observation' ? `[observation]\n${t.content}` : t.content,
      })),
      maxTokens: 200,
      temperature: 0.3,
    });

    const reply = res.content.trim();
    console.log(`\n[turn ${turn + 1}] assistant:\n  ${reply.split('\n').join('\n  ')}`);
    transcript.push({ role: 'assistant', content: reply });

    const shellLines = parseShellLines(reply);
    if (shellLines.length === 0) {
      console.log('[turn] no SHELL: lines emitted, agent done.');
      break;
    }

    for (const line of shellLines) {
      const r = await runShellLine(sandbox, line);
      console.log(`[exec] ${line}  ->  ${r.ok ? 'ok' : 'denied'}`);
      transcript.push({
        role: 'observation',
        content: `$ ${line}\n${r.out || '(empty)'}`,
      });
    }
  }

  console.log(`\n[demo] loop finished after ${transcript.length} turns`);
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});
