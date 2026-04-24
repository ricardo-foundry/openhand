import { Tool } from '@openhand/core';
import * as os from 'os';

export function createSystemTools(): Tool[] {
  return [
    {
      name: 'system_info',
      description: '获取系统信息',
      parameters: [],
      permissions: ['system:info'],
      sandboxRequired: false,
      execute: async (params, context) => {
        return {
          platform: os.platform(),
          arch: os.arch(),
          hostname: os.hostname(),
          uptime: os.uptime(),
          totalMemory: os.totalmem(),
          freeMemory: os.freemem(),
          cpus: os.cpus().length,
          loadAverage: os.loadavg()
        };
      }
    },
    {
      name: 'system_datetime',
      description: '获取当前日期时间',
      parameters: [
        {
          name: 'timezone',
          type: 'string',
          description: '时区',
          required: false,
          default: 'local'
        },
        {
          name: 'format',
          type: 'string',
          description: '日期格式',
          required: false,
          default: 'ISO'
        }
      ],
      permissions: ['system:info'],
      sandboxRequired: false,
      execute: async (params, context) => {
        const now = new Date();
        
        return {
          timestamp: now.getTime(),
          iso: now.toISOString(),
          local: now.toLocaleString(),
          date: now.toLocaleDateString(),
          time: now.toLocaleTimeString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
        };
      }
    },
    {
      name: 'system_note',
      description: '创建或读取笔记',
      parameters: [
        {
          name: 'action',
          type: 'string',
          description: '操作类型（create/read/list/delete）',
          required: true
        },
        {
          name: 'id',
          type: 'string',
          description: '笔记ID',
          required: false
        },
        {
          name: 'title',
          type: 'string',
          description: '笔记标题',
          required: false
        },
        {
          name: 'content',
          type: 'string',
          description: '笔记内容',
          required: false
        },
        {
          name: 'tags',
          type: 'array',
          description: '标签列表',
          required: false,
          default: []
        }
      ],
      permissions: ['system:storage'],
      sandboxRequired: false,
      execute: async (params, context) => {
        // 简单的内存存储
        const storage = (global as any).__openhand_notes || {};
        
        switch (params.action) {
          case 'create':
            const noteId = params.id || `note-${Date.now()}`;
            storage[noteId] = {
              id: noteId,
              title: params.title || 'Untitled',
              content: params.content || '',
              tags: params.tags || [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString()
            };
            (global as any).__openhand_notes = storage;
            return { success: true, note: storage[noteId] };
            
          case 'read':
            const note = storage[params.id];
            if (!note) {
              return { success: false, error: 'Note not found' };
            }
            return { success: true, note };
            
          case 'list':
            const notes = Object.values(storage);
            return { success: true, notes, count: notes.length };
            
          case 'delete':
            if (storage[params.id]) {
              delete storage[params.id];
              return { success: true };
            }
            return { success: false, error: 'Note not found' };
            
          default:
            return { success: false, error: 'Unknown action' };
        }
      }
    },
    {
      name: 'system_remind',
      description: '设置提醒',
      parameters: [
        {
          name: 'message',
          type: 'string',
          description: '提醒内容',
          required: true
        },
        {
          name: 'time',
          type: 'string',
          description: '提醒时间（ISO格式或自然语言）',
          required: true
        },
        {
          name: 'recurring',
          type: 'boolean',
          description: '是否重复',
          required: false,
          default: false
        }
      ],
      permissions: ['system:notify'],
      sandboxRequired: false,
      execute: async (params, context) => {
        const reminderId = `reminder-${Date.now()}`;
        const reminders = (global as any).__openhand_reminders || [];
        
        const reminder = {
          id: reminderId,
          message: params.message,
          time: params.time,
          recurring: params.recurring,
          createdAt: new Date().toISOString()
        };
        
        reminders.push(reminder);
        (global as any).__openhand_reminders = reminders;
        
        return {
          success: true,
          reminder,
          message: `Reminder set: "${params.message}" at ${params.time}`
        };
      }
    }
  ];
}