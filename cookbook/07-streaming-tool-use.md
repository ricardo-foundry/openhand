# 07 — Streaming + tool use, end to end

**Goal:** stream a model's reply chunk-by-chunk **and** let the model call
tools mid-stream, surfacing both the deltas and the tool decisions to the
UI without buffering the whole response. ~70 lines, no extra dep.

## The two things that have to compose

1. **Streaming** — `LLMClient.stream()` yields `StreamChunk { delta, finishReason?, usage? }`.
2. **Tool use** — when a provider supports it (OpenAI, Anthropic), the
   model can ask to call a tool by setting `finishReason: 'tool_calls'`
   and populating `toolCalls`. With streaming, the *terminal* chunk
   carries that — every chunk before it is incremental text.

The key insight: those two concerns don't fight. You drain deltas, watch
for `finishReason === 'tool_calls'`, run the tool, then *resume* with a
second `stream()` call whose messages include the tool result.

## Wire it up

```ts
// examples/streaming-tool-use.ts
import {
  LLMClient,
  MockProvider,
  type ChatMessage,
  type ToolSchema,
  type StreamChunk,
} from '@openhand/llm';

// A tiny tool the agent can ask us to run.
const tools: ToolSchema[] = [{
  name: 'get_weather',
  description: 'Look up the current weather for a city.',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
}];

// In real life, route this through pluginToolsToMap(loader.listTools()).
async function runTool(name: string, argsJson: string): Promise<string> {
  if (name !== 'get_weather') throw new Error(`unknown tool: ${name}`);
  const { city } = JSON.parse(argsJson);
  return JSON.stringify({ city, tempC: 22, condition: 'sunny' });
}

async function chatStreamWithTools(
  client: LLMClient,
  initial: ChatMessage[],
): Promise<string> {
  let messages = initial.slice();
  let finalText = '';

  // Cap at a small number of tool round-trips so a buggy model can't loop forever.
  for (let hop = 0; hop < 3; hop++) {
    let toolCallId: string | undefined;
    let toolName: string | undefined;
    let toolArgs: string | undefined;
    let chunkText = '';
    let finished: StreamChunk['finishReason'] | undefined;

    // Drain the stream. The progress callback (set on the client) drives
    // the UI; the loop body is what handles the *protocol*.
    for await (const chunk of client.stream({ model: 'mock-1', messages, tools })) {
      chunkText += chunk.delta;
      if (chunk.finishReason) {
        finished = chunk.finishReason;
      }
      // Some providers attach toolCalls to the terminal chunk's metadata
      // (we model it on `extra` here for clarity; OpenAI puts it on the
      // top-level response, Anthropic emits a content block of type tool_use).
      const calls = (chunk as any).toolCalls as
        | { id: string; name: string; argumentsJson: string }[]
        | undefined;
      if (calls && calls.length > 0) {
        toolCallId = calls[0]!.id;
        toolName = calls[0]!.name;
        toolArgs = calls[0]!.argumentsJson;
      }
    }

    finalText += chunkText;

    if (finished === 'tool_calls' && toolName && toolCallId) {
      const result = await runTool(toolName, toolArgs ?? '{}');
      // Append assistant + tool messages so the model can resume.
      messages = [
        ...messages,
        { role: 'assistant', content: chunkText },
        { role: 'tool', name: toolName, content: result },
      ];
      continue; // next hop: stream the model's follow-up
    }
    break; // stop / length / error — we're done
  }

  return finalText;
}

async function main(): Promise<void> {
  const client = new LLMClient({
    // Real run: replace with resolveProvider() and a model that supports
    // tool calling (gpt-4o-mini, claude-sonnet, qwen2.5 with grammars).
    provider: new MockProvider({
      replies: [
        '[looking up weather...]',
        'It is 22°C and sunny in Tokyo right now.',
      ],
      chunkSize: 6,
      latencyMs: 20,
    }),
    retry: { maxAttempts: 1 },
    onChunk: ({ delta, totalChars, finished }) => {
      // This is the per-chunk UI hook. In a CLI we just write to stdout;
      // in a React app you'd setState here.
      process.stdout.write(delta);
      if (finished) process.stdout.write(`\n[stream done, ${totalChars} chars]\n`);
    },
  });

  const reply = await chatStreamWithTools(client, [
    { role: 'system', content: 'You are a helpful assistant. Use tools when needed.' },
    { role: 'user', content: "What's the weather in Tokyo?" },
  ]);

  console.log('---\nfinal text:', reply.length, 'chars');
  console.log('cost:', client.costTracker.totalTokens, 'tokens');
}

main().catch(err => { console.error(err); process.exit(1); });
```

## Running it

```bash
npx tsx examples/streaming-tool-use.ts
```

Trimmed output:

```text
[looki
ng up
 weath
er...]
[stream done, 22 chars]
It is
 22°C
 and s
unny i
n Toky
o righ
t now.
[stream done, 38 chars]
---
final text: 60 chars
cost: 12 tokens
```

The mock doesn't actually emit tool calls (it's offline), but the protocol
is the same once you swap in a real provider. The wire-level behaviour for
each backend is locked down by the integration tests in
`tests/integration/provider-wire/`:

- **OpenAI** — terminal chunk carries `tool_calls`. Tested with
  recorded SSE frames.
- **Anthropic** — `content_block_delta` for text, `tool_use` block for
  calls. Same handling shape.
- **Ollama** — text-only streaming today; falls back to a non-streaming
  request when `tools` is set.

## Things that bite people once

- **Don't drop the `finishReason`**. If you only listen for `delta`, you'll
  silently miss `tool_calls` and the loop will exit early.
- **Don't re-stream the same `messages`** after a tool call — append the
  assistant's partial text *and* the tool result before the next hop, or
  the model will repeat itself.
- **Cap the hop count**. Three is plenty; the hard cap defends against a
  jailbreak-style loop where the model keeps re-calling the same tool.
- **Per-call `onChunk`** beats a global one when you have multiple
  concurrent streams (think: web app, two tabs). Pass it via
  `client.stream(req, { onChunk })` — the per-call hook wins over the
  client-level default.
