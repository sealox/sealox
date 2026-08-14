# Helios v1 开发文档

## 一句话定位

桌面 app：把项目丢进来，agent 负责部署到 Sealos，部署产生的全部资源清晰可见。
内部 MVP，用来证明 agent-first 的部署体验优于 Sealos 控制台。

## 背景

- use-sealos skill（sealos-skills-next 仓库）已在 Cursor 里验证了 agent 部署
  Sealos 的完整链路：登录、三条部署路径、数据库/存储/公网域名、部署后验证。
- v1 要做的事：把这条链路从"编码工具里的 skill"产品化成"任何人可用的桌面 app"。

## 功能范围

### 登录

- 首次启动登录 Sealos 账号，复用 skill 现有能力：OAuth2 device flow，或粘贴
  kubeconfig。
- 凭证沿用 skill 的约定存放在 `~/.sealos/`（kubeconfig + auth.json，0600），
  Helios 与 use-sealos skill 互认登录态。auth.json 里除 regional_token 外
  另存 `app_token`（desktop 发给 iframe 应用的会话 JWT，internalJwtSecret
  签名，aiproxy-web 等应用后端只认它）；登录与切换工作空间时随
  regionToken/namespace-switch 响应一起落盘，旧登录态缺失时用
  regional_token 重放一次 switch 无感补发。
- 登录后默认进私人工作空间；侧边栏工作空间胶囊可切换同账号下的任意工作
  空间（走 desktop 同款 API：namespace/switch 换发 token 再取新 kubeconfig，
  落盘 `~/.sealos/` 与 skill 互认）。

### 部署（唯一动作）

- 入口：拖入本地文件夹，或粘贴 git 地址。
- agent 按 use-sealos 的决策树自动分类：
  1. 模板店有现成模板 → Template API 一键部署；
  2. 有官方 Docker 镜像 → 生成模板部署；
  3. 用户自己的源码 → Dockerfile → linux/amd64 构建 → 推镜像 → 部署。
- 配套资源（数据库、对象存储、公网域名）由 agent 按项目需要自动创建。
- 全程实时进度流：当前动作、关键决策、报错与自救过程。
- 成功标准与 skill 一致：workload ready 且公网 URL 返回真实页面，否则如实报告
  失败原因。

### 主界面与资源展示

- 布局：左侧 256px 侧边栏 + 右侧内容区，视觉与结构对齐 Lovable 桌面版首页
  （从 lovable.dev/dashboard 实测 DOM/样式复刻）。
- 侧边栏：工作空间胶囊，点开是 Lovable 式面板——当前空间信息（私人/团队、
  角色、成员数）、成员列表（头像+角色）、邀请成员（生成管理员/开发者邀请
  链接并复制，`/WorkspaceInvite/?code=` 落地页与 desktop 一致）、重命名
  （仅拥有者）、切换工作空间、新建工作空间、底部 Upgrade 栏（跳 region 的
  费用中心）；  权限门控与 desktop 相同（邀请需拥有者/管理员）。主导航按点击频率分两组：
  高频组**开始、模板、项目**＋"资源"组**应用、数据库、存储、AI Proxy**；"最近"区展示
  最新项目；底部工作空间配额卡（CPU/内存/存储/GPU 的 used/limit，直读 namespace 的
  ResourceQuota——与 costcenter usage 接口同源，随资源快照 15s 轮询刷新）；
  头像入口进**用户信息**，右下角全局刷新。
- **开始**（默认页）：白底＋logo 淡金日光背景（Sealos 中性调性，金色只做
  点缀）+ 居中输入框（标题"今天想开发点什么？"）已接到本地 eve：发送后流式
  显示模型回复。拖入文件夹 / 粘贴 git / 真正部署仍是 M2。模板建议 chips 只
  填输入框。右下角常驻 "Hi · Follow me on X" 胶囊（X logo，点击外部浏览器
  打开 x.com/norberia_cz）。
