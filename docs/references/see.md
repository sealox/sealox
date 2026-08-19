# 看见

侧栏和详情负责诚实展示当前工作空间。数据都由主进程拉，渲染进程只画 `window.helios` 给的快照和详情。

## 侧栏

左 256px。工作空间胶囊在顶上（点开见 [platform.md](platform.md)）。

主导航两组：

| 组 | 入口 |
|---|---|
| 高频 | 开始、模板、项目 |
| 资源 | 应用、数据库、存储、AI Proxy |

「最近」是最新项目，点进项目详情。底：配额卡（CPU/内存/存储/GPU 的 used/limit，直读 namespace `ResourceQuota`）+ 头像进设置 + 全局刷新。

侧栏 logo 点回「开始」。有更新时绿点见 [platform.md](platform.md)。

## 快照

`getResources()` → `ResourceSnapshot`。登录后 15 秒轮询，切工作空间立刻重拉。本地不缓存业务对象。

列表口径：

| Tab | 收什么 | 卡片能点？ | 确定动作 |
|---|---|---|---|
| 项目 | `instances.app.sealos.io` | 进详情 | 卡片删除；可多选批量（见 [operate.md](operate.md)） |
| 应用 | 带 `cloud.sealos.io/app-deploy-manager` 的 Deployment/StatefulSet | 进详情 | 同上。不带该标签的在「Launchpad 之外的工作负载」，只读 |
| 数据库 | KubeBlocks `Cluster` | 进详情 | 列表上没有暂停/删除；动作在详情顶栏 |
| 存储 | `ObjectStorageBucket` | 不进详情 | 无。随项目删除 |
| 模板 | sealos.io 商店目录（主进程 30 分钟缓存） | 标题外开官网 | 「部署」见 [deploy.md](deploy.md) |
| AI Proxy | `aiproxy-web.{region}` 用户 BFF | 单页 | 创建/启用/禁用/删除 Key |

项目卡片状态由名下应用 + 数据库聚合：异常 > 处理中 > 运行中 > 已暂停。应用停了但库还在跑 → 运行中。故障 pod 的原因和重启次数标红。

公网域名在卡片/节点上可点，系统浏览器打开，不进详情。

## 详情栈

`DetailEntry`：`project` | `app` | `database`。面包屑可互跳。切工作空间 / 切 tab 清空栈。按需 IPC，15 秒轮询该详情。

### 项目

`getProjectDetail(name)`。顶栏：备注名、模板 chip、聚合状态、[operate.md](operate.md) 四个动作。

统计条：应用/数据库/存储桶/定时任务数、创建时间。异常 Pod 横幅点进对应应用。

**拓扑**（不是编辑器）：应用在上、库和桶在下。公网 URL 是应用节点副标题。PVC 是节点页脚，不是独立节点。定时任务和配套资源仍是下面的列表。

边只画能从工作负载 env **证实**的引用（明文不进渲染进程）：

1. secret 名 = `{db}-conn-credential`，或 `{db}-` 前缀且含 `conn-credential` / `-account-`。
2. env 字面量含该库 in-namespace host 片段。
3. 桶：字面量等于 CR 名或 `status.name`；或 secret 以 `object-storage-key-` 开头并以 `-{bucket}` 结尾。

回退：整个项目一条边都没有、且只有一个应用 → 把这个应用连到名下全部库和桶（商店模板常把 host 写在配置文件里）。多应用不做这个回退。

点应用节点进应用详情（必须走 React Flow `onNodeClick`，否则节点点不透）。点库节点进数据库详情。点桶不跳。不能连线、不能拖节点、滚轮滚的是详情页不是缩放。

没有应用/库/桶、只有定时任务：不画布。

配套资源按 kind 分组（Secret/ConfigMap/Service/Job/PVC/…），排除数据库内部 `sealos-db-provider-cr`。

### 应用

`getAppDetail` + `getAppMonitor`。与 App Launchpad 同口径、单页分区：

- 统计条：状态、副本+HPA、CPU/内存限额、持久存储、创建时间
- CPU/内存曲线：`https://applaunchpad.{region}/api/monitor/getMonitorData`，kubeconfig 鉴权，近 1 小时，60 秒轮询，序列过滤到当前存活 pod
- 网络：端口 / 集群内 / 公网 / 自定义域名
- Pods：行内展开；`getPodLogs` 尾部约 400 行 + 崩溃前日志。按需快照，不是 watch
- 配置：镜像、命令、环境变量（`valueFrom` 只显示引用名）、ConfigMap、PVC
- 事件：workload + RS + pod，Warning 标红

Launchpad 之外：能看列表，没有重启/暂停/启动/删除。

### 数据库

见 [databases.md](databases.md)。

## AI Proxy

对标「接入即文档」，不是对话模型设置。对话 Key 在设置页（[platform.md](platform.md)）。

数据：`https://aiproxy-web.{region}`，鉴权用 desktop `app_token`；30 秒轮询。

- 接入卡：`https://aiproxy.{region}/v1` + curl/Python/JS 示例
- 用量：近 7 天，`/api/user/dashboard?type=week`
- Keys：`/api/user/token*`。创建后一次性展示全文；列表打码。Helios 还会确保一把名为 `helios` 的 Key 给 eve（仅未接入自己的 DeepSeek Key 时）
- 模型目录：`/api/models/enabled`

## 不要

- 为看见层另做本地数据库
- 发明「拓扑 API」或把 Instance CR 当图
- 存储桶详情页
- 把监控 URL 写成自己想象的路径
- 在渲染进程里解码 kubeconfig 或 secret 明文
