# 🚀 OpenHand 快速开始

## 安装

```bash
# 克隆项目
git clone https://github.com/yourusername/openhand.git
cd openhand

# 安装依赖
npm install

# 构建项目
npm run build
```

## 配置

```bash
# 配置 LLM
cd apps/cli
npm run config -- --setup

# 或设置环境变量
export OPENAI_API_KEY=your_key_here
```

## 使用

### CLI 模式

```bash
# 启动交互式聊天
cd apps/cli
npm start

# 快速提问
npm run ask "帮我搜索 Node.js 文档"

# 执行命令（沙箱内）
npm run exec "ls -la"
```

### Web 模式

```bash
# 终端 1：启动服务端
cd apps/server
npm run dev

# 终端 2：启动前端
cd apps/web
npm run dev

# 打开 http://localhost:3000
```

### Docker 模式

```bash
# 一键启动
docker-compose up -d

# 访问 http://localhost:3000
```

## 示例命令

| 操作 | CLI 命令 | 自然语言 |
|------|----------|----------|
| 读取文件 | `openhand read file.txt` | "读取 file.txt" |
| 写入文件 | `openhand write file.txt "content"` | "写入文件" |
| 执行命令 | `openhand exec "ls"` | "列出文件" |
| 网络搜索 | `openhand search "query"` | "搜索..." |

## 安全提示

- ✅ 所有操作默认在沙箱中运行
- ✅ 敏感操作需用户确认
- ✅ 支持白名单机制
- ⚠️ 生产环境请配置 API 密钥