- **项目**：项目 = 模板实例（namespace 里的 `instances.app.sealos.io` CR，
  与 Template 前端同源直读，不再依赖 template.{region} 服务），由多个组件
  （应用、数据库、存储桶）构成，归属由 `cloud.sealos.io/deploy-on-sealos`
  标签确定。一个项目一张卡片，聚合展示：
  - 状态由项目名下的应用与数据库聚合，优先级：异常 > 启动中 > 运行中 >
    已暂停；
  - 模板图标与备注名（displayName 注解）、模板名、应用/数据库/存储桶数量、
    创建时间；
  - 公网域名（点击用外部浏览器打开）；
  - 故障 pod 的原因与重启次数（标红展示）。
- **应用**：与 App Launchpad 同一口径——带 `cloud.sealos.io/app-deploy-manager`
  标签的单个工作负载（Deployment/StatefulSet）。逐个展示状态、副本、镜像、
  公网域名与所属项目 chip；不带该标签的工作负载在"Launchpad 之外的工作负载"
  小节单独展示，保证所见与 Sealos 实际状态一致。
- **详情页**（项目/应用卡片点击进入，面包屑导航栈支持项目 ↔ 应用互跳，
  侧边栏"最近"直达项目详情）：
  - **项目详情**：图标+备注名+模板 chip+聚合状态、GitHub/官网外链、统计条
    （应用/数据库/存储桶/定时任务数、创建时间）、异常 Pod 聚焦横幅（点击跳
    对应应用）、公网入口列表、组件分区——应用（点击进应用详情）、数据库
    （引擎/版本/规格/连接凭证 secret 名）、对象存储（策略/实际桶名）、定时
    任务（schedule/暂停态/上次运行）、配套资源（Secret/ConfigMap/Service/
    Job/PVC/SA/Role/Issuer/Certificate/App CR 按 kind 分组，排除数据库内部
    资源 `sealos-db-provider-cr`）。
  - **应用详情**：与 App Launchpad 详情同口径、单页分区呈现——统计条（状态/
    副本+HPA 范围/CPU/内存限额/持久存储/创建时间）、CPU/内存监控曲线（走
    applaunchpad 公开 API `applaunchpad.{region}/api/monitor/getMonitorData`，
    kubeconfig 鉴权，近 1 小时、60s 轮询，序列过滤到当前存活 pod）、网络表
    （端口/集群内地址/公网地址/自定义域名标记，service 按 label、同名或
    selector 匹配）、Pods 表（行内展开：容器状态 chips、按需拉取日志尾部
    400 行、崩溃前日志、复制全部）、配置（镜像/命令/环境变量表——valueFrom
    只显示引用不显示明文、ConfigMap 挂载、持久卷）、事件流（workload+RS+pod
    聚合，Warning 标红）。
  - 详情数据按需拉取（`sealos:app-detail` / `sealos:project-detail` IPC），
    15s 轮询；切工作空间/切 tab 时导航栈清空。
- **模板**：sealos.io 应用商店目录（212+ 模板，官网 `/api/apps/en`，主进程
  30 分钟缓存）——分类/搜索/排序/分页，卡片样式对齐官网（浅色适配）；模板名
  跳官网详情，"部署"按钮暂以外部浏览器打开用户 region 控制台的模板部署页，
  M2 改走 agent。
- **数据库**：KubeBlocks Cluster 列表——引擎、版本、阶段、所属实例。
- **存储**：ObjectStorageBucket 列表——策略（私有/公开读/公开读写）、实际
  桶名、创建时间。
