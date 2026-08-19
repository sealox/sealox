# Helios

桌面操作台：把项目丢进来，agent 部署到 Sealos，同一屏看见并点进真实资源。不是 Sealos 控制台翻版，也不是为做 agent 而做的 agent 应用。

当前功能以本文档为准。`docs/versions/` 是落地史；eve 内置 [use-sealos](../apps/eve/agent/skills/use-sealos/SKILL.md) 是对话里怎么操作 Sealos，不要抄进这里。

## 资源模型

Helios 不另造对象。桌面名字对应 Sealos 已有实体，口径与控制台同一套标签：

| Helios | Sealos | 备注 |
|---|---|---|
| 工作空间 | namespace `ns-xxx` | 切空间换 kubeconfig，重启 eve |
| 项目 | `instances.app.sealos.io` | 模板实例；名下资源带 `cloud.sealos.io/deploy-on-sealos=<instance>` |
| 应用 | Deployment / StatefulSet | Launchpad 管理的带 `cloud.sealos.io/app-deploy-manager` |
| 数据库 | KubeBlocks `Cluster` | 详情能连、能看结构、能对实例动手 |
| 存储桶 | `ObjectStorageBucket` | 只有列表；随项目删除 |
| 对话 | 本地 JSON + eve session | Helios 自己存全文；eve 没有历史列表接口 |

区域是一个集群 + 域名（如 `usw-1.sealos.io`）。BFF host 拼 `https://{provider}.{regionDomain}`，region 优先 `~/.sealos/auth.json` 的 `region`，不要用 kubeconfig 里的 `apiserver.*`。

## 两层结构

1. **做事**都经 Electron 主进程，渲染进程不直连 Sealos / eve。
   - **模糊意图** →「开始」→ 本地 eve（bash + use-sealos）→ Sealos。
   - **确定动作** → 按钮 → 主进程直调 Sealos 已有 API（模板部署、删除、重启、暂停/启动、开公网）。
2. **看见**：主进程读 namespace-scoped k8s API + 各 provider 监控/详情 BFF。本地不存业务状态。资源快照 15 秒刷新；监控 60 秒。

确定性强的动作不走对话。对话的确定性比按钮差。

## 仓库与进程

```
apps/electron/   唯一客户端（electron-vite + React）。IPC 面：window.helios（shared/types.ts）
apps/eve/        本地 agent。登录后主进程拉起，127.0.0.1:24721
```

- 开发：`eve dev --no-ui --host 127.0.0.1 --port 24721`。打包：跑 `.output/server/index.mjs`，捆绑 Node 24。
- eve 鉴权：开发 `localDev()`，打包 `httpBasic(helios / 本地密码)`。
- bash 在用户本机跑（`helios-host`），`HOME` 为 `~/.helios/home`（`.sealos` 软链到真实 `~/.sealos`）。源码构建还要本机 `python3` / `kubectl` / `docker`。
- 模型：有 DeepSeek Key 走 `https://api.deepseek.com/v1`（强制 `deepseek-v4-flash`）；没有则走工作空间 AI Proxy。密钥只进主进程和 eve 环境变量。

凭证与 skill 互认：`~/.sealos/kubeconfig` + `auth.json`（`regional_token` + `app_token`）。Helios 自己的状态在 `~/.helios/`（对话、模型 Key）。细节见 [platform.md](references/platform.md)。

## 先分类，再动手

改 Helios 或解释现状时，先判定属于哪条，再打开对应 reference：

1. **用户已经决定要做的那一件**（部署这张模板、删除这个项目、重启、暂停/启动、开公网）→ 按钮，主进程 API。[deploy.md](references/deploy.md) / [operate.md](references/operate.md) / [databases.md](references/databases.md)。
2. **意图模糊**（「帮我部署 n8n」「这个库连不上」）→「开始」对话，eve + use-sealos。[chat.md](references/chat.md)。
3. **看见世界**（列表、详情、拓扑、监控、AI Proxy）→ 只读快照与按需详情。[see.md](references/see.md)。
4. **登录、工作空间、模型 Key、更新探测** → [platform.md](references/platform.md)。

不要把 1 改成 2（点删除不要先开一轮聊天）。不要把 2 改成控制台表单。

## Routing

| 意图 | Reference |
|---|---|
| 侧栏、列表、详情、拓扑、AI Proxy、刷新口径 | [see.md](references/see.md) |
| 「开始」对话、历史、停止、提问、附件 | [chat.md](references/chat.md) |
| 模板按钮部署；对话三条部署路径怎么接到 Helios | [deploy.md](references/deploy.md) |
| 删除 / 重启 / 暂停 / 启动 / 批量 | [operate.md](references/operate.md) |
| 数据库详情、连接、结构、公网、问 Helios | [databases.md](references/databases.md) |
| 登录、工作空间、凭证、模型 Key、更新、本地文件 | [platform.md](references/platform.md) |

只读任务需要的那一两篇。Sealos YAML、kubectl 排障、商店模板怎么写，读 eve 里的 use-sealos，不要在 Helios 文档里复制。

## 执行规则

1. **查 Sealos API 对着源码，不发明。** host、路径、鉴权头、错误体以 labring/sealos 为准（见 `.cursor/rules/sealos-source.mdc`）。Helios 只消费已有能力。
2. **渲染进程不直连 Sealos / eve。** 新能力走主进程 + `window.helios`。不要用 `useEveAgent`，开发态 CORS 和打包后 `file://` 都过不去。
3. **模糊走对话，确定走按钮。** 不要为删除/重启/模板部署再开一条 eve 会话。
4. **不要搬控制台。** 模板不做全量表单；数据库不做 SQL/八个 tab；应用不做镜像/副本/环境变量表单（配置变更走「开始」）。
5. **部署成功 = 公网 URL 真能打开。** 模板按钮的导航只等受理（201/200），不要在 201 时 toast「部署成功」。
6. **列表和项目详情不展示 secret 明文。** 数据库详情页是例外（连接就是那页的工作）；密码默认打码。
7. **本地不存 Sealos 业务状态。** 对话 JSON 和模型 Key 除外。资源以 API 为准，15 秒轮询。
8. **删除弹框确认；重启/暂停/启动点下去就是。** 不要 `window.confirm`。批量删除一次确认整批。
9. **Launchpad 之外的工作负载只读。** 没有 applaunchpad 这套 API，不要另造协议。
10. **新范围先写 `docs/versions/0.x.md`，再改代码。** 已完成版本里的能力不要重做。「本版明确不做」不是待办。
11. **use-sealos 是拷贝，不会自动同步** sealos-skills-next。改对话部署行为改 eve 那份 skill，不要在 Electron 里重写决策树。

## 仍敞着的口

这是现状，不是本文件的实现清单：

- 「开始」输入框写着拖文件夹 / 粘贴 git，**入口没做**；对话里三条部署路径可用。附件是选文件进对话，不是部署入口。
- 源码构建依赖本机 `python3` / `kubectl` / `docker`，没有则失败。
- 日志是按需快照，不是实时流。失败没有结构化诊断页。
- 存储桶没有详情；应用配置没有表单。

## 与 versions 的关系

| 读什么 | 何时 |
|---|---|
| 本文 + 相关 [references/](references/see.md) | 解释或改**当前**功能 |
| [versions/vision.md](versions/vision.md) | 为什么存在、产品边界、已定架构 |
| [versions/0.x.md](versions/vision.md) | 某能力是否已做、开新版本时的范围 |
