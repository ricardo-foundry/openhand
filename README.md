# 🤖 OpenHand

**安全可控的 AI Agent 助手** - 你的开源 AI 自动化伙伴

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)

> 🌟 **核心特点：安全优先** - 所有操作在沙箱中运行，敏感操作需用户确认

## ✨ 特性

- 🔐 **安全沙箱** - 所有操作在隔离环境中执行
- 🧠 **多模型支持** - OpenAI、Claude、Ollama 本地模型等
- 💬 **双端支持** - CLI 和 Web 界面
- ✅ **审批工作流** - 敏感操作需用户确认
- 📧 **邮件管理** - 自动分类、摘要、回复
- 📁 **文件操作** - 安全的文件读写
- 🌐 **网络工具** - 网页抓取、搜索
- 🛠️ **插件系统** - 可扩展的工具生态

## 🚀 快速开始

### 安装

```bash
# 克隆项目
git clone https://github.com/yourusername/openhand.git
cd openhand

# 安装依赖
npm install

# 构建项目
npm run build
```

### CLI 使用

```bash
# 启动交互式 CLI
cd apps/cli
npm start

# 或者使用命令
npm run chat

# 快速提问
npm run ask "帮我总结这个文件的内容"

# 执行命令（沙箱内）
npm run exec "ls -la"
```

### Web 界面

```bash
# 启动服务端
cd apps/server
npm run dev

# 启动前端（另一个终端）
cd apps/web
npm run dev

# 访问 http://localhost:3000
```

### 配置

```bash
# 配置 LLM
cd apps/cli
npm run config -- --setup

# 或者手动编辑配置文件
~/.openhand/config.json
```

## 🏗️ 架构

```
openhand/
├── packages/
│   ├── core/          # 核心引擎
│   ├── sandbox/       # 安全沙箱
│   └── tools/         # 工具集合
├── apps/
│   ├── cli/           # CLI 客户端
│   ├── server/        # Web 服务端
│   └── web/           # Web 前端
└── plugins/           # 插件目录
```

## 🔧 支持的 LLM 提供商

| 提供商 | 状态 | 说明 |
|--------|------|------|
| OpenAI | ✅ | GPT-4, GPT-3.5 |
| Claude | ✅ | Claude 3 系列 |
| Ollama | ✅ | 本地模型支持 |
| 自定义 | ✅ | 兼容 OpenAI API |

## 📋 内置工具

| 工具 | 描述 | 沙箱 |
|------|------|------|
| file_read | 读取文件 | ✅ |
| file_write | 写入文件 | ✅ |
| file_list | 列出目录 | ✅ |
| file_search | 搜索文件 | ✅ |
| shell_exec | 执行 Shell | ✅ |
| browser_fetch | 网页请求 | ❌ |
| browser_extract | 提取内容 | ❌ |
| browser_search | 网络搜索 | ❌ |
| email_send | 发送邮件 | ❌ |
| email_read | 读取邮件 | ❌ |
| system_info | 系统信息 | ❌ |
| system_note | 笔记管理 | ❌ |

## 🔐 安全特性

- **沙箱隔离** - 所有工具在隔离环境运行
- **权限控制** - 细粒度的权限管理
- **审批流程** - 敏感操作需确认
- **审计日志** - 完整操作记录
- **资源限制** - CPU/内存/时间限制

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📜 许可证

MIT License © 2024 OpenHand Team