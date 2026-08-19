# 确定动作

删除、重启、暂停、启动。用户已经决定要做，点按钮比再打一遍字准。配置类变更（镜像、副本、环境变量）仍走「开始」。

做事在主进程，不经过 eve。批量是渲染进程对选中名字逐个调已有 IPC，**不发明** Sealos `/batch`。

## 模型

| 对象 | 是什么 | 本页提供 |
|---|---|---|
| 应用 | 带 `cloud.sealos.io/app-deploy-manager` 的 Deployment / StatefulSet | 删 / 重启 / 暂停 / 启动 |
| 项目 | Instance CR + 名下应用/库/桶 | 删除打 Template API；重启/暂停/启动 = 对名下 Launchpad 应用 + KubeBlocks 库逐个打 |
| 数据库 | KubeBlocks Cluster | 详情顶栏四动作；列表上没有。见 [databases.md](databases.md) |
| 存储桶 | ObjectStorageBucket | 无暂停接口。随项目删除走 |
| Launchpad 之外 | 无 applaunchpad API | **不提供**任何变更 |

项目没有实例级 restart/pause/start。对象存储和定时任务：项目暂停/启动/重启时不动。

## 用户看见

### 列表

项目卡片、Launchpad 应用卡片右上角「删除」。点删除不进详情。

多选只在**项目** tab 和 **应用** tab 的 Launchpad 卡片上。两个 tab 的选择互不相干。数据库 / 存储 / Launchpad 之外没有勾选。点勾选不进详情。

选中 ≥ 1：操作栏「已选 N 个 · 全选 / 取消 · 暂停 · 启动 · 重启 · 删除」。切 tab / 切工作空间清空选择。

混选：有不是「已暂停」的就出暂停，有「已暂停」的就出启动，重启和删除一直在。暂停只打还在跑/处理中的；启动只打已暂停的；重启打全部选中项。

删除弹框，**一次确认整批**，不要 `window.confirm`：

| 对象 | 要点 | 主按钮 |
|---|---|---|
| 多个项目 | 将删除 N 个项目；合计带走 X 应用、Y 库、Z 桶；不可恢复。列出备注名（多了截断） | 删除 N 个项目 |
| 多个应用 | 将删除 N 个应用；不可恢复。其中 M 个属于项目时写明只删应用、不拆项目 | 删除 N 个应用 |

进行中整栏禁用。某个失败：已成功的不回滚；失败名单钉在操作栏；选择保留；快照仍刷新。全部成功：关栏、清空选择、刷新快照。

详情页保持单条，不在详情里多选。

### 详情顶栏

项目、Launchpad 应用、数据库：删除、重启、暂停或启动。重启/暂停/启动不二次确认。删除一律弹框。进行中禁用同类动作。失败钉在页上（或弹框里），人不走。成功后刷新该详情和快照。

应用已暂停 → 顶栏「启动」，否则「暂停」。项目名下有的在跑、有的停着：暂停和启动可以同时出现。

项目暂停：先应用后数据库。启动：先数据库后应用。已 Stopped/Stopping 的库跳过暂停；已 Running/Starting 的库跳过启动。重启：应用全部 + 未停止的库。名下既没有 Launchpad 应用也没有数据库：暂停/启动/重启直接成功，只留删除。

项目聚合状态：异常 > 处理中 > 运行中 > 已暂停。KubeBlocks 停库是异步的（Running → Stopping → Stopped），过渡态显示「处理中」。

### 删除确认

| 对象 | 要点 | 主按钮 | 另给一条路 |
|---|---|---|---|
| 项目 | 备注名和实例名；带走 N 应用 / N 库 / N 桶；不可恢复 | 删除项目 | 取消 |
| 独立应用 | 确定删除「名字」；不可恢复 | 删除应用 | 取消 |
| 属于项目的应用 | 是项目的一部分。只删这个应用，库和其它应用还在 | 只删除这个应用 | 「去项目」 |
| 属于项目的库 | 删库可能让应用连不上 | 只删除这个数据库 | 「去项目」 |

成功：关弹框、刷新快照。若正在看被删的那条详情，退回列表（或栈上还在的项目）。

应用删除：只拆这一个 Launchpad 应用；StatefulSet 的 PVC 默认留下（Sealos 如此）。Helios 不要自己再删 PVC。

项目删除：Template API 会扫掉实例标签下的应用、数据库、存储、PVC。Helios 不要自己再扫一遍。404（实例已不在）当成功。

## API

鉴权与模板部署相同：`Authorization: encodeURIComponent(kubeconfig)`。region 优先 `auth.json`。超时 120s。错误体 `{ error: { type, code, message } }` 映射短文案（登录失效 / 没有权限 / 不存在 / 服务暂不可用 / 该动作失败）。

实现：`apps/electron/src/main/sealos/operate.ts`。pause/start/restart 数据库与独立库详情共用，不要复制一份 HTTP。

### 应用（App Launchpad v2alpha）

`https://applaunchpad.{region}/api/v2alpha/apps/{name}`

| 动作 | 方法 | 成功 |
|---|---|---|
| 删除 | DELETE | 204（不存在也 204） |
| 重启 | POST `.../restart` | 204 |
| 暂停 | POST `.../pause` | 204（已暂停也 204） |
| 启动 | POST `.../start` | 204（未暂停也 204） |

IPC：`deleteApp` / `restartApp` / `pauseApp` / `startApp`。

### 项目删除（Template instance）

`DELETE https://template.{region}/api/v2alpha/templates/instances/{name}` → 204。IPC：`deleteProject`。

### 项目重启 / 暂停 / 启动

1. 列出当前 ns 里同时带 `cloud.sealos.io/deploy-on-sealos=<instance>` 和 `cloud.sealos.io/app-deploy-manager` 的 Deployment / StatefulSet（排除 `app.kubernetes.io/managed-by=kubeblocks`）。
2. 列出同一归属标签的 KubeBlocks `Cluster`。
3. 按上面的顺序逐个打 applaunchpad / dbprovider。有失败：报出组件名和原因；已成功的不回滚。

IPC：`restartProject` / `pauseProject` / `startProject`。列表用 k8s 客户端，不要为了列名字发明 BFF。

### 数据库

见 [databases.md](databases.md)。`DELETE/POST https://dbprovider.{region}/api/v2alpha/databases/{name}` 及 `.../pause|start|restart`。

## 不要

- `PATCH /apps/{name}` 配置表单
- 数据库 tab、存储 tab 的批量；跨 tab / 跨工作空间批量
- Launchpad 之外工作负载的任何变更
- 删除前的 agent 确认、失败自动拉起排障
- Sealos 没有的 batch 接口