- **AI Proxy**：交互对标 Vercel/Cloudflare AI Gateway 的"接入即文档"思路，
  单页四区：
  - 接入卡：OpenAI 兼容端点（`https://aiproxy.{region}/v1`）+ curl/Python/JS
    示例代码（自动带第一个启用的 Key 与可用模型，复制即用）；
  - 用量概览：近 7 天请求数/Tokens/花费/异常统计条 + 请求数/花费按天曲线
    （`/api/user/dashboard?type=week`）；
  - API Keys：行内创建（创建后金色高亮一次性提示复制）、sk- 打码展示/复制
    全文、启用/禁用、行内二次确认删除（`/api/user/token*`）。Helios 自己
    还会确保一把名为 `helios` 的 Key 给本地 eve 用（见架构）。
  - 模型目录：搜索 + 厂商过滤 chips，类型/RPM/输入输出价（原始 /1K 换算
    /1M 展示）（`/api/models/enabled`）。
  - 数据源：aiproxy-web.{region} 的用户侧 BFF，鉴权用 desktop 应用会话
    token（见工程约定）；30s 轮询。
- **用户信息**：区域、API server、命名空间、工作空间、登录时间、kubeconfig
  路径；退出登录放在此页。
- 数据规则：全部直读 Sealos 现有 API（namespace-scoped k8s API +
  applaunchpad 监控 API），本地不存业务状态；15 秒自动刷新 + 手动刷新；
  数据库/环境变量只展示 secret 引用名，不显示明文。
- 留给 M3：日志实时流式（详情页已有按需日志快照）、失败诊断（agent 读
  日志/events 输出人话结论）、以项目为单位的整体删除（需二次确认）。

## 非目标（v1 明确不做）

- 多项目管理面板、独立成本中心、区域切换
- 团队协作（工作空间切换已在 v1 落地）
- Web 版、移动端
- 自建云端后端和自建数据库（本地 eve 是桌面进程，不是云服务）

## 架构（已定的部分）

- **仓库结构**：npm workspaces monorepo，两个 app——`apps/electron`（桌面端）
  和 `apps/eve`（本地 agent 服务）。eve 已作为后台 AI 跑通首页对话；部署
  决策树仍待 M2 从 use-sealos skill 移植。
- **Electron**：唯一客户端。UI 栈：electron-vite + React + TypeScript；浅色
  主题。渲染进程不直连 eve（开发态跨端口 CORS、打包后 `file://` 同源都过不
  去）：主进程 HTTP 调 eve，对话经 IPC 流到首页。
- **Vercel eve（本地运行）**：登录后主进程在后台拉起
  `eve dev --no-ui --host 127.0.0.1 --port 24721`，退出/登出杀掉，切换工作
  空间则换凭证重启。路由走 eve 默认 HTTP（`POST /eve/v1/session`、
  `GET /eve/v1/session/:id/stream`）。当前切片关掉了 bash/文件/联网等内置
  工具，只对话。
- **模型凭证**：不走 Vercel AI Gateway。主进程向当前工作空间的 AI Proxy 确
  保一把名为 `helios` 的 Key（没有就创建，停用就打开），密钥只进 eve 子进
  程环境变量（`HELIOS_AI_BASE_URL` / `HELIOS_AI_KEY` / `HELIOS_AI_MODEL`），
  不进渲染进程。模型按该区域 `/api/models/enabled` 选择：聊天模型里优先
  DeepSeek Flash（id 或厂商含 `deepseek` 且含 `flash`，`deepseek-v4-flash` /
  `deepseek-flash` 优先），没有则回退 `gemini-3.5-flash`。eve 用
  `@ai-sdk/openai-compatible` 直连 `https://aiproxy.{region}/v1`。
- **Sealos**：零改动，只消费现有 API。
- **品牌**：logo 采用 Sealos 官方 mark 的金色重配色，源资产在根 `assets/`
  （blackgold 黑底、whitegold 白底两版）。侧边栏用无底纯金标
  （`src/renderer/src/assets/sealos-logo-gold.svg`，whitegold 去底）；登录/
  加载页用 `logo.svg`；应用图标用 whitegold（与侧边栏同一套金，dock 与应用内
  观感一致）——dev 下主进程 `app.dock.setIcon(resources/icon.png)`，打包由
  electron-builder 从 `build/icon.png` 生成。
