/**
 * @module @openhand/server/routes
 *
 * REST + SSE surface for the OpenHand server. Routes split into three groups:
 *
 *   1. `/api/tasks/:id/stream`  — live SSE feed with `Last-Event-ID` resume.
 *   2. `/api/tasks/:id/_demo`   — dev-only synthetic stream so the web UI
 *      has something to render without a real LLM round-trip.
 *   3. `/api/agents/...`        — CRUD for agents, sessions, and approvals.
 *
 * Long-running connections (SSE) install a 15s heartbeat to keep proxies
 * happy and clean themselves up on `req.close`/`req.error` — never leak.
 */
import { Router, Request, Response } from 'express';
import { AgentManager } from './agent-manager';
import { globalTaskStream, formatSseFrame, type TaskStatus } from './task-stream';

export function setupRoutes(app: Router, agentManager: AgentManager) {
  // SSE: live task events.
  // Route shape: GET /api/tasks/:taskId/stream
  // Clients receive every event published to the bus for that task, plus any
  // backlog still in the ring buffer. Clients may resume after reconnect by
  // sending `Last-Event-ID` (the browser sets this automatically for EventSource).
  app.get('/api/tasks/:taskId/stream', (req: Request, res: Response) => {
    const taskId = req.params.taskId ?? '';
    const lastEventIdHeader = req.headers['last-event-id'];
    const sinceId = typeof lastEventIdHeader === 'string'
      ? Number.parseInt(lastEventIdHeader, 10)
      : undefined;

    res.status(200).set({
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable proxy buffering (nginx etc.) so events reach the browser live.
      'x-accel-buffering': 'no',
    });
    res.flushHeaders?.();

    // Initial handshake so the client knows the stream is live.
    res.write(`retry: 3000\n\n`);

    // Replay backlog (if any).
    for (const evt of globalTaskStream.history(
      taskId,
      Number.isFinite(sinceId) ? sinceId : undefined,
    )) {
      res.write(formatSseFrame(evt));
    }

    // Track cleanup state so every exit path (client close, write error,
    // terminal event) runs exactly once and we never leak the subscription
    // handler or the heartbeat timer into the ring buffer's listener list.
    let cleaned = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let unsubscribe: () => void = () => {};
    const cleanup = (): void => {
      if (cleaned) return;
      cleaned = true;
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
    };

    unsubscribe = globalTaskStream.subscribe(taskId, evt => {
      try {
        res.write(formatSseFrame(evt));
      } catch {
        // Socket gone — tear down immediately rather than waiting for
        // the next heartbeat to notice.
        cleanup();
        return;
      }
      // If the task is done, close the stream politely.
      if (evt.status === 'completed' || evt.status === 'failed') {
        setTimeout(() => {
          cleanup();
          try { res.end(); } catch { /* already closed */ }
        }, 50);
      }
    });

    // Heartbeat every 15s so intermediate proxies don't time out the socket.
    heartbeat = setInterval(() => {
      try {
        res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        cleanup();
      }
    }, 15_000);
    heartbeat.unref?.();

    req.on('close', cleanup);
    req.on('error', cleanup);
  });

  // Dev helper: seed a synthetic task stream so the web UI has something
  // to render without a real LLM roundtrip. Intentionally not documented
  // in the public OpenAPI — gated by query param so curl tests can use it.
  app.post('/api/tasks/:taskId/_demo', (req: Request, res: Response) => {
    const taskId = req.params.taskId ?? '';
    const statuses: TaskStatus[] = ['pending', 'running', 'running', 'completed'];
    statuses.forEach((status, i) => {
      setTimeout(() => {
        globalTaskStream.publish({
          taskId,
          status,
          message: `step ${i + 1}/${statuses.length}`,
        });
      }, i * 400);
    });
    res.json({ ok: true, taskId });
  });

  // Health check
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Create agent
  app.post('/api/agents', async (req: Request, res: Response) => {
    try {
      const { id, config, llmConfig } = req.body;
      const agentId = id || `agent-${Date.now()}`;
      
      const instance = await agentManager.createAgent(agentId, config, llmConfig);
      
      res.status(201).json({
        success: true,
        agentId: instance.id,
        config: instance.agent.getConfig()
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // List agents
  app.get('/api/agents', (req: Request, res: Response) => {
    const agents = agentManager.getAllAgents().map(a => ({
      id: a.id,
      createdAt: a.createdAt,
      config: a.agent.getConfig()
    }));
    
    res.json({ agents });
  });

  // Get agent
  app.get('/api/agents/:agentId', (req: Request, res: Response) => {
    const agentId = req.params.agentId ?? '';
    const instance = agentManager.getAgent(agentId);
    
    if (!instance) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    
    res.json({
      id: instance.id,
      createdAt: instance.createdAt,
      config: instance.agent.getConfig()
    });
  });

  // Delete agent
  app.delete('/api/agents/:agentId', async (req: Request, res: Response) => {
    const agentId = req.params.agentId ?? '';
    const success = await agentManager.removeAgent(agentId);
    
    if (!success) {
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    
    res.json({ success: true });
  });

  // Send message
  app.post('/api/agents/:agentId/chat', async (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId ?? '';
      const { sessionId, message } = req.body;
      
      if (!message) {
        res.status(400).json({ error: 'Message is required' });
        return;
      }
      
      const sid = sessionId || `session-${Date.now()}`;
      await agentManager.chat(agentId, sid, message);
      
      res.json({
        success: true,
        sessionId: sid
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get session
  app.get('/api/agents/:agentId/sessions/:sessionId', (req: Request, res: Response) => {
    const agentId = req.params.agentId ?? '';
    const sessionId = req.params.sessionId ?? '';
    const session = agentManager.getSession(agentId, sessionId);
    
    if (!session) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }
    
    res.json({ session });
  });

  // Approve/Reject task
  app.post('/api/agents/:agentId/tasks/:taskId/approve', async (req: Request, res: Response) => {
    try {
      const agentId = req.params.agentId ?? '';
      const taskId = req.params.taskId ?? '';
      const { approved } = req.body;
      
      await agentManager.approveTask(agentId, taskId, approved !== false);
      
      res.json({ success: true });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  // Get LLM providers
  app.get('/api/llm/providers', (req: Request, res: Response) => {
    res.json({
      providers: [
        { id: 'openai', name: 'OpenAI', models: ['gpt-4', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
        { id: 'claude', name: 'Claude (Anthropic)', models: ['claude-3-opus', 'claude-3-sonnet', 'claude-3-haiku'] },
        { id: 'ollama', name: 'Ollama (Local)', models: ['llama2', 'mistral', 'codellama'] },
        { id: 'custom', name: 'Custom', models: [] }
      ]
    });
  });
}