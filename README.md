# Helios

把项目丢进来，agent 负责部署到 Sealos，一屏看到部署产生的全部资源。

产品方向见 [versions/vision.md](./versions/vision.md)。
版本记录：[0.1 baseline](./versions/0.1-baseline.md)、[0.2 agent chat](./versions/0.2-agent-chat.md)。

## 仓库结构

npm workspaces monorepo，两个 app：

```
apps/
├── electron/   # 桌面端（electron-vite + React + TS），唯一客户端
└── eve/        # 本地 agent 服务（Vercel eve），部署逻辑的宿主（M2）
```

## 开发

```bash
npm install          # 根目录安装全部 workspace 依赖
npm run dev          # 启动 Electron 桌面端
npm run dev:eve      # 启动本地 eve agent
npm run typecheck    # 两个 app 的类型检查
npm run lint         # Electron app 的 eslint
```

登录凭证沿用 use-sealos skill 的 `~/.sealos/` 约定（kubeconfig + auth.json），
两边互认登录态。