- 数据流：对话 / 部署动作走 Electron 主进程 → 本地 eve → Sealos AI Proxy
  （模型）或 Sealos API（部署，M2）；资源展示走 Electron → Sealos API 直连。

## 工程约定

- k8s 访问用 `@kubernetes/client-node` 2.x（对象参数风格、直接返回 body）；
  Electron 39（Node 22+）可以直接加载纯 ESM 依赖，无需特殊打包处理。
- `electron` 依赖钉精确版本（当前 `39.8.10`）：electron-builder 在 workspace
  提升安装下不接受范围版本。
- 本地开发用 `electron-vite dev --watch`：主进程/preload 改动自动热重启；
  只有渲染进程能靠 HMR，不开 watch 时主进程改动不会生效。
- 依赖统一从仓库根安装（npm workspaces）；根 `package.json` 的
  `engines.node` 由 eve 脚手架锁定为 24.x。
- 主进程与渲染进程的共享类型集中在 `apps/electron/src/shared/types.ts`，
  preload 暴露的 `window.helios` API 接口也定义在这里。
- macOS 应用图标规范：1024 画布、主体 824 居中、四周 100px **真透明**边距，
  否则 Dock 里显得偏大且有白边。注意 `qlmanage` 转 SVG 会把透明区填成白色，
  生成要走 Chromium canvas：`npx electron apps/electron/scripts/gen-icon.mjs
  <svg> <png>`。
- 首页布局与尺寸对齐 Lovable（lovable.dev/dashboard 实测值，oklch 原值直接
  可用，Electron 39 的 Chromium 支持）；配色不随 Lovable——背景为白底＋
  logo 金（`#F0BE4E`/`#EDC868` 低透明度光晕），高饱和点缀色只保留金色系。

## 参考

- use-sealos skill：`/Users/che/Documents/GitHub/sealos-skills-next`
  （部署决策树、`sealos-api.py`、`wait-app.sh`、references/ 下的平台约定）
- Sealos 源码：`/Users/che/Documents/GitHub/sealos`
  （控制台各前端实际调用的 API 定义）；仓库内 `dev-assets/sealos` 有
  applaunchpad/dbprovider/template 三个前端的 sparse clone，详情页的字段
  口径（标签/注解约定、监控 API、实例 CR）都以它为准
- Sealos 资源模型：namespace（`ns-xxx`）、app label
  `cloud.sealos.io/app-deploy-manager`、KubeBlocks `Cluster` CR、
  `ObjectStorageBucket` CR、region domain（如 `usw-1.sealos.io`）
- eve 文档：以安装后的 `node_modules/eve/docs/` 为准（README 有阅读顺序），
  脚手架 `npx eve init`；线上文档 <https://eve.dev/docs>

## 未决问题

1. 源码构建依赖：v1 是否要求用户本机有 docker；没有 docker 时的降级方案。
2. 日志"实时"的实现程度：轮询还是 watch（M3 确认）。
3. 打包后的 eve：当前 dev 用 `eve dev`（`localDev()` 鉴权）。dmg 需改为
   `eve build` + `eve start`，并换掉 `placeholderAuth`（例如主进程与 eve
   共享 jwtHmac / httpBasic）。

## 里程碑

1. **M1 只读链路**（已完成，2026-08-13）：Electron 壳 + 登录 + 侧边栏资源
   展示；之后补了项目/应用详情、工作空间面板、AI Proxy 页。
2. **M2 部署链路**（进行中，2026-08-14）：本地 eve 已作为后台 AI 服务，首页
   能收到模型回复。待按难度递增接三条部署路径——模板店 → 官方镜像 → 源码
   构建。
3. **M3 体验闭环**：实时进度流、失败诊断、整体删除。
4. **M4 交付**：打包 dmg，准备与 Sealos 控制台的对比演示。

## 验收标准

同一个项目分别用 Sealos 控制台和 Helios 部署，对比完成时间与操作步数。
Helios 需要做到：一个输入、全程无表单，且以公网 URL 实际可访问作为部署成功的
唯一标准。
