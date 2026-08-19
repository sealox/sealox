# 数据库

从「一张不能点的卡片」变成能看见、能连、能对实例动手的详情页。不把 Sealos dbprovider 的八个 tab 搬进来。

列表/项目详情仍只展示 secret **引用名**。本页是例外：连接就是这页的工作。

## 入口

- 数据库 tab 卡片 → 详情（tab 归位到「数据库」）
- 项目拓扑的数据库节点 → 详情（栈上保留项目）
- 项目详情若还有文字入口，同样进详情

存储桶仍然不进详情。列表上不做批量、不做暂停/删除（避免和 [operate.md](operate.md) 打架）。动作在详情顶栏。

## 详情（一页滚到底，不要 tab 栏）

对齐应用详情的分区方式。

**顶栏**：名字、引擎 chip、阶段点、所属项目 chip（点回项目）。暂停或启动、重启、删除（语义见 [operate.md](operate.md)）。属于项目的库，确认框写明是项目的一部分、删库可能让应用连不上，并给「去项目」。

**问 Helios**：切到「开始」，新对话，输入框预填（可改、不发送）：

```
请查看当前工作空间的数据库 {name}（引擎 {engine}，版本 {version}，状态 {phase}）。先不要改数据。我的问题是：
```

光标落在末尾。

**统计条**：状态、引擎+版本、CPU/内存限额、存储、创建时间。

**连接（主角）**：

- 集群内 host / port / username / password / connection string。
- 密码和 URI 默认打码；点「显示」揭开，再点收起。揭开是渲染进程本地 state，不要再打 IPC。
- 每项可复制明文（即使当时是打码）。
- 给一段 `DATABASE_URL`（或该引擎等价）示例，复制即用。
- 未 Running 或 secret 还没有：写「凭证尚未就绪」，不要假 URI。

**公网**：开关。关着只显示内网。打开后出现公网 host/port（或 Sealos 返回的 `publicConnection`），同样打码/揭开/复制。失败钉在这页。

**被谁使用**：本工作空间里 env 已证实引用该库的应用（复用拓扑规则，作用域换成这一份库；**不用**「单应用就全连上」的回退）。点应用进应用详情。一个都没有就写「没有应用通过环境变量引用它」，不要猜。

**结构**：逻辑库列表；每个库下列 table / collection 名。只读。点名字不要打开编辑器、不要跑 SQL。引擎不支持（Redis / Kafka / 向量库等，以 `getDatabases` 实际报错为准）：一句话「此引擎不列出表结构」+ 问 Helios。库未 Running：不 exec。

**健康**：近 1 小时 CPU / 内存 / 磁盘曲线。磁盘溢出（Sealos `isDiskSpaceOverflow`）用横幅。

**Pods + 事件**：和应用详情同一套展开 / 日志尾部 / Warning 标红。

15 秒刷新详情；监控 60 秒。连接明文只走详情 IPC，不要写进 `ResourceSnapshot`。

## API

源码：`dev-assets/sealos/frontend/providers/dbprovider`。鉴权：`Authorization: encodeURIComponent(kubeconfig)`。region 优先 `auth.json`。

详情/监控超时 15s 量级；pause/start/restart/delete/公网 120s。

`publicConnection` 在 schema 里写成 `string | null`，以 `get-database.ts` 运行时组装为准，不要凭类型猜。

| 动作 | 方法 | 路径 |
|---|---|---|
| 详情（连接、pods、quota、状态） | GET | `https://dbprovider.{region}/api/v2alpha/databases/{name}` |
| 删除 | DELETE | 同上（204；404 当成功） |
| 暂停 / 启动 / 重启 | POST | `.../databases/{name}/pause` \| `start` \| `restart` |
| 开/关公网 | POST | `.../enable-public` / `disable-public` |
| 监控 | GET | `.../api/v2alpha/monitor/data?dbName&dbType&queryKey=cpu\|memory\|disk` |
| 逻辑库名 | POST | `https://dbprovider.{region}/api/db/getDatabases` body `{ dbName, dbType }` |
| 表名 | POST | `.../api/db/getTables` body `{ dbName, dbType, databaseName }` |

后两条是控制台仍在用的 BFF（内部 exec 进 `{name}-{component}-0`），**不是** v2alpha。响应 `{ code, data, error }`，不要用 v2alpha 的 `{ error: { type, code } }` 去解。只对 postgresql / mysql / apecloud-mysql / mongodb 调；其它引擎不要打这条再把 500 丢给用户。

`dbType` 用 Cluster 的 `clusterDefinitionRef` / 标签，和 Sealos `DBTypeEnum` 对齐（MySQL 常常是 `apecloud-mysql`）。

pause/start/restart 已在 `operate.ts` 给项目用，导出给独立库 IPC。实现：`apps/electron/src/main/sealos/database.ts`。schema 的 getTables 在主进程内做完，渲染进程拿回树，不要让渲染进程循环打 IPC。

IPC：`getDatabaseDetail` / `getDatabaseMonitor` / `getDatabaseSchema` / `pauseDatabase` / `startDatabase` / `restartDatabase` / `deleteDatabase` / `enableDatabasePublic` / `disableDatabasePublic`。

对话里**创建**库、把库接到应用，仍走 use-sealos（[databases.md in skill](../../apps/eve/agent/skills/use-sealos/references/databases.md)），不要在 Helios 做创建表单。

## 不要

- SQL 输入框、Query tab、行编辑、spreadsheet
- Dataflow / phpMyAdmin / 在 app 内连上跑查询
- 创建库表单、YAML、PATCH CPU/内存/副本/参数
- Dump、跨网迁移、备份恢复向导
- 数据库 tab 批量；存储桶详情
