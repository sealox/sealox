# Helios vision

在 Sealos 上做出自己的应用。Agent 负责部署、照看、操作你账号里的资源。

当前功能合同：[docs/index.md](../index.md)。本文件管为什么存在和产品边界。界面以 [Figma](https://www.figma.com/design/nLdvIEk8q7p8exzKcclNQo/helios-design) 为准。

Helios 是让 Sealos 更好用的操作台（桌面 + iOS）。内部 MVP。不是又一个 Sealos 控制台，也不是为了「做 agent」而做的 agent 应用。

用户的需求经常是模糊的——那种交给 agent，用自然语言理解 intent。确定性强的动作（部署这个模板、删除这个项目、重启这个应用）走按钮：点下去就是那件事，不经过对话。对话的确定性比按钮差，不该承担这类操作。列表和详情负责诚实展示那个世界。

## 为什么存在

人要在 Sealos 上做出自己的应用。use-sealos skill（[sealos-skills-next](https://github.com/norberia/sealos-skills-next)）已在 Cursor 里验证完整链路：登录、三条部署路径、数据库/存储/公网域名、部署后验证。Helios 把这条链路做成操作台：Agent 部署、照看、操作你账号里的资源（项目、应用、数据库、存储桶、对话、模板）。Sealos 零改动，只消费现有 API。

## 产品边界

做：登录 Sealos → 在账号里做出应用。模糊意图走对话（部署 / 排障 / 管库和存储）；确定动作走按钮（模板部署、删除、重启、暂停/启动）；同一屏看见并点进真实资源。

不做：Web 版、自建云端后端和自建数据库、多项目管理面板、独立成本中心。团队协作产品不做；工作空间切换已有。

当前版本不做：登录后的区域切换（登录时可选区域）；Android。iOS 宿主已进仓库，功能尚未移植，见 [mobile.md](../mobile.md)。

以后可能：[Railway `dev.new`](../railway-dev-new.html) 那条调研。不是本版范围，不要当功能合同读。登录、授权、工作空间准备抽成独立 package，给桌面和 iOS 共用，见 [auth.md](../auth.md)。

成功标准：同一个项目分别用 Sealos 控制台和 Helios 部署，对比完成时间与操作步数。模糊需求一个输入即可；不把控制台那种配置表单搬进来。部署成功以公网 URL 实际可访问为唯一标准。

## 参考

- 对话里怎么操作 Sealos：eve 内置 use-sealos（从 sealos-skills-next 拷贝，不会自动同步）。
- Sealos API 对着源码查，见 `.cursor/rules/sealos-source.mdc`。
