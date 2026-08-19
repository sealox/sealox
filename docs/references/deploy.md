# 部署

两条入口，汇合到同一个 Instance CR。项目列表不分叉。

| 入口 | 谁做 | 何时 |
|---|---|---|
| 模板页「部署」 | 主进程直调 Template API | 用户已经点中一张商店模板 |
| 「开始」打字 | eve + use-sealos | 意图还没分类，或源码/镜像/排障 |

点卡片已经选好模板，不要再让模型 `store-list`。对话仍留给自然语言和起来之后的排障。

## 按钮：商店模板进当前工作空间

IPC：`getTemplateDetail(templateName)` → `deployTemplate(templateName, args?)`。

工作空间以侧栏胶囊为准，不问「部署到哪」。实例名 `{templateName}-{random8}`（k8s DNS 子域、≤63；超长截短模板段），不问用户。

### 用户看见

1. 点「部署」：该按钮立刻变「提交中」并禁用，防连点。其它卡片照常可点。不弹「确认部署吗」。
2. GET 详情，只处理 `required: true` 且没有非空 `default` 的 `args`。绝大多数模板这一步是空的。
3. 有必填（API Key、邮箱）：**卡片上展开一小条**，名称含 key / secret / token / password 的用 password。填完按钮变成「部署到 {当前工作空间名}」。不要抄控制台整页表单（可选环境变量、规格、README、价格都不做）。
4. 配额：GET 带的 `quota` 和侧栏同源的 `ResourceQuota` 比较；不够就停在卡片上，不发 POST，也不偷偷改小 CPU/内存。GET 没有配额数字时不要因此拦截。
5. POST 失败：人不走，错误钉在这张卡片上。
6. POST 200/201：切到「项目」tab，打开该实例详情，刷新快照。不 toast「部署成功」（那时往往还在拉镜像）。不新做进度页，不自动跳「开始」。

三次「完成」：

| 时刻 | 含义 | 用户看到 |
|---|---|---|
| 受理 | Template API 200/201，Instance CR 已写入 | 离开模板页，打开项目详情 |
| 就绪 | 应用 / 数据库变成运行中 | 详情顶栏状态变化（15 秒轮询） |
| 可访问 | 公网 URL 返回真页面 | URL 可点；未就绪点开 503 是预期，不要藏 URL |

导航只等受理。

### API

源码：`frontend/providers/template`。鉴权：`Authorization: encodeURIComponent(kubeconfig)`。超时 120s 量级。host 优先 `auth.json` 的 `region`。

| 动作 | 方法 | 路径 |
|---|---|---|
| 目录 | GET | 官网 `/api/apps/en`（主进程缓存 30 分钟） |
| 详情 | GET | `https://template.{region}/api/v2alpha/templates/{name}`（公开，不鉴权） |
| 部署 | POST | `https://template.{region}/api/v2alpha/templates/instances` |

- GET 200：`{ name, args, quota, ... }`。`args` 是 `Record<string, { description, type, default, required }>`，不是数组。
- POST body：`{ name, template, args? }`。`template` 用目录里的 `templateName`，不是展示名。
- POST 200 与 201 都当受理。跳转用响应里的 `name`。
- 错误体：`{ error: { type, code, message, details? } }`。映射到卡片短文案，不要整段 JSON。

409：create 不原子，有时其实成功了。先读当前 ns 的 `instances.app.sealos.io`（不要改走 `template.{region}/api/instance/list`）。有则当受理跳转；没有则换新随机名再 POST 一次。第二次仍失败再报错。

实现：`apps/electron/src/main/sealos/templates.ts`。卡片标题仍可外开 sealos.io 详情（那是文档，不是部署）。

## 对话：三条路径

分类在 use-sealos 决策树，Helios 只提供「开始」和工具活动时间线。不要在 Electron 里重写分类。

1. 模板店有现成模板 → Template API（与按钮同一类 Instance）。
2. 有官方 Docker 镜像 → 生成模板部署。**有官方镜像就不要从源码构建。**
3. 用户自己的源码 → Dockerfile → linux/amd64 构建 → 推镜像 → 部署。依赖本机 `python3` / `kubectl` / `docker`。

配套资源（数据库、对象存储、公网域名）由 agent 按项目需要创建。成功标准与 skill 一致：`wait-app.sh` 退出 0 **且** 公网 URL 返回真页面。否则如实报失败。

从「开始」说「部署 n8n」走 Path A，和模板页点 n8n 进同一个项目模型。

## 第一反应

| 现象 | 做法 |
|---|---|
| 400 缺参 | 展开卡片必填条，不跳走 |
| 403 / 余额 / 配额 | 钉在卡片；不要改小规格重试 |
| 409 | 先看 Instance 是否已落地，再决定跳转或换名 |
| 对话源码路径报 docker/kubectl 不存在 | 如实说本机缺 CLI；不要假装 Helios 内置了构建集群 |
| 201 之后 pod 还在 ImagePull | 正常。看详情状态，不要再 POST 一次 |

## 不要

- 点部署开浏览器
- 为这次部署新建一条聊天，或把进度流进 eve
- 让用户填实例名、选工作空间
- 部署失败自动拉起 agent
- 按钮路径再做一遍 `wait-app`（和 15 秒轮询重复）
- 控制台那种部署页
