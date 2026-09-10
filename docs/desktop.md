# Flutter 桌面端

`apps/desktop` 是 macOS 和 Windows 的主桌面宿主。它负责窗口、文件选择和界面；`apps/desktop-backend` 是应用随包启动的 Node 24 sidecar。

## 业务边界

- Sealos 认证、Kubernetes 资源、项目、应用、数据库、存储、模板、AI Proxy 和工作空间继续使用 `apps/desktop-backend/src/core/sealos` 中的同一份 TypeScript 实现。
- Agent、对话存储、附件读取和 Eve 运行时继续使用 `apps/desktop-backend/src/core/agent` 和 `apps/eve`。
- `desktop-api.ts` 是 Electron IPC 与 Flutter RPC 共用的唯一方法调度层。增删 `HeliosApi` 时，`apps/desktop-backend/test/contract.test.mjs` 会阻止任一宿主漏接。

sidecar 与 Flutter 通过标准输入输出的 NDJSON 通信，不开本地端口。每个请求是 `{id, method, args}`，响应是 `{id, result}` 或 `{id, error}`，事件是 `{event, data}`。

## 开发

1. 安装 Node 24 和 Flutter stable。
2. 在根目录运行 `npm install`。
3. 运行 `npm run build:backend`。
4. 运行 `npm run dev`，脚本会按当前宿主选择 macOS 或 Windows。也可在
   `apps/desktop` 手动运行 `flutter run -d macos` 或 `flutter run -d windows`。

Flutter 开发模式会从仓库的 `apps/desktop-backend/dist/helios-backend.cjs` 启动 sidecar。
`npm run dev` 会验证 sidecar 使用 Node 24；当前 shell 不是 Node 24 时，会优先复用已经构建的
Helios Release 中的内置 Node 24。可使用 `HELIOS_BACKEND_PATH` 和 `HELIOS_NODE_PATH` 覆盖定位，
但覆盖的 Node 仍必须是 24.x。

## 发行

- `npm run build:mac` 按当前 Mac 架构构建 `apps/desktop/dist/Helios-<version>-mac-<arm64|x64>.dmg`。
- `npm run build:win` 在 Windows x64 上构建 `apps/desktop/dist/Helios-<version>-windows-x64.exe`，需要 Inno Setup 6，可用 `ISCC_PATH` 指定 `ISCC.exe`。
- 两种发行包都内置 Node 24 和 Eve 产物。Windows 包内置 PortableGit，为 Agent 提供 Bash。
- 打包脚本会根据 Node 官方 `SHASUMS256.txt` 校验运行时，并使用发行资产的固定
  SHA-256 校验 PortableGit。
- 本地源码构建仍依赖用户机器上的 Docker、kubectl 和相关 CLI，这与原 Electron 功能合同一致。

`latest.json` 支持原 macOS 单产物格式，也支持双平台格式：

```json
{
  "version": "0.9.0",
  "notes": "...",
  "artifacts": {
    "macos-arm64": { "url": ".../Helios-0.9.0-mac-arm64.dmg", "sha256": "..." },
    "macos-x64": { "url": ".../Helios-0.9.0-mac-x64.dmg", "sha256": "..." },
    "windows-x64": { "url": ".../Helios-0.9.0-windows-x64.exe", "sha256": "..." }
  }
}
```
