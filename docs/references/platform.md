# 平台合同

登录、工作空间、凭证、模型、更新、进程边界。违反这些，资源会进错空间、对话会连错模型、或渲染进程拿到不该看的明文。

## 进程

```
渲染进程  --IPC window.helios-->  Electron 主进程  --HTTP-->  eve (127.0.0.1:24721)
                                      |                     --bash/kubectl--> Sealos
                                      +--HTTPS kubeconfig/BFF--> Sealos
```

- 共享类型与 `HeliosApi`：`apps/electron/src/shared/types.ts`。新 IPC 三处一起改：main / preload / 该接口。
- k8s：`@kubernetes/client-node` 2.x，对象参数风格。鉴权头与 BFF 相同：`Authorization: encodeURIComponent(kubeconfig)`。
- 区域 host：`auth.json` 的 `region` → 回退 kubeconfig hostname。禁止用 `apiserver.*` 拼 `template.` / `applaunchpad.` / `dbprovider.`。
- 退出 / 登出杀掉 eve；切换工作空间换凭证重启。进行中的一轮丢掉，不假装还在。

eve 路由以安装后的 `node_modules/eve/docs/` 为准。Helios 用的是 `POST /eve/v1/session`、`GET .../stream`、`POST .../cancel`。

## 本地文件

```
~/.sealos/kubeconfig          与 use-sealos 互认，0600
~/.sealos/auth.json           regional_token + app_token + region + 工作空间展示名
~/.helios/chats/<ws>/         对话全文，见 chat.md
~/.helios/model.json          可选 DeepSeek Key，0600
~/.helios/home                eve bash 的 HOME；.sealos 软链到真实 ~/.sealos
```

写入 JSON：临时文件再 rename。渲染进程不碰磁盘。

`app_token` 是 desktop 发给 iframe 应用的会话 JWT（`internalJwtSecret` 签名）。aiproxy-web 等应用后端只认它，不认 `regional_token`。登录与切空间时随 regionToken / namespace-switch 响应一起落盘；旧登录态缺失时用 `regional_token` 重放一次 switch 无感补发。

## 登录

首次：OAuth2 device flow（`startLogin` / `onLoginEvent` 的 `device_code`），或粘贴 kubeconfig（`saveKubeconfig`）。登录后默认进私人工作空间。

用户信息在**设置**页账户块：区域、API server、命名空间、工作空间、登录时间、kubeconfig 路径。退出登录在这块底部。

## 工作空间

胶囊点开：当前空间信息（私人/团队、角色、成员数）、成员列表、邀请（管理员/开发者链接，落地页 `/WorkspaceInvite/?code=` 与 desktop 一致）、重命名（仅拥有者）、切换/新建、底部 Upgrade（跳 region 费用中心）。

权限门控与 desktop 相同（邀请需拥有者/管理员）。切空间：`namespace/switch` 换发 token，再取新 kubeconfig，落盘 `~/.sealos/`，重启 eve，清空详情栈。

IPC：`listWorkspaces` / `switchWorkspace` / `getWorkspaceDetails` / `renameWorkspace` / `createWorkspace` / `getInviteLink`。

Vision 不做「区域切换」产品；登录时可选 region 是登录流程的一部分，不是登录后的设置项。

## 模型凭证

覆盖，不是替换。入口是设置，不是 AI Proxy 页。

| 状态 | 对话走哪 | 型号 |
|---|---|---|
| `~/.helios/model.json` 有 `provider: deepseek` 且有 `apiKey` | `https://api.deepseek.com/v1` | 强制 `deepseek-v4-flash` |
| 未接入 | `https://aiproxy.{region}/v1`，确保一把名为 `helios` 的 Key | 该区域 `/api/models/enabled`：DeepSeek Flash 优先，否则 `gemini-3.5-flash` |

两条路都只把 `HELIOS_AI_BASE_URL` / `HELIOS_AI_KEY` / `HELIOS_AI_MODEL` 注入 eve 子进程。保存时明文过一次 IPC，落盘后渲染进程只看到打码（`getModelSettings` → `{ configured, hint? }`）。

保存：主进程 `GET https://api.deepseek.com/v1/models`，`Authorization: Bearer <key>`，超时 15s。2xx 才落盘并重启 eve。401/403 →「密钥无效」；其它 →「无法连接 DeepSeek」；空 →「请填写 API Key」，不发请求。不要用 completion 做校验。不要 `console.log` Key。

清除：不再算已接入；已登录则重启 eve，回到 AI Proxy。退出登录、切工作空间 **不清** Key（DeepSeek 账户是人的，不是 namespace 的）。没 Key 时不禁止对话。

只接 DeepSeek。没有模型选择器。`apps/eve/agent/agent.ts` 不必为选路改协议。

IPC：`saveDeepseekKey` / `clearDeepseekKey` / `getModelSettings`。

## 更新

无 Apple Developer ID，不能替换正在运行的 `.app`。探测地址和 dmg 必须是无需登录的 HTTPS。源码仓保持私有。

公开仓 [norberia/helios-release](https://github.com/norberia/helios-release)：

| 文件 | 地址 |
|---|---|
| 清单 | `https://raw.githubusercontent.com/norberia/helios-release/main/latest.json` |
| 安装包 | Release 附件 `Helios-{version}-mac-arm64.dmg` |

`latest.json`：`version` + 中文 `notes` + `url`（必须是该仓 `releases/download/` 前缀）+ `sha256`（64 位小写 hex）。缺字段、版本不比当前新、或 url/sha256 不合格：当作没有更新。

用户看见：启动查一次，之后每 30 分钟。失败当没发生。有新版本：侧栏 logo 右上角绿点；悬停浮层版本 + notes；点下去把 dmg 下到 `~/Downloads`，校验 sha256，系统打开。Helios **不退出、不替换自己**。侧栏收起或登录页：不出绿点。

IPC：`getUpdateStatus` / `downloadUpdate` / `onUpdateEvent`。渲染进程不碰清单 URL。不用 `electron-updater`。

发版命令只在用户明确说发版时执行，见 `.cursor/rules/publish-mac.mdc`。

## 工程约定（已定，不要另开一条）

- npm workspaces；依赖从仓库根安装；`engines.node` 24.x（eve 锁定）。
- `electron` 依赖钉精确版本（electron-builder 在 workspace 提升安装下不接受范围版本）。
- 本地开发 `electron-vite dev --watch`：主进程/preload 热重启；只有渲染进程能 HMR。
- 首页布局对齐 Lovable 实测尺寸；配色是白底 + logo 金，不是 Lovable 配色。
- macOS 图标：1024 画布、主体 824、四周 100px 真透明。不要用 `qlmanage` 转 SVG。
- 不做：Web 版、移动端、自建云端后端、多项目管理面板、独立成本中心、团队协作产品（工作空间切换已有）。

## 不要

- 渲染进程直连 Sealos / eve / DeepSeek / GitHub
- 把 GitHub token 打进 App
- 签名、公证、静默替换、Windows / Linux / Intel 包
- 多厂商 BYOK、没 Key 时禁止对话
- 用「更干净的设计」另造一套 Sealos 协议
