import { Tool, ExecutionContext } from '@openhand/core';
import { SecureSandbox } from '@openhand/sandbox';
import * as path from 'path';

export function createFileTools(sandbox: SecureSandbox): Tool[] {
  return [
    {
      name: 'file_read',
      description: '读取文件内容',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: '文件路径',
          required: true
        },
        {
          name: 'encoding',
          type: 'string',
          description: '文件编码',
          required: false,
          default: 'utf-8'
        }
      ],
      permissions: ['file:read'],
      sandboxRequired: true,
      execute: async (params, context) => {
        const filePath = path.resolve(params.path);
        const content = await sandbox.readFile(filePath);
        return { content, path: filePath };
      }
    },
    {
      name: 'file_write',
      description: '写入文件内容',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: '文件路径',
          required: true
        },
        {
          name: 'content',
          type: 'string',
          description: '文件内容',
          required: true
        },
        {
          name: 'append',
          type: 'boolean',
          description: '是否追加模式',
          required: false,
          default: false
        }
      ],
      permissions: ['file:write'],
      sandboxRequired: true,
      execute: async (params, context) => {
        const filePath = path.resolve(params.path);
        // 如果是追加模式，先读取原内容
        let finalContent = params.content;
        if (params.append) {
          try {
            const existing = await sandbox.readFile(filePath);
            finalContent = existing + params.content;
          } catch (e) {
            // 文件不存在，直接写入
          }
        }
        await sandbox.writeFile(filePath, finalContent);
        return { success: true, path: filePath, bytes: finalContent.length };
      }
    },
    {
      name: 'file_list',
      description: '列出目录内容',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: '目录路径',
          required: true
        },
        {
          name: 'recursive',
          type: 'boolean',
          description: '是否递归列出',
          required: false,
          default: false
        }
      ],
      permissions: ['file:read'],
      sandboxRequired: true,
      execute: async (params, context) => {
        const dirPath = path.resolve(params.path);
        const entries = await sandbox.listDirectory(dirPath);
        return { path: dirPath, entries };
      }
    },
    {
      name: 'file_search',
      description: '在文件中搜索文本',
      parameters: [
        {
          name: 'path',
          type: 'string',
          description: '文件或目录路径',
          required: true
        },
        {
          name: 'pattern',
          type: 'string',
          description: '搜索模式',
          required: true
        },
        {
          name: 'recursive',
          type: 'boolean',
          description: '是否递归搜索',
          required: false,
          default: false
        }
      ],
      permissions: ['file:read'],
      sandboxRequired: true,
      execute: async (params, context) => {
        if (typeof params.pattern !== 'string' || params.pattern.length === 0) {
          throw new Error('pattern is required');
        }
        if (typeof params.path !== 'string' || params.path.length === 0) {
          throw new Error('path is required');
        }
        // Pass pattern/path after a `--` sentinel and also use grep's
        // `-e` / `--` to disambiguate pattern from options. This defeats
        // option-injection attempts like pattern = "--include=*".
        const result = await sandbox.execute(
          'grep',
          ['-r', '-n', '-e', params.pattern, '--', params.path],
          { taskId: context.taskId },
        );

        const matches = result.output
          .split('\n')
          .filter(line => line.trim())
          .map(line => {
            const match = line.match(/^(.+?):(\d+):(.*)$/);
            if (match) {
              return {
                file: match[1],
                line: parseInt(match[2], 10),
                content: match[3],
              };
            }
            return null;
          })
          .filter(Boolean);

        return { matches, count: matches.length };
      }
    }
  ];
}