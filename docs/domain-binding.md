# 绑定自定义域名

应用详情的公网链接旁，或项目拓扑的域名详情中，点击「绑定域名」。

1. 输入完整域名，例如 `app.example.com`，不要填写协议、端口或路径。
2. 在域名的 DNS 服务商处添加 CNAME 记录。主机记录通常填 `app`，目标使用弹窗显示的公网域名，TTL 保持默认。
3. 等待 DNS 生效后点击「验证并绑定」。若使用 CDN，先关闭代理以便验证 CNAME。
4. 绑定后自动申请 HTTPS 证书。弹窗显示「申请中」「已签发」「申请失败」「已过期」或「暂时无法读取证书状态」，可以点击「刷新证书状态」重新查询。路由创建完成不代表证书已经签发。

从已绑定的自定义域名继续绑定时，仍使用原公网域名作为 CNAME 目标，并复制原入口的当前路由；原入口已删除时会提示重新选择。

原公网地址保留，新域名指向同一个服务与端口，并出现在应用网络信息及项目拓扑中。绑定失败时弹窗保留输入，可以重试；DNS 验证失败不会创建资源。

实现参考 Sealos 官方的 [域名验证](https://github.com/labring/sealos/blob/main/frontend/providers/applaunchpad/src/pages/api/platform/authCname.ts) 和 [Ingress / Issuer / Certificate 配置](https://github.com/labring/sealos/blob/main/frontend/providers/applaunchpad/src/utils/deployYaml2Json.ts)。

## 验证方式与失败重试

优先调用当前区域 AppLaunchpad 的 `/api/platform/authCname`，由服务端查询权威 DNS。仅在接口不存在、服务端异常或网络不可达时，回退到本机 CNAME 查询；本机无法返回 CNAME 时使用 HTTPS DNS 查询，兼容代理的 Fake-IP 模式。区域明确返回记录不匹配时不会绕过验证。网络失败单独提示，避免误报“未生效”。这些验证请求仅包含公开域名，不发送 Kubeconfig 或登录令牌。

桌面端目前支持 CNAME 验证，不启用 AppLaunchpad 的 HTTP challenge。启用 CDN 代理会隐藏 CNAME，请先使用「仅 DNS」完成绑定。

Issuer、Certificate 和 Ingress 使用确定的资源名，重试会复用属于当前应用和域名的资源，不覆盖其他入口。部分资源创建成功后失败，可以重新提交补齐后续步骤。绑定期间切换工作空间会中止后续创建；Kubernetes 请求有超时限制。
