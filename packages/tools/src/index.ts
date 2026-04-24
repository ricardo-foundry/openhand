import { Tool } from '@openhand/core';
import { SecureSandbox } from '@openhand/sandbox';
import { createFileTools } from './file';
import { createShellTools } from './shell';
import { createBrowserTools } from './browser';
import { createEmailTools } from './email';
import { createSystemTools } from './system';

export interface ToolKitConfig {
  sandbox?: SecureSandbox;
  emailConfig?: {
    host: string;
    port: number;
    secure: boolean;
    auth: { user: string; pass: string };
  };
}

export function createTools(config: ToolKitConfig = {}): Map<string, Tool> {
  const tools = new Map<string, Tool>();
  const sandbox = config.sandbox || new SecureSandbox();

  // 注册文件工具
  for (const tool of createFileTools(sandbox)) {
    tools.set(tool.name, tool);
  }

  // 注册 Shell 工具
  for (const tool of createShellTools(sandbox)) {
    tools.set(tool.name, tool);
  }

  // 注册浏览器工具
  for (const tool of createBrowserTools()) {
    tools.set(tool.name, tool);
  }

  // 注册邮件工具
  for (const tool of createEmailTools(config.emailConfig)) {
    tools.set(tool.name, tool);
  }

  // 注册系统工具
  for (const tool of createSystemTools()) {
    tools.set(tool.name, tool);
  }

  return tools;
}

export * from './file';
export * from './shell';
export * from './browser';
export * from './email';
export * from './system';