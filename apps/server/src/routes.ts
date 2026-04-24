import { Router, Request, Response } from 'express';
import { AgentManager } from './agent-manager';

export function setupRoutes(app: Router, agentManager: AgentManager) {
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
    const { agentId } = req.params;
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
    const { agentId } = req.params;
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
      const { agentId } = req.params;
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
    const { agentId, sessionId } = req.params;
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
      const { agentId, taskId } = req.params;
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