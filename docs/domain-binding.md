# 绑定自定义域名

应用详情的公网链接旁，或项目拓扑的域名详情中，点击「绑定域名」。

1. 输入完整域名，例如 `app.example.com`，不要填写协议、端口或路径。
2. 在域名的 DNS 服务商处添加 CNAME 记录。主机记录通常填 `app`，目标使用弹窗显示的公网域名，TTL 保持默认。
3. 等待 DNS 生效后点击「验证并绑定」。若使用 CDN，先关闭代理以便验证 CNAME。
4. 绑定后自动申请 HTTPS 证书。路由创建完成不代表证书已经签发，请稍后访问。

原公网地址保留，新域名指向同一个服务与端口，并出现在应用网络信息及项目拓扑中。绑定失败时弹窗保留输入，可以重试；DNS 验证失败不会创建资源。

实现参考 Sealos 官方的 [域名验证](https://github.com/labring/sealos/blob/main/frontend/providers/applaunchpad/src/pages/api/platform/authCname.ts) 和 [Ingress / Issuer / Certificate 配置](https://github.com/labring/sealos/blob/main/frontend/providers/applaunchpad/src/utils/deployYaml2Json.ts)。
