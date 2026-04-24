# Contributing to OpenHand

感谢你对 OpenHand 的兴趣！我们欢迎各种形式的贡献。

## 开发设置

```bash
# 克隆项目
git clone https://github.com/yourusername/openhand.git
cd openhand

# 安装依赖
npm install

# 构建包
npm run build

# 启动开发模式
npm run dev
```

## 项目结构

- `packages/core` - 核心引擎
- `packages/sandbox` - 安全沙箱
- `packages/tools` - 工具集合
- `apps/cli` - CLI 应用
- `apps/server` - 服务端
- `apps/web` - Web 前端

## 提交规范

- `feat:` 新功能
- `fix:` 修复
- `docs:` 文档
- `style:` 格式
- `refactor:` 重构
- `test:` 测试
- `chore:` 构建

## 代码风格

- 使用 TypeScript
- 遵循 ESLint 规则
- 添加适当的注释
- 编写测试用例