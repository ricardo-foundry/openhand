import { Agent, AgentConfig, LLMConfig, Session, Message, Task } from '@openhand/core';
import { SecureSandbox } from '@openhand/sandbox';
import { createTools } from '@openhand/tools';
import { EventEmitter } from 'events';
import { globalTaskStream } from './task-stream';

interface AgentInstance {
  id: string;
  agent: Agent;
  sandbox: SecureSandbox;
  createdAt: Date;
}

export class AgentManager extends EventEmitter {
  private agents: Map<string, AgentInstance> = new Map();
  private defaultConfig: AgentConfig;
  private defaultLLMConfig: LLMConfig;

  constructor() {
    super();
    this.defaultConfig = {
      name: 'OpenHand',
      description: 'Your secure AI assistant',
      systemPrompt: `You are OpenHand, a helpful and secure AI assistant.
You help users with various tasks including file operations, web searches, email management, and system queries.
Always prioritize security and ask for confirmation before performing destructive operations.`,
      tools: [],
      maxIterations: 10,
      requireApprovalFor: ['shell_exec', 'file_write', 'email_send'],
      sandboxEnabled: true
    };

    this.defaultLLMConfig = {
      provider: 'openai',
      model: 'gpt-4',
      apiKey: process.env.OPENAI_API_KEY || '',
      temperature: 0.7,
      maxTokens: 2000
    };
  }

  async createAgent(id: string, config?: Partial<AgentConfig>, llmConfig?: Partial<LLMConfig>): Promise<AgentInstance> {
    // 创建沙箱
    const sandbox = new SecureSandbox({
      timeout: 30000,
      memoryLimit: 256,
      allowedPaths: [process.cwd()],
      networkEnabled: true
    });

    // 创建工具
    const tools = createTools({ sandbox });

    // 合并配置
    const mergedConfig: AgentConfig = {
      ...this.defaultConfig,
      ...config,
      tools: Array.from(tools.keys())
    };

    const mergedLLMConfig: LLMConfig = {
      ...this.defaultLLMConfig,
      ...llmConfig
    };

    // 创建 Agent
    const agent = new Agent({
      config: mergedConfig,
      llmConfig: mergedLLMConfig,
      tools
    });

    await agent.initialize();

    const instance: AgentInstance = {
      id,
      agent,
      sandbox,
      createdAt: new Date()
    };

    this.agents.set(id, instance);

    // 转发事件
    agent.on('message', (msg) => this.emit('message', { agentId: id, message: msg }));
    agent.on('task:start', (task: Task) => {
      this.emit('task:start', { agentId: id, task });
      globalTaskStream.publish({
        taskId: task.id,
        status: 'running',
        message: `task started: ${task.type}`,
      });
    });
    agent.on('task:complete', (task: Task) => {
      this.emit('task:complete', { agentId: id, task });
      globalTaskStream.publish({
        taskId: task.id,
        status: 'completed',
        message: `task completed: ${task.type}`,
        data: task.result,
      });
    });
    agent.on('task:error', (data: { taskId: string; error: string }) => {
      this.emit('task:error', { agentId: id, ...data });
      globalTaskStream.publish({
        taskId: data.taskId,
        status: 'failed',
        message: data.error,
      });
    });
    agent.on('approval:required', (data) => this.emit('approval:required', { agentId: id, ...data }));

    return instance;
  }

  getAgent(id: string): AgentInstance | undefined {
    return this.agents.get(id);
  }

  async removeAgent(id: string): Promise<boolean> {
    const instance = this.agents.get(id);
    if (!instance) return false;
    
    this.agents.delete(id);
    this.emit('agent:removed', { agentId: id });
    return true;
  }

  getAllAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  async chat(agentId: string, sessionId: string, content: string): Promise<void> {
    const instance = this.agents.get(agentId);
    if (!instance) {
      throw new Error(`Agent ${agentId} not found`);
    }
    await instance.agent.chat(sessionId, content);
  }

  async approveTask(agentId: string, taskId: string, approved: boolean): Promise<void> {
    const instance = this.agents.get(agentId);
    if (!instance) {
      throw new Error(`Agent ${agentId} not found`);
    }
    await instance.agent.approveTask(taskId, approved);
  }

  getSession(agentId: string, sessionId: string): Session | undefined {
    const instance = this.agents.get(agentId);
    if (!instance) return undefined;
    return instance.agent.getSession(sessionId);
  }
}