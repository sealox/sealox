# 桌面版本发布

推送版本 Tag 后，`.github/workflows/release.yml` 自动构建并发布 GitHub Release：

```sh
git tag v0.8.3
git push origin v0.8.3
```

Tag 支持 `vX.Y.Z` 或 `X.Y.Z`，版本号自动传入 Flutter 和安装包，无需为打包修改源码中的版本号。其他格式的 Tag 会触发流程，但在版本校验时停止。

构建使用 Node.js 24、Flutter 3.47.2，在对应平台分别打包：

- macOS Apple Silicon：`Sealos-X.Y.Z-mac-arm64.dmg`
- macOS Intel：`Sealos-X.Y.Z-mac-x64.dmg`
- Windows x64：`Sealos-X.Y.Z-windows-x64.exe`

安装包包含桌面后端、Eve 和 Node 运行时；Windows 额外包含 Portable Git。安装包与应用名称统一为 Sealos。

所有构建成功后才创建 Release 草稿，上传三个安装包及 `SHA256SUMS.txt`，最后公开发布。Release Notes 由 GitHub 根据提交和 Pull Request 自动生成。失败的工作流可在 Actions 中重新运行，重复上传会替换同名文件。

无需额外发布 Token，发布任务使用仓库自带的 `GITHUB_TOKEN`，仅该任务拥有 `contents: write`。工作流文件必须随 Tag 对应的提交推送到 GitHub。

当前没有配置 Apple Developer ID 公证或 Windows 代码签名证书；macOS 使用临时签名，下载后的系统信任提示仍可能出现。正式可信签名需要另行配置证书。
