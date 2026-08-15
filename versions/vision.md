# Helios vision

桌面 app：把项目丢进来，agent 负责部署到 Sealos，部署产生的全部资源清晰可见。

Helios 不是又一个 Sealos 控制台，也不是为了「做 agent」而做的 agent 应用。它是让 **Sealos 更好用** 的桌面操作台。内部 MVP。

用户的需求经常是模糊的——那种交给 agent，用自然语言理解 intent。确定性强的动作（部署这个模板、删除这个项目、重启这个应用）走界面按钮：点下去就是那件事，不经过对话。对话的确定性比按钮差，不该承担这类操作。侧栏和详情负责诚实展示那个世界。

版本记录：[0.1 baseline](./0.1-baseline.md)、[0.2 agent chat](./0.2-agent-chat.md)、[0.3 templates](./0.3-templates.md)、[0.4 operate](./0.4-operate.md)、[0.5 topology](./0.5-topology.md)、[0.6 database](./0.6-database.md)。

## 为什么存在

use-sealos skill（[sealos-skills-next](https://github.com/norberia/sealos-skills-next)）已在 Cursor 里验证完整链路：登录、三条部署路径、数据库/存储/公网域名、部署后验证。Helios 把这条链路从「编码工具里的 skill」产品化成「任何人可用的桌面 app」。Sealos 零改动，只消费现有 API。

## 产品边界

做：登录 Sealos → 对话处理模糊意图（部署 / 排障 / 管数据库与存储）→ 按钮处理确定动作（模板部署、删除、重启、暂停/启动）→ 同一屏看见并点进真实资源。

不做：Web 版、移动端、自建云端后端和自建数据库（本地 eve 是桌面进程，不是云服务）、多项目管理面板、独立成本中心、区域切换。团队协作产品不做；工作空间切换已有。

成功标准：同一个项目分别用 Sealos 控制台和 Helios 部署，对比完成时间与操作步数。模糊需求一个输入即可；不把控制台那种配置表单搬进来。部署成功以公网 URL 实际可访问为唯一标准。

## 两层结构

1. **做事**分两条，都经 Electron 主进程，渲染进程不直连 Sealos / eve：
   - **模糊意图**：「开始」→ 本地 eve（bash + use-sealos 脚本 / kubectl）→ Sealos。
   - **确定动作**：主进程直调 Sealos 已有 API（模板部署、删除、重启、暂停/启动）。
2. **看见**：Electron → Sealos API 直连（namespace-scoped k8s API + applaunchpad 监控 API）。资源侧栏是部署结果的仪表盘；口径与 Sealos 控制台同一套标签和接口。本地不存业务状态；15 秒自动刷新 + 手动刷新；数据库/环境变量只展示 secret 引用名，不显示明文。

## 架构（已定）

- **仓库**：npm workspaces。`apps/electron` 桌面端；`apps/eve` 本地 agent，部署逻辑的宿主。eve 内置 use-sealos skill（从 sealos-skills-next 拷贝，不会自动同步），能力与该 skill 对齐。
- **Electron**：唯一客户端。electron-vite + React + TypeScript；浅色主题。渲染进程不直连 eve（开发态跨端口 CORS、打包后 `file://` 同源都过不去）：主进程 HTTP 调 eve，对话经 IPC 流到首页。共享类型与 `window.helios` 接口集中在 `apps/electron/src/shared/types.ts`。
- **eve**：登录后主进程后台拉起。开发态 `eve dev --no-ui --host 127.0.0.1 --port 24721`；打包态跑 `eve build` 产物（`.output/server/index.mjs`）并捆绑官方 Node 24。退出/登出杀掉，切换工作空间则换凭证重启。路由走 eve 默认 HTTP（`POST /eve/v1/session`、`GET /eve/v1/session/:id/stream`）。鉴权：开发 `localDev()`，打包 `httpBasic(helios / 本地密码)`。一轮对话跟 `session.waiting` / `turn.failed` 结束，不跟墙上时钟。
- **工具与 sandbox**：eve 默认 bash / 文件 / 联网 / todo / ask_question 已启用。bash 不走 Docker/microsandbox——`helios-host` 在用户本机跑 `/bin/bash`，`HOME` 为 `~/.helios/home`（`.sealos` 软链到真实 `~/.sealos`），PATH 补 Homebrew / Docker。skill 脚本是 `python3` + `kubectl`（源码构建还要 `docker`）；没装这些 CLI 时部署会失败。首页把 `actions.requested` / `action.result` / `reasoning.appended` 投成活动行；命令截断展示，不把工具全文（可能含密钥）倒进 UI。
- **模型凭证**：不走 Vercel AI Gateway。主进程向当前工作空间的 AI Proxy 确保一把名为 `helios` 的 Key（没有就创建，停用就打开），密钥只进 eve 子进程环境变量（`HELIOS_AI_BASE_URL` / `HELIOS_AI_KEY` / `HELIOS_AI_MODEL`），不进渲染进程。模型按该区域 `/api/models/enabled` 选择：聊天模型里优先 DeepSeek Flash（id 或厂商含 `deepseek` 且含 `flash`，`deepseek-v4-flash` / `deepseek-flash` 优先），没有则回退 `gemini-3.5-flash`。eve 用 `@ai-sdk/openai-compatible` 直连 `https://aiproxy.{region}/v1`。Flash 类模型常常不吐 reasoning token，这时首页只有工具活动、没有「思考过程」。
- **凭证与 skill 互认**：沿用 `~/.sealos/`（kubeconfig + auth.json，0600）。auth.json 除 `regional_token` 外另存 `app_token`（desktop 发给 iframe 应用的会话 JWT，`internalJwtSecret` 签名，aiproxy-web 等应用后端只认它）；登录与切换工作空间时随 regionToken/namespace-switch 响应一起落盘，旧登录态缺失时用 `regional_token` 重放一次 switch 无感补发。

## 工程约定

- k8s 访问用 `@kubernetes/client-node` 2.x（对象参数风格、直接返回 body）；Electron 39（Node 22+）可直接加载纯 ESM 依赖。
- `electron` 依赖钉精确版本（当前 `39.8.10`）：electron-builder 在 workspace 提升安装下不接受范围版本。
- 本地开发用 `electron-vite dev --watch`：主进程/preload 改动自动热重启；只有渲染进程能靠 HMR。
- 依赖统一从仓库根安装；根 `package.json` 的 `engines.node` 由 eve 脚手架锁定为 24.x。
- 首页布局与尺寸对齐 Lovable（lovable.dev/dashboard 实测值，oklch 原值直接可用）；配色不随 Lovable——背景为白底＋logo 金（`#F0BE4E` / `#EDC868` 低透明度光晕），高饱和点缀色只保留金色系。
- macOS 应用图标：1024 画布、主体 824 居中、四周 100px **真透明**边距。`qlmanage` 转 SVG 会把透明区填成白色，生成走 Chromium canvas：`npx electron apps/electron/scripts/gen-icon.mjs <svg> <png>`。
- logo 采用 Sealos 官方 mark 的金色重配色，源资产在根 `assets/`（blackgold 黑底、whitegold 白底）。侧边栏用无底纯金标（`src/renderer/src/assets/sealos-logo-gold.svg`，whitegold 去底）；登录/加载页用 `logo.svg`；应用图标用 whitegold。dev 下主进程 `app.dock.setIcon(resources/icon.png)`，打包由 electron-builder 从 `build/icon.png` 生成。

## 参考

- use-sealos skill：源仓库 `https://github.com/norberia/sealos-skills-next`；Helios 内一份拷贝在 `apps/eve/agent/skills/use-sealos/`（决策树、`sealos-api.py`、`wait-app.sh`、references/）。两边不会自动同步。
- Sealos 源码：控制台各前端实际调用的 API 以本机 `/Users/che/Documents/GitHub/sealos` 为准；仓库内 `dev-assets/sealos` 有 applaunchpad / dbprovider / template 三个前端的 sparse clone。详情页字段口径（标签/注解、监控 API、实例 CR）都以它为准。查 API 不凭记忆，见 `.cursor/rules/sealos-source.mdc`。
- Sealos 资源模型：namespace（`ns-xxx`）、app label `cloud.sealos.io/app-deploy-manager`、KubeBlocks `Cluster` CR、`ObjectStorageBucket` CR、region domain（如 `usw-1.sealos.io`）。
- eve 文档：以安装后的 `node_modules/eve/docs/` 为准（README 有阅读顺序），脚手架 `npx eve init`；线上文档 <https://eve.dev/docs>。
