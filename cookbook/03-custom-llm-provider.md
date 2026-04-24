# 03 — Custom LLM provider

**Goal:** point OpenHand at any **OpenAI-compatible** local server
(vLLM, llama.cpp's `--api`, LM Studio, Together, Groq, Mistral.ai, …) without
writing a new provider class.

## Option A — re-use the OpenAI provider with a custom base URL

The shipped `OpenAIProvider` accepts `baseUrl`. Every OpenAI-compatible server
honors `/v1/chat/completions`, so this is usually all you need:

```bash
# vLLM example: serve a local model on :8000
vllm serve mistralai/Mistral-7B-Instruct-v0.3 --port 8000

# Tell OpenHand to use it
LLM_PROVIDER=openai \
OPENAI_API_KEY=not-needed \
OPENAI_BASE_URL=http://localhost:8000/v1 \
LLM_MODEL=mistralai/Mistral-7B-Instruct-v0.3 \
npx tsx examples/hello-world.ts
```

The same trick works for LM Studio (`http://localhost:1234/v1`), llama.cpp
server (`http://localhost:8080/v1`), and most hosted gateways.

## Option B — write a real `LLMProvider`

If your server isn't OpenAI-shaped, implement the interface directly:

```ts
// packages/llm/src/myprovider.ts
import type { LLMProvider } from '@openhand/llm';
import type { CompletionRequest, CompletionResponse, StreamChunk } from '@openhand/llm';

export class MyProvider implements LLMProvider {
  readonly info = { name: 'myprovider', supportsStreaming: true };

  constructor(private opts: { baseUrl: string; apiKey?: string }) {}

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const res = await fetch(`${this.opts.baseUrl}/generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(this.opts.apiKey && { authorization: `Bearer ${this.opts.apiKey}` }),
      },
      body: JSON.stringify({ model: req.model, messages: req.messages }),
      signal: req.extra?.signal as AbortSignal | undefined,
    });
    if (!res.ok) throw new Error(`upstream ${res.status}`);
    const data = await res.json();
    return {
      message: { role: 'assistant', content: data.text },
      model: req.model,
      usage: { promptTokens: data.in_tokens, completionTokens: data.out_tokens, totalTokens: data.in_tokens + data.out_tokens },
    };
  }

  async *stream(req: CompletionRequest): AsyncIterable<StreamChunk> {
    // ...wrap your server's stream protocol here
    const res = await this.complete(req);
    yield { delta: res.message.content, finishReason: 'stop', usage: res.usage };
  }
}
```

Register it in `resolveProvider` (or skip the registry and pass the instance
directly to `LLMClient`):

```ts
import { LLMClient } from '@openhand/llm';
import { MyProvider } from '@openhand/llm/myprovider';

const client = new LLMClient({
  provider: new MyProvider({ baseUrl: process.env.MY_URL!, apiKey: process.env.MY_KEY }),
  retry: { maxAttempts: 3 },
  rateLimit: { maxRequests: 60, windowMs: 60_000 },
  timeoutMs: 30_000,
});
```

## Why two options?

- **Option A** is the right answer 80% of the time — the OpenAI shape has
  become the lingua franca and your hosted/local server probably already
  speaks it.
- **Option B** matters when you want to wire a model gateway (Bedrock,
  Vertex), a proxy with custom auth, or a fundamentally different shape
  (tool-calling JSON-RPC, gRPC bridge).
