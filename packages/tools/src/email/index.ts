import { Tool } from '@openhand/core';

interface EmailConfig {
  host: string;
  port: number;
  secure: boolean;
  auth: {
    user: string;
    pass: string;
  };
}

export function createEmailTools(config?: EmailConfig): Tool[] {
  return [
    {
      name: 'email_send',
      description: '发送邮件',
      parameters: [
        {
          name: 'to',
          type: 'string',
          description: '收件人邮箱',
          required: true
        },
        {
          name: 'subject',
          type: 'string',
          description: '邮件主题',
          required: true
        },
        {
          name: 'body',
          type: 'string',
          description: '邮件正文',
          required: true
        },
        {
          name: 'html',
          type: 'boolean',
          description: '是否 HTML 格式',
          required: false,
          default: false
        }
      ],
      permissions: ['email:send'],
      sandboxRequired: false,
      execute: async (params, context) => {
        if (!config) {
          return {
            success: false,
            error: 'Email not configured. Please set up email configuration first.'
          };
        }

        // 模拟发送邮件
        console.log(`[Email] To: ${params.to}`);
        console.log(`[Email] Subject: ${params.subject}`);
        console.log(`[Email] Body: ${params.body.substring(0, 100)}...`);

        return {
          success: true,
          messageId: `msg-${Date.now()}`,
          to: params.to,
          subject: params.subject
        };
      }
    },
    {
      name: 'email_read',
      description: '读取邮件（模拟）',
      parameters: [
        {
          name: 'folder',
          type: 'string',
          description: '邮箱文件夹',
          required: false,
          default: 'INBOX'
        },
        {
          name: 'limit',
          type: 'number',
          description: '读取数量',
          required: false,
          default: 10
        }
      ],
      permissions: ['email:read'],
      sandboxRequired: false,
      execute: async (params, context) => {
        // 模拟读取邮件
        const mockEmails = [
          {
            id: '1',
            from: 'boss@company.com',
            subject: 'Project Update',
            preview: 'Please review the latest project updates...',
            date: new Date().toISOString()
          },
          {
            id: '2',
            from: 'newsletter@tech.com',
            subject: 'Weekly Tech News',
            preview: 'This week in technology...',
            date: new Date(Date.now() - 86400000).toISOString()
          }
        ];

        return {
          folder: params.folder,
          emails: mockEmails.slice(0, params.limit),
          total: mockEmails.length
        };
      }
    },
    {
      name: 'email_summarize',
      description: '总结邮件内容',
      parameters: [
        {
          name: 'emails',
          type: 'array',
          description: '邮件列表',
          required: true
        }
      ],
      permissions: ['email:read'],
      sandboxRequired: false,
      execute: async (params, context) => {
        const emails = params.emails || [];
        
        const summary = {
          total: emails.length,
          important: emails.filter((e: any) => 
            e.subject?.toLowerCase().includes('urgent') ||
            e.subject?.toLowerCase().includes('important')
          ).length,
          unread: emails.filter((e: any) => !e.read).length,
          categories: {
            work: emails.filter((e: any) => 
              e.from?.includes('company') || e.subject?.toLowerCase().includes('project')
            ).length,
            newsletter: emails.filter((e: any) => 
              e.from?.includes('newsletter') || e.subject?.toLowerCase().includes('news')
            ).length,
            other: 0
          }
        };
        
        summary.categories.other = emails.length - 
          summary.categories.work - 
          summary.categories.newsletter;

        return { summary };
      }
    }
  ];
}