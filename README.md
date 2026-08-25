# Helios

在 Sealos 上做出自己的应用。Agent 负责部署、照看、操作你账号里的资源。

当前功能：[docs/index.md](docs/index.md)。
为什么存在、边界：[docs/versions/vision.md](docs/versions/vision.md)。

## 仓库结构

npm workspaces monorepo，三个 app：

```
apps/
├── electron/   # 桌面端（electron-vite + React + TS）
├── eve/        # 本地 agent 服务（Vercel eve），部署逻辑的宿主
└── mobile/     # iOS（Expo）。功能尚未移植，见 docs/mobile.md
```

## 开发

```bash
npm install          # 根目录安装全部 workspace 依赖
npm run dev          # 启动 Electron 桌面端
npm run dev:eve      # 启动本地 eve agent
npm run ios          # 启动 Expo，打开 iOS 模拟器
npm run typecheck    # 三个 app 的类型检查
npm run lint         # Electron app 的 eslint
```

登录凭证沿用 use-sealos skill 的 `~/.sealos/` 约定（kubeconfig + auth.json），
两边互认登录态。
