import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { AgentManager } from './agent-manager';
import { setupRoutes } from './routes';
import { setupWebSocket } from './websocket';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3001;

// 安全中间件
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Agent 管理器
const agentManager = new AgentManager();

// 设置路由
setupRoutes(app, agentManager);

// 设置 WebSocket
setupWebSocket(wss, agentManager);

// 错误处理
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

server.listen(PORT, () => {
  console.log(`
  ██████  ██████  ███████ ███    ██ ███    ██  █████  ███    ██ ██████  
  ██    ██ ██   ██ ██      ████   ██ ████   ██ ██   ██ ████   ██ ██   ██ 
  ██    ██ ██████  █████   ██ ██  ██ ██ ██  ██ ███████ ██ ██  ██ ██   ██ 
  ██    ██ ██   ██ ██      ██  ██ ██ ██  ██ ██ ██   ██ ██  ██ ██ ██   ██ 
   ██████  ██   ██ ███████ ██   ████ ██   ████ ██   ██ ██   ████ ██████  
  
  🚀 Server running on http://localhost:${PORT}
  📡 WebSocket ready on ws://localhost:${PORT}
  `);
});

export { agentManager };