#!/bin/bash

# OpenHand 一键启动脚本（Kimi 专用版）
# 使用方法: ./start.sh

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}"
echo "  ██████  ██████  ███████ ███    ██ ███    ██  █████  ███    ██ ██████  "
echo " ██    ██ ██   ██ ██      ████   ██ ████   ██ ██   ██ ████   ██ ██   ██ "
echo " ██    ██ ██████  █████   ██ ██  ██ ██ ██  ██ ███████ ██ ██  ██ ██   ██ "
echo " ██    ██ ██   ██ ██      ██  ██ ██ ██  ██ ██ ██   ██ ██  ██ ██ ██   ██ "
echo "  ██████  ██   ██ ███████ ██   ████ ██   ████ ██   ██ ██   ████ ██████  "
echo -e "${NC}"
echo -e "${GREEN}🚀 OpenHand Web 启动器 (Kimi AI 专用版)${NC}\n"

# Configuration — read from environment (never commit secrets to the repo).
# Source a local .env if it exists so individual dev machines can keep
# credentials out of shell history.
if [ -f "$(dirname "${BASH_SOURCE[0]}")/.env" ]; then
    # shellcheck disable=SC1091
    set -a; . "$(dirname "${BASH_SOURCE[0]}")/.env"; set +a
fi

KIMI_API_KEY="${KIMI_API_KEY:-${OPENHAND_API_KEY:-}}"
KIMI_BASE_URL="${KIMI_BASE_URL:-https://api.moonshot.cn}"
KIMI_MODEL="${KIMI_MODEL:-moonshot-v1-8k}"

if [ -z "$KIMI_API_KEY" ]; then
    echo -e "${RED}ERROR: KIMI_API_KEY is not set.${NC}"
    echo "Put it in .env (see .env.example) or export it before running."
    exit 1
fi

# 检查 Node.js
echo -e "${YELLOW}🔍 检查 Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js 未安装，请先安装 Node.js 18+${NC}"
    exit 1
fi

NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 18 ]; then
    echo -e "${RED}❌ Node.js 版本过低，需要 18+，当前版本: $(node -v)${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Node.js 版本: $(node -v)${NC}\n"

# 获取脚本所在目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# 创建配置目录和文件
echo -e "${YELLOW}⚙️  配置 Kimi AI...${NC}"
mkdir -p ~/.openhand

cat > ~/.openhand/config.json << EOF
{
  "llm": {
    "provider": "custom",
    "model": "${KIMI_MODEL}",
    "apiKey": "${KIMI_API_KEY}",
    "baseUrl": "${KIMI_BASE_URL}",
    "temperature": 0.7,
    "maxTokens": 2000
  }
}
EOF
echo -e "${GREEN}✅ Kimi 配置完成${NC}\n"

# 安装服务端依赖
echo -e "${YELLOW}📦 安装服务端依赖...${NC}"
cd apps/server
if [ ! -d "node_modules" ]; then
    npm install
fi
echo -e "${GREEN}✅ 服务端依赖就绪${NC}\n"

# 安装前端依赖
echo -e "${YELLOW}📦 安装前端依赖...${NC}"
cd ../web
if [ ! -d "node_modules" ]; then
    npm install
fi
echo -e "${GREEN}✅ 前端依赖就绪${NC}\n"

cd "$SCRIPT_DIR"

# 检查端口占用
check_port() {
    local port=$1
    if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
        return 0
    else
        return 1
    fi
}

# 清理已占用的端口
echo -e "${YELLOW}🧹 检查端口...${NC}"
if check_port 3001; then
    echo -e "${YELLOW}⚠️  端口 3001 被占用，尝试释放...${NC}"
    lsof -ti:3001 | xargs kill -9 2>/dev/null || true
    sleep 1
fi
if check_port 3000; then
    echo -e "${YELLOW}⚠️  端口 3000 被占用，尝试释放...${NC}"
    lsof -ti:3000 | xargs kill -9 2>/dev/null || true
    sleep 1
fi
echo -e "${GREEN}✅ 端口检查完成${NC}\n"

# 启动服务端
echo -e "${YELLOW}🚀 启动服务端...${NC}"
cd apps/server
export KIMI_API_KEY="$KIMI_API_KEY"
npm run dev > /tmp/openhand-server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > /tmp/openhand-server.pid

# 等待服务端启动
echo -e "${YELLOW}⏳ 等待服务端启动...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:3001/api/health >/dev/null 2>&1; then
        echo -e "${GREEN}✅ 服务端已启动 (PID: $SERVER_PID)${NC}\n"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ 服务端启动失败，查看日志: /tmp/openhand-server.log${NC}"
        exit 1
    fi
done

# 启动前端
echo -e "${YELLOW}🚀 启动前端...${NC}"
cd ../web
npm run dev > /tmp/openhand-web.log 2>&1 &
WEB_PID=$!
echo $WEB_PID > /tmp/openhand-web.pid

# 等待前端启动
echo -e "${YELLOW}⏳ 等待前端启动...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:3000 >/dev/null 2>&1; then
        echo -e "${GREEN}✅ 前端已启动 (PID: $WEB_PID)${NC}\n"
        break
    fi
    sleep 1
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ 前端启动失败，查看日志: /tmp/openhand-web.log${NC}"
        exit 1
    fi
done

# 打开浏览器
echo -e "${YELLOW}🌐 正在打开浏览器...${NC}"
sleep 2

# 根据系统打开浏览器
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open http://localhost:3000
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open http://localhost:3000 2>/dev/null || sensible-browser http://localhost:3000 2>/dev/null || echo -e "${YELLOW}请手动打开浏览器访问: http://localhost:3000${NC}"
else
    echo -e "${YELLOW}请手动打开浏览器访问: http://localhost:3000${NC}"
fi

echo ""
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${GREEN}  🎉 OpenHand 启动成功！                          ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo -e "${BLUE}  🌐 Web 界面: http://localhost:3000              ${NC}"
echo -e "${BLUE}  🔌 API 地址: http://localhost:3001              ${NC}"
echo -e "${BLUE}  🤖 AI 模型: Kimi (Moonshot)                     ${NC}"
echo -e "${GREEN}═══════════════════════════════════════════════════${NC}"
echo ""
echo -e "${YELLOW}📝 使用说明:${NC}"
echo "  1. 在浏览器中使用 Web 界面与 AI 对话"
echo "  2. 支持文件操作、网络搜索、邮件管理等功能"
echo "  3. 敏感操作会有审批提示，请在页面上确认"
echo ""
echo -e "${YELLOW}🛑 停止服务:${NC}"
echo "  按 Ctrl+C 或运行: ./stop.sh"
echo ""

# 等待用户按 Ctrl+C
echo -e "${YELLOW}💡 服务运行中... (按 Ctrl+C 停止)${NC}"
wait $SERVER_PID $WEB_PID