# Flutter 桌面端

`apps/desktop` 是 macOS 和 Windows 的主桌面宿主。它负责窗口、文件选择和界面；`apps/desktop-backend` 是应用随包启动的 Node 24 sidecar。

## 业务边界

- Sealos 认证、Kubernetes 资源、项目、应用、数据库、存储、模板、AI Proxy 和工作空间继续使用 `apps/desktop-backend/src/core/sealos` 中的同一份 TypeScript 实现。
- Agent、对话存储、附件读取和 Eve 运行时继续使用 `apps/desktop-backend/src/core/agent` 和 `apps/eve`。
- `desktop-api.ts` 是 Flutter RPC 的方法调度层，也是 sidecar 合同。增删 `HeliosApi` 时，`apps/desktop-backend/test/contract.test.mjs` 会阻止漏接。

sidecar 与 Flutter 通过标准输入输出的 NDJSON 通信，不开本地端口。每个请求是 `{id, method, args}`，响应是 `{id, result}` 或 `{id, error}`，事件是 `{event, data}`。

## 开发

1. 安装 Node 24 和 Flutter stable。
2. 在根目录运行 `npm install`。
3. 运行 `npm run build:backend`。
4. 运行 `npm run dev`，脚本会按当前宿主选择 macOS 或 Windows。也可在
   `apps/desktop` 手动运行 `flutter run -d macos` 或 `flutter run -d windows`。

Flutter 开发模式会从仓库的 `apps/desktop-backend/dist/helios-backend.cjs` 启动 sidecar。
`npm run dev` 会验证 sidecar 使用 Node 24；当前 shell 不是 Node 24 时，会优先复用已经构建的
Sealos Release 中的内置 Node 24。可使用 `HELIOS_BACKEND_PATH` 和 `HELIOS_NODE_PATH` 覆盖定位，
但覆盖的 Node 仍必须是 24.x。

## 发行

- `npm run build:mac` 按当前 Mac 架构构建 `apps/desktop/dist/Sealos-<version>-mac-<arm64|x64>.dmg`。
- `npm run build:win` 在 Windows x64 上构建 `apps/desktop/dist/Sealos-<version>-windows-x64.exe`，需要 Inno Setup 6，可用 `ISCC_PATH` 指定 `ISCC.exe`。
- 两种发行包都内置 Node 24 和 Eve 产物。Windows 包内置 PortableGit，为 Agent 提供 Bash。
- 打包脚本会根据 Node 官方 `SHASUMS256.txt` 校验运行时，并使用发行资产的固定
  SHA-256 校验 PortableGit。
- 本地源码构建仍依赖用户机器上的 Docker、kubectl 和相关 CLI，这与原 Electron 功能合同一致。

## 检查更新

客户端启动时及每 30 分钟读取 `https://api.github.com/repos/sealos-apps/sealos/releases/latest`，账户页也提供「检查更新」。仅接受正式的 `vX.Y.Z` 或 `X.Y.Z` 版本，按数字比较版本号。

发现新版后弹窗展示版本与发布说明，同一版本每次运行仅自动提醒一次。用户点击「立即更新」后，客户端选择对应平台的安装包，并使用同一 Release 中的 `SHA256SUMS.txt` 校验下载内容。校验失败不会打开文件，可重新下载。

校验通过后打开系统安装包：macOS 用户将应用拖到「应用程序」替换旧版，Windows 用户按安装向导完成安装。这是安装包更新流程，不会静默替换正在运行的程序。账户页可重新打开已下载的安装包。

Release 必须公开可读。私有仓库、限流或断网会显示检查失败，不会误报「已是最新版本」；客户端不包含 GitHub 私人凭证。已有安装包不会被下载覆盖，每次下载使用独立目录。
