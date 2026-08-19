# 开始（对话）

模糊意图走这里。主进程是 eve 的唯一 HTTP 客户端；渲染进程只画已经投影好的消息。

## 版式

- 空会话：居中标题「今天想开发点什么？」+ 输入框。
- 有消息：消息区占满内容区，输入框钉底。贴底才跟新消息；用户上翻不要强行拉回去。
- 对话历史是「开始」页里的抽屉，**不是**那根 256px 资源侧栏。默认只留展开 icon。

输入框占位仍写「把项目文件夹拖进来，或粘贴 Git 仓库地址」——**那两个入口没做**。能用的是打字、选文件附件、模板 chips 填输入框。

## 会话模型

eve HTTP **没有** session 列表。可续聊的只有 `sessionId` + `streamIndex`。全文 Helios 自己存。

```
~/.helios/chats/<workspaceId>/index.json
~/.helios/chats/<workspaceId>/<conversationId>.json
```

- `index.json`：侧栏用（id、title、updatedAt）。不要为画列表读每条全文。
- 全文：id、title、workspaceId、eveSessionId、streamIndex、messages、createdAt、updatedAt。须能还原用户原文、assistant 正文、按发生顺序的 thinking / 工具 trace。
- 写入：临时文件再 rename。主进程读写。
- 一条 Helios 对话 ↔ 一条 eve `sessionId`。列表按当前工作空间过滤。

IPC：`listChats` / `getChat` / `sendChatMessage` / `cancelChat` / `respondChat` / `deleteChat` / `onChatEvent`。

## 新对话与切换

- **新对话**：清 UI，`POST /eve/v1/session`。空会话回到 hero。
- **切换**：先渲染落盘全文，再 `attach` 该 sessionId。attach 失败（eve 重启过、session 已 reset）：UI 仍显示历史，并开新 session——模型侧上下文可能断，不要假装还在。**不做**把 Helios 历史回放进新 session。
- 切工作空间会重启 eve。历史以落盘为准。
- 标题默认第一条用户消息，截断即可。不另做重命名。

「问 Helios」（数据库详情）：切到「开始」、`startNewChat`、输入框预填库上下文，**不自动发送**。

## 时间线

Agent 实际是：想一段 → 调工具 → 再想 → 再调 → 正文。UI 按这个时间线画，thinking 和工具是同一条有序列表：

- 每一段 reasoning（一个 `stepIndex`）是一行 **thinking**：默认收起，只显示标签 `thinking`。生成中也不自动展开。
- 每个工具调用是独立一行，插在相邻 thinking 之间。
- 落盘为有序 `trace`（`thinking` | `activity`）。
- 工具细节截断，不把可能含密钥的全文倒进 UI。
- Flash 类模型常常不吐 reasoning：时间线可以只有工具行。这是预期。

## 渲染

只把 **assistant 正文**当 markdown（标题、列表、加粗、链接、代码块）。不执行 HTML。链接系统浏览器打开。用户气泡纯文本。流式不完整 markdown 允许短暂难看。

## 停止与提问

- **停止**：`POST /eve/v1/session/:id/cancel`，等 `turn.cancelled`。eve 前端 `stop()` 只断客户端、服务端 turn 继续跑，不能当产品语义。本机 docker/kubectl 被 cancel 后是否真停，UI 不承诺「机器已经停了」。
- **`ask_question`**：流里的 `input.requested` 画成当前轮选项/输入，回答走 eve `respond`。没有这一步，部署对话会无声卡死。

一轮结束跟 `session.waiting` / `turn.failed` / `turn.cancelled`，不跟墙上时钟。

## 附件

`pickChatFiles`：系统文件对话框，多选文件（不是文件夹）。读进对话发给模型。这不是「拖项目进来部署」。

## eve 路由（主进程）

| 动作 | 方法 |
|---|---|
| 开会话 | `POST /eve/v1/session` |
| 事件流 | `GET /eve/v1/session/:id/stream?startIndex=` |
| 取消 | `POST /eve/v1/session/:id/cancel` |
| 回答 HITL | eve 的 `respond`（字段以 eve 源码/docs 为准） |

能力范围与 use-sealos 一致：部署、排障、管数据库/存储。决策树和 YAML 合同在 `apps/eve/agent/skills/use-sealos/`，这里不复制。

## 不要

- SQLite、对话搜索/导出/分享
- 渲染进程直连 eve
- 模型选择器（型号见 [platform.md](platform.md)）
- 编辑已发送消息、重新生成、把历史回放进新 session
- 把资源侧栏改成 ChatGPT 那根对话列表
- 承诺拖文件夹 / 粘贴 git 已经能部署
