# Sealos

在 Sealos 上做出自己的应用。Agent 负责部署、照看、操作你账号里的资源。

当前功能：[docs/index.md](docs/index.md)。
为什么存在、边界：[docs/versions/vision.md](docs/versions/vision.md)。

## 仓库结构

Flutter 负责 macOS / Windows 桌面宿主，Node sidecar 复用原有 Sealos 与 Agent 核心：

```
apps/
├── desktop/          # Flutter macOS / Windows 客户端（主桌面端）
├── desktop-backend/  # 标准输入输出 RPC sidecar，打包共享业务核心
├── desktop-backend/  # Node sidecar，共享业务核心
├── eve/              # 本地 Agent 服务（Vercel Eve）
└── mobile/           # 原 Expo iOS 空宿主，不在当前桌面重构范围
```

## 开发

```bash
npm install          # 根目录安装全部 workspace 依赖
npm run build:backend # 编译 Flutter 需要的 sidecar
npm run dev          # 按当前宿主启动 Flutter macOS / Windows 桌面端
npm run dev:eve      # 启动本地 eve agent
npm run typecheck    # TypeScript 工作区类型检查
npm run typecheck:flutter # Flutter 静态分析
npm run test:desktop # RPC 契约测试 + Flutter 测试
npm run lint         # Electron app 的 eslint
npm run build:mac    # 生成当前 Mac 架构的 Flutter DMG
npm run build:win    # 生成 Flutter Windows x64 安装程序
```

登录凭证沿用 use-sealos skill 的 `~/.sealos/` 约定（kubeconfig + auth.json），
两边互认登录态。

桌面架构、RPC 边界与发行要求见 [docs/desktop.md](docs/desktop.md)。
