# 05 — Streaming UI in 30 lines of React

**Goal:** tail an OpenHand task in real time from a React component, with
auto-resume on disconnect.

## The wire format

`GET /api/tasks/:id/stream` is an SSE endpoint. Each frame:

```text
id: 7
event: task
data: {"id":7,"taskId":"demo-1","status":"running","timestamp":1714000000000,"message":"step 3"}

```

`id` is a monotonic counter per task. If the connection drops, the browser
auto-reconnects and sends `Last-Event-ID: 7` so the server can replay only
what you missed (the bus keeps a 200-event ring buffer per task).

## The component

```tsx
import { useEffect, useState } from 'react';

interface TaskEvent {
  id: number;
  taskId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  timestamp: number;
  message?: string;
}

export function TaskTail({ taskId }: { taskId: string }) {
  const [events, setEvents] = useState<TaskEvent[]>([]);
  const [status, setStatus] = useState<TaskEvent['status']>('pending');

  useEffect(() => {
    const es = new EventSource(`/api/tasks/${taskId}/stream`);
    es.addEventListener('task', (e: MessageEvent) => {
      const evt = JSON.parse(e.data) as TaskEvent;
      setEvents(prev => [...prev, evt]);
      setStatus(evt.status);
      if (evt.status === 'completed' || evt.status === 'failed') {
        es.close();
      }
    });
    es.onerror = () => { /* browser will retry; nothing to do */ };
    return () => es.close();
  }, [taskId]);

  return (
    <section>
      <header>{taskId} — <strong>{status}</strong></header>
      <ol>
        {events.map(e => (
          <li key={e.id}><code>{new Date(e.timestamp).toISOString()}</code> {e.message ?? e.status}</li>
        ))}
      </ol>
    </section>
  );
}
```

## Demo without the UI

```bash
npm run dev:server &
# tail the demo task in one terminal
curl -N http://localhost:3001/api/tasks/demo-1/stream
# trigger it in another
curl -X POST http://localhost:3001/api/tasks/demo-1/_demo
```

You'll see four frames stream in over ~1 second:
`pending → running → running → completed`.

## Why SSE over WebSockets

- Works through every corporate proxy that allows HTTPS.
- Built-in retry + `Last-Event-ID` resume, no library required.
- Unidirectional, which matches the actual data flow (server → client logs).

If you genuinely need bidirectional, `apps/server/src/websocket.ts` ships a
WS endpoint too. But for "show me what the agent is doing right now", SSE is
the smaller hammer.
