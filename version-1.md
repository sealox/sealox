# Helios v1 开发文档

## 一句话定位

桌面 app：把项目丢进来，agent 负责部署到 Sealos，一屏看到部署产生的全部资源。
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

### 资源展示（唯一一屏）

- 以"这次部署"为单位聚合：应用状态、公网域名（点击打开）、数据库（只展示连接
  信息所在的 secret 名，不显示明文）、实时日志。
- 数据全部直读 Sealos 现有 API（namespace-scoped k8s API + Template API），
  本地不存业务状态，展示内容永远与 Sealos 一致。
- 失败诊断：agent 读 pod 日志和 events，输出人话结论。
- 删除：以模板实例为单位整体删除，需二次确认。

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
- 数据流：部署动作走 Electron → 本地 eve agent → Sealos；资源展示走
  Electron → Sealos API 直连。

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

1. **M1 只读链路**：Electron 壳 + 登录 + 读取并展示当前 namespace 的资源
   （先验证 Sealos API 直连可行）。
2. **M2 部署链路**：按难度递增接入三条路径——模板店 → 官方镜像 → 源码构建。
3. **M3 体验闭环**：实时进度流、失败诊断、整体删除。
4. **M4 交付**：打包 dmg，准备与 Sealos 控制台的对比演示。

## 验收标准

同一个项目分别用 Sealos 控制台和 Helios 部署，对比完成时间与操作步数。
Helios 需要做到：一个输入、全程无表单，且以公网 URL 实际可访问作为部署成功的
唯一标准。
