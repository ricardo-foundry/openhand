#!/bin/bash

# OpenHand 停止脚本

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${YELLOW}🛑 正在停止 OpenHand...${NC}"

# 停止服务端
if [ -f /tmp/openhand-server.pid ]; then
    SERVER_PID=$(cat /tmp/openhand-server.pid)
    if kill -0 $SERVER_PID 2>/dev/null; then
        kill $SERVER_PID 2>/dev/null
        echo -e "${GREEN}✅ 服务端已停止${NC}"
    fi
    rm -f /tmp/openhand-server.pid
fi

# 停止前端
if [ -f /tmp/openhand-web.pid ]; then
    WEB_PID=$(cat /tmp/openhand-web.pid)
    if kill -0 $WEB_PID 2>/dev/null; then
        kill $WEB_PID 2>/dev/null
        echo -e "${GREEN}✅ 前端已停止${NC}"
    fi
    rm -f /tmp/openhand-web.pid
fi

# 强制清理端口
echo -e "${YELLOW}🧹 清理端口...${NC}"
lsof -ti:3001 | xargs kill -9 2>/dev/null || true
lsof -ti:3000 | xargs kill -9 2>/dev/null || true

echo -e "${GREEN}✅ OpenHand 已完全停止${NC}"