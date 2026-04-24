import { WebSocketServer, WebSocket } from 'ws';
import { AgentManager } from './agent-manager';

interface WebSocketClient {
  ws: WebSocket;
  agentId?: string;
  sessionId?: string;
}

export function setupWebSocket(wss: WebSocketServer, agentManager: AgentManager) {
  const clients: Map<WebSocket, WebSocketClient> = new Map();

  // 转发 Agent 事件到 WebSocket
  agentManager.on('message', ({ agentId, message }) => {
    broadcast(wss, { type: 'message', agentId, data: message });
  });

  agentManager.on('task:start', ({ agentId, task }) => {
    broadcast(wss, { type: 'task:start', agentId, data: task });
  });

  agentManager.on('task:complete', ({ agentId, task }) => {
    broadcast(wss, { type: 'task:complete', agentId, data: task });
  });

  agentManager.on('task:error', ({ agentId, taskId, error }) => {
    broadcast(wss, { type: 'task:error', agentId, data: { taskId, error } });
  });

  agentManager.on('approval:required', ({ agentId, taskId, reason }) => {
    broadcast(wss, { type: 'approval:required', agentId, data: { taskId, reason } });
  });

  wss.on('connection', (ws: WebSocket) => {
    console.log('New WebSocket connection');
    clients.set(ws, { ws });

    ws.on('message', async (data: string) => {
      try {
        const message = JSON.parse(data);
        const client = clients.get(ws);

        switch (message.type) {
          case 'subscribe':
            if (client) {
              client.agentId = message.agentId;
              client.sessionId = message.sessionId;
            }
            ws.send(JSON.stringify({ type: 'subscribed', agentId: message.agentId }));
            break;

          case 'chat':
            if (message.agentId && message.content) {
              const sessionId = message.sessionId || `ws-${Date.now()}`;
              await agentManager.chat(message.agentId, sessionId, message.content);
            }
            break;

          case 'approve':
            if (message.agentId && message.taskId !== undefined) {
              await agentManager.approveTask(message.agentId, message.taskId, message.approved !== false);
            }
            break;

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;

          default:
            ws.send(JSON.stringify({ type: 'error', message: 'Unknown message type' }));
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          message: error instanceof Error ? error.message : 'Invalid message'
        }));
      }
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      clients.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      clients.delete(ws);
    });

    // 发送欢迎消息
    ws.send(JSON.stringify({
      type: 'connected',
      message: 'Connected to OpenHand Server'
    }));
  });
}

function broadcast(wss: WebSocketServer, message: any) {
  const data = JSON.stringify(message);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(data);
    }
  });
}