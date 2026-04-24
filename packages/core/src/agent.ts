/**
 * @module @openhand/core/agent
 *
 * The Agent owns one in-memory conversation graph: sessions → messages + tasks.
 * It is the integration point between three pluggable concerns:
 *
 *   - `TaskPlanner`  — turns user input into structured tool calls (LLM-driven).
 *   - `Tool` map     — name → callable, may include plugin-supplied tools.
 *   - `PolicyEngine` — gates execution; can require human approval per tool.
 *
 * Every state transition is broadcast through `EventEmitter` (`message`,
 * `task:start`, `task:complete`, `task:error`, `approval:required`, `system`).
 * Consumers subscribe instead of polling — `apps/cli` drives a REPL spinner,
 * `apps/server` forwards to SSE, `apps/web` re-renders. The agent itself
 * holds no I/O — it never reads the network or the filesystem directly.
 */
import { EventEmitter } from 'eventemitter3';
import { v4 as uuidv4 } from 'uuid';
import {
  Message,
  Task,
  Tool,
  AgentConfig,
  LLMConfig,
  Session,
  ExecutionContext
} from './types';
import { TaskPlanner } from './planner';
import { ContextManager } from './context';
import { PolicyEngine } from './policy';

export interface AgentOptions {
  config: AgentConfig;
  llmConfig: LLMConfig;
  tools: Map<string, Tool>;
}

/**
 * Event map for the Agent's EventEmitter. Listeners receive a single
 * payload argument typed to the event name.
 */
export interface AgentEventMap {
  message: (message: Message) => void;
  'task:start': (task: Task) => void;
  'task:progress': (data: { taskId: string; progress: number; message: string }) => void;
  'task:complete': (task: Task) => void;
  'task:error': (data: { taskId: string; error: string }) => void;
  'approval:required': (data: { taskId: string; reason: string }) => void;
  system: (data: { message: string; level: 'info' | 'warn' | 'error' }) => void;
}

export class Agent extends EventEmitter<AgentEventMap> {
  private config: AgentConfig;
  private llmConfig: LLMConfig;
  private tools: Map<string, Tool>;
  private planner: TaskPlanner;
  private contextManager: ContextManager;
  private policyEngine: PolicyEngine;
  private sessions: Map<string, Session> = new Map();

  constructor(options: AgentOptions) {
    super();
    this.config = options.config;
    this.llmConfig = options.llmConfig;
    this.tools = options.tools;
    this.planner = new TaskPlanner(this.llmConfig);
    this.contextManager = new ContextManager();
    this.policyEngine = new PolicyEngine();
  }

  async initialize(): Promise<void> {
    this.emit('system', {
      message: `Agent "${this.config.name}" initialized`,
      level: 'info'
    });
  }

  async chat(sessionId: string, content: string): Promise<void> {
    const session = this.getOrCreateSession(sessionId);
    
    // 添加用户消息
    const userMessage: Message = {
      id: uuidv4(),
      role: 'user',
      content,
      timestamp: new Date()
    };
    session.messages.push(userMessage);
    this.emit('message', userMessage);

    try {
      // 规划任务
      const plan = await this.planner.plan(content, session.context, Array.from(this.tools.values()));
      
      // 执行任务
      for (const taskPlan of plan.tasks) {
        const task = await this.createTask(sessionId, taskPlan);
        
        if (task.requiresApproval) {
          this.emit('approval:required', {
            taskId: task.id,
            reason: `Task "${task.type}" requires approval`
          });
          continue;
        }

        await this.executeTask(task, sessionId);
      }

      // 生成回复
      const response = await this.generateResponse(session);
      const assistantMessage: Message = {
        id: uuidv4(),
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };
      session.messages.push(assistantMessage);
      this.emit('message', assistantMessage);

    } catch (error) {
      this.emit('system', {
        message: `Error processing message: ${error}`,
        level: 'error'
      });
    }

    session.updatedAt = new Date();
  }

  async approveTask(taskId: string, approved: boolean): Promise<void> {
    const task = this.findTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    task.approved = approved;
    if (approved) {
      const sessionId = this.findSessionIdByTask(taskId);
      if (sessionId) {
        await this.executeTask(task, sessionId);
      }
    } else {
      task.status = 'cancelled';
      this.emit('task:complete', task);
    }
  }

  private async executeTask(task: Task, sessionId: string): Promise<void> {
    task.status = 'running';
    task.startedAt = new Date();
    this.emit('task:start', task);

    try {
      const tool = this.tools.get(task.type);
      if (!tool) {
        throw new Error(`Tool "${task.type}" not found`);
      }

      // 检查权限
      const allowed = await this.policyEngine.check(tool.permissions, task.params);
      if (!allowed) {
        throw new Error(`Permission denied for tool "${task.type}"`);
      }

      // 创建执行上下文
      const context: ExecutionContext = {
        taskId: task.id,
        userId: 'user',
        sessionId,
        permissions: tool.permissions,
        workingDirectory: process.cwd(),
        env: process.env as Record<string, string>
      };

      // 执行任务
      const result = await tool.execute(task.params, context);
      
      task.result = result;
      task.status = 'completed';
      task.completedAt = new Date();
      
      this.emit('task:complete', task);

    } catch (error) {
      task.status = 'failed';
      task.error = error instanceof Error ? error.message : String(error);
      this.emit('task:error', { taskId: task.id, error: task.error });
    }
  }

  private async createTask(sessionId: string, plan: { type: string; params: Record<string, any> }): Promise<Task> {
    const requiresApproval = this.config.requireApprovalFor.includes(plan.type);
    
    const task: Task = {
      id: uuidv4(),
      type: plan.type,
      description: `Execute ${plan.type}`,
      status: 'pending',
      params: plan.params,
      createdAt: new Date(),
      requiresApproval
    };

    const session = this.sessions.get(sessionId);
    if (session) {
      session.tasks.push(task);
    }

    return task;
  }

  private async generateResponse(session: Session): Promise<string> {
    return `I've processed your request. You can check the task status with the tasks command.`;
  }

  private getOrCreateSession(sessionId: string): Session {
    if (!this.sessions.has(sessionId)) {
      this.sessions.set(sessionId, {
        id: sessionId,
        userId: 'user',
        messages: [],
        tasks: [],
        context: {},
        createdAt: new Date(),
        updatedAt: new Date()
      });
    }
    return this.sessions.get(sessionId)!;
  }

  private findTask(taskId: string): Task | undefined {
    for (const session of this.sessions.values()) {
      const task = session.tasks.find(t => t.id === taskId);
      if (task) return task;
    }
    return undefined;
  }

  private findSessionIdByTask(taskId: string): string | undefined {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.tasks.some(t => t.id === taskId)) {
        return sessionId;
      }
    }
    return undefined;
  }

  getSession(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  getConfig(): AgentConfig {
    return { ...this.config };
  }
}