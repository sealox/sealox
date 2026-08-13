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
  Helios 与 use-sealos skill 互认登录态。
- v1 固定使用登录后的默认工作空间。

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
- 侧边栏：工作空间胶囊；主导航**首页、应用、数据库、存储**；"最近"区展示
  最新模板实例；底部工作空间卡片与头像入口进**用户信息**，右下角全局刷新。
- **首页**（默认页）：渐变背景 + 居中部署输入框（拖入文件夹/粘贴 git 地址，
  M2 接线）＋模板建议 chips。即 Lovable 的 prompt hero 布局。
- **应用**：应用 = 模板实例（Template API 的 instance）。一个实例
  一张卡片，聚合展示：
  - 状态由实例名下的工作负载与数据库聚合，优先级：异常 > 启动中 > 运行中 >
    已暂停；
  - 模板名、工作负载/数据库/存储桶数量、创建时间；
  - 公网域名（点击用外部浏览器打开）；
  - 故障 pod 的原因与重启次数（标红展示）。
- 应用页底部"模板之外的工作负载"小节：不属于任何模板实例的工作负载（如直接
  从 App Launchpad 部署的）单独展示，保证所见与 Sealos 实际状态一致。
- **数据库**：KubeBlocks Cluster 列表——引擎、版本、阶段、所属实例。
- **存储**：ObjectStorageBucket 列表——策略（私有/公开读/公开读写）、实际
  桶名、创建时间。
- **用户信息**：区域、API server、命名空间、工作空间、登录时间、kubeconfig
  路径；退出登录放在此页。
- 数据规则：全部直读 Sealos 现有 API（namespace-scoped k8s API + Template
  API），本地不存业务状态；15 秒自动刷新 + 手动刷新；数据库只展示连接信息
  所在的 secret 名，不显示明文。
- 留给 M3：实时日志、失败诊断（agent 读日志/events 输出人话结论）、以模板
  实例为单位的整体删除（需二次确认）。

## 非目标（v1 明确不做）

- 多项目管理面板、成本、监控图表
- 工作空间/区域切换、团队协作
- Web 版、移动端
- 自建后端服务和自建数据库

## 架构（已定的部分）

- **仓库结构**：npm workspaces monorepo，两个 app——`apps/electron`（桌面端）
  和 `apps/eve`（本地 agent 服务，`npx eve init` 脚手架已就位，M2 填充部署
  逻辑）。
- **Electron**：唯一客户端。UI 栈：electron-vite + React + TypeScript
  （eve 的前端客户端是 React hook，M2 直接可用）；浅色主题。
- **Vercel eve（本地运行）**：agent 运行时在用户本机作为 app 的后台 AI 服务
  运行，部署逻辑从 use-sealos skill 移植。
- **Sealos**：零改动，只消费现有 API。
- **品牌**：logo 采用 Sealos 官方 mark 的黑金重配色（黑底圆角方 + 金渐变，
  路径不变）；源文件 `apps/electron/src/renderer/src/assets/logo.svg`，应用
  图标由 electron-builder 从 `build/icon.png` 生成。
- 数据流：部署动作走 Electron → 本地 eve agent → Sealos；资源展示走
  Electron → Sealos API 直连。

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

## 参考

- use-sealos skill：`/Users/che/Documents/GitHub/sealos-skills-next`
  （部署决策树、`sealos-api.py`、`wait-app.sh`、references/ 下的平台约定）
- Sealos 源码：`/Users/che/Documents/GitHub/sealos`
  （控制台各前端实际调用的 API 定义）
- Sealos 资源模型：namespace（`ns-xxx`）、app label
  `cloud.sealos.io/app-deploy-manager`、KubeBlocks `Cluster` CR、
  `ObjectStorageBucket` CR、region domain（如 `usw-1.sealos.io`）
- eve 文档：以安装后的 `node_modules/eve/docs/` 为准（README 有阅读顺序），
  脚手架 `npx eve init`；线上文档 <https://eve.dev/docs>

## 未决问题（开工前逐个确认）

1. Electron 与本地 eve 的通信方式和进程托管细节：eve 自带 CLI
   （`init/dev/build/start`）和前端客户端，具体以安装版本的
   `node_modules/eve/docs/` 为准（M2 开工时确认）。
2. 本地 eve 的模型凭证：走 Vercel AI Gateway 还是直连模型厂商；key 的来源
   与存放（M2 开工时确认）。
3. 源码构建依赖：v1 是否要求用户本机有 docker；没有 docker 时的降级方案。
4. 日志"实时"的实现程度：轮询还是 watch（M3 确认）。

## 里程碑

1. **M1 只读链路**（已完成，2026-08-13）：Electron 壳 + 登录 + 侧边栏四页
   只读资源展示；真实账号验证通过（device flow 登录路径待端到端验证）。
2. **M2 部署链路**：按难度递增接入三条路径——模板店 → 官方镜像 → 源码构建。
3. **M3 体验闭环**：实时进度流、失败诊断、整体删除。
4. **M4 交付**：打包 dmg，准备与 Sealos 控制台的对比演示。

## 验收标准

同一个项目分别用 Sealos 控制台和 Helios 部署，对比完成时间与操作步数。
Helios 需要做到：一个输入、全程无表单，且以公网 URL 实际可访问作为部署成功的
唯一标准。
