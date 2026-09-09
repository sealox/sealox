# Helios Desktop

Helios 的 Flutter 桌面宿主，支持 macOS 和 Windows。界面通过 NDJSON RPC 连接
`apps/desktop-backend`，复用原有 Sealos、Kubernetes 和 Agent 业务实现。

开发、架构、打包与更新协议请参阅仓库根目录的 `docs/desktop.md`。常用命令：

```bash
npm run dev
npm run typecheck:flutter
npm run test:desktop
npm run build:mac
npm run build:win
```
