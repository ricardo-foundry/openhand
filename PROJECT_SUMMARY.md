# 📊 OpenHand 项目摘要

## 项目统计

| 指标 | 数值 |
|------|------|
| 总代码行数 | ~3,000+ 行 |
| TypeScript 文件 | 25+ |
| React 组件 | 9 |
| 核心模块 | 3 个 |
| 应用 | 3 个 (CLI/Server/Web) |
| 内置工具 | 15+ |

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    用户交互层                                │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│   Web UI    │    CLI      │   REST API  │   WebSocket       │
│  (React)    │  (Node.js)  │  (Express)  │   (Real-time)     │
└──────┬──────┴──────┬──────┴──────┬──────┴─────────┬─────────┘
       │             │             │                │
       └─────────────┴──────┬──────┴────────────────┘
                            ▼
              ┌─────────────────────────┐
│           │     核心引擎 (Core)      │
│           │  ┌─────────────────────┐  │
│           │  │    Agent 管理器      │  │
│           │  │   Task Planner      │  │
│           │  │  Context Manager    │  │
│           │  │   Policy Engine     │  │
│           │  └─────────────────────┘  │
│           └─────────────────────────┘
                      │
       ┌──────────────┼──────────────┐
       ▼              ▼              ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│   工具层      │ │   沙箱层     │ │  多 LLM 支持  │
│  (15+ 工具)  │ │ (隔离执行)   │ │ (4+ 提供商)  │
└──────────────┘ └──────────────┘ └──────────────┘
```

## 核心特性对比

| 特性 | OpenClaw | OpenHand |
|------|----------|----------|
| 安全沙箱 | ❌ | ✅ |
| 审批流程 | ❌ | ✅ |
| 多 LLM 支持 | 部分 | ✅ |
| CLI 界面 | ✅ | ✅ |
| Web 界面 | ✅ | ✅ |
| 本地部署 | 复杂 | 一键 |
| 插件系统 | 有漏洞 | 安全 |

## 文件结构

```
openhand/
├── packages/
│   ├── core/              # 核心引擎
│   │   ├── src/
│   │   │   ├── agent.ts   # Agent 实现
│   │   │   ├── planner.ts # 任务规划器
│   │   │   ├── context.ts # 上下文管理
│   │   │   └── policy.ts  # 策略引擎
│   │   └── package.json
│   ├── sandbox/           # 安全沙箱
│   │   ├── src/
│   │   │   └── sandbox.ts # 沙箱实现
│   │   └── package.json
│   └── tools/             # 工具集合
│       ├── src/
│       │   ├── file/      # 文件工具
│       │   ├── shell/     # Shell 工具
│       │   ├── browser/   # 浏览器工具
│       │   ├── email/     # 邮件工具
│       │   └── system/    # 系统工具
│       └── package.json
├── apps/
│   ├── cli/               # CLI 应用
│   │   ├── src/
│   │   │   ├── cli.ts
│   │   │   └── commands/
│   │   └── package.json
│   ├── server/            # Web 服务端
│   │   ├── src/
│   │   │   ├── index.ts
│   │   │   ├── agent-manager.ts
│   │   │   ├── routes.ts
│   │   │   └── websocket.ts
│   │   └── package.json
│   └── web/               # Web 前端
│       ├── src/
│       │   ├── pages/
│       │   ├── components/
│       │   └── App.tsx
│       └── package.json
├── plugins/               # 插件示例
│   └── weather/
├── docker-compose.yml
├── README.md
└── LICENSE
```

## 技术栈

- **后端**: Node.js, TypeScript, Express, WebSocket
- **前端**: React, TypeScript, Tailwind CSS, Vite
- **安全**: 自定义沙箱, 权限系统, 审计日志
- **AI**: 支持 OpenAI, Claude, Ollama, 自定义 API

## 路线图

- [x] 核心引擎
- [x] 安全沙箱
- [x] 工具系统
- [x] CLI 界面
- [x] Web 界面
- [x] 多 LLM 支持
- [x] 插件系统
- [ ] Telegram Bot
- [ ] 更多工具
- [ ] 插件市场
- [ ] 团队协作
