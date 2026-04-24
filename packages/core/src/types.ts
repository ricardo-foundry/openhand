// OpenHand 核心类型定义

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: Record<string, any>;
}

export interface Task {
  id: string;
  type: string;
  description: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  params: Record<string, any>;
  result?: any;
  error?: string;
  parentId?: string;
  subtasks?: Task[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  requiresApproval: boolean;
  approved?: boolean;
}

export interface Tool {
  name: string;
  description: string;
  parameters: ToolParameter[];
  execute: (params: Record<string, any>, context: ExecutionContext) => Promise<any>;
  permissions: string[];
  sandboxRequired: boolean;
}

export interface ToolParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  description: string;
  required: boolean;
  default?: any;
}

export interface ExecutionContext {
  taskId: string;
  userId: string;
  sessionId: string;
  permissions: string[];
  workingDirectory: string;
  env: Record<string, string>;
}

export interface AgentConfig {
  name: string;
  description: string;
  systemPrompt: string;
  tools: string[];
  maxIterations: number;
  requireApprovalFor: string[];
  sandboxEnabled: boolean;
}

export interface LLMConfig {
  provider: 'openai' | 'claude' | 'ollama' | 'custom';
  model: string;
  apiKey?: string;
  baseUrl?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface Session {
  id: string;
  userId: string;
  messages: Message[];
  tasks: Task[];
  context: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  rules: PolicyRule[];
  enabled: boolean;
}

export interface PolicyRule {
  resource: string;
  action: string;
  effect: 'allow' | 'deny';
  conditions?: Record<string, any>;
}

export type AgentEvent = 
  | { type: 'message'; data: Message }
  | { type: 'task:start'; data: Task }
  | { type: 'task:progress'; data: { taskId: string; progress: number; message: string } }
  | { type: 'task:complete'; data: Task }
  | { type: 'task:error'; data: { taskId: string; error: string } }
  | { type: 'approval:required'; data: { taskId: string; reason: string } }
  | { type: 'system'; data: { message: string; level: 'info' | 'warn' | 'error' } };