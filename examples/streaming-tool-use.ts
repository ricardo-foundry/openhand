/**
 * Streaming + tool use, end to end.
 *
 * Stream a model's reply chunk-by-chunk and let the model call tools
 * mid-stream. The mock provider doesn't actually emit tool calls — the
 * point of this file is to show the *protocol* and prove the wiring runs
 * with no API key.
 *
 * See `cookbook/07-streaming-tool-use.md` for the full walkthrough.
 *
 * Run:
 *   npx tsx examples/streaming-tool-use.ts
 */
import {
  LLMClient,
  MockProvider,
  type ChatMessage,
  type ToolSchema,
  type StreamChunk,
} from '../packages/llm/src/index';

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
  const { city } = JSON.parse(argsJson) as { city: string };
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
      // Some providers attach toolCalls to the terminal chunk's metadata.
      const calls = (chunk as unknown as {
        toolCalls?: { id: string; name: string; argumentsJson: string }[];
      }).toolCalls;
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

  console.log('---');
  console.log(`[final] ${reply.length} chars`);
  console.log(`[cost] ${client.costTracker.totalTokens} tokens`);
  console.log('[done] streaming + tool-use demo finished');
}

main().catch(err => {
  console.error('[error]', err);
  process.exit(1);
});
