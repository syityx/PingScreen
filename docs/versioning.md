# Git 与发布流程

源码仓库为 [syityx/PingScreen](https://github.com/syityx/PingScreen)，默认发布源码分支为 `main`。本地正式版基线在 `codex/release-0.1.5`，新版 Logo 与 GitHub 构建配置在 `codex/product-logo`。

## 版本基线

- `v0.1.4-demo`：用户确认的紧凑界面 Demo，作为首个可追溯源码快照。
- `v0.1.5`：将这套界面整合进正式安装版。
- `v0.1.6`：新 Logo、公开源码整理与 GitHub CI 自动构建发布。
- `v0.1.7`：回答阅读体验、服务商预设与配置页优化，发布源码位于 `codex/improve-answer-readability`。

版本历史从上述快照开始；此前 0.1.0–0.1.2 安装包与开发记录保留在本地，但没有补造历史提交。

Git 跟踪源码、正式品牌源图、测试、许可证、使用说明与开发文档；依赖、编译结果、安装包、临时截图、原始设计导出、旧 Demo 素材和本地配置不入库。文本统一使用 LF，Windows 批处理使用 CRLF。

## 后续发布

1. 新工作使用 `codex/` 前缀分支，记录对应问题和实现。
2. 更新 `package.json`、`package-lock.json` 的版本，以及版本变化、验证记录和正式版使用说明。
3. 运行 `npm run typecheck`、`npm test`、`npm run test:helper`、`npm run smoke`。
4. 先运行 `npm run build:brand` 生成新 Logo，再运行 `npm run dist` 生成安装包，使用 `npm run verify:release` 核对归档、品牌图片与安装包，生成安装程序及 blockmap 的 SHA-256 校验文件。
5. 将源码、文档和验证脚本提交，创建对应的带说明版本标签，例如 `git tag -a v0.1.6 -m "pingscreen 0.1.6"`。发布产物在 `release/`，不纳入源码提交。

## GitHub Actions

公开仓库默认启用 Actions 时，无需额外配置 Secrets、模型 API Key 或个人访问 Token。工作流声明所需权限，发布任务使用 GitHub 自动提供的 token。如果仓库手动关闭了 Actions，需要在 Settings → Actions → General 中重新启用。

- `ci.yml`：分支推送、Pull Request 或手动运行时，扫描历史凭据，并进行类型检查、原生助手测试、应用测试与构建。
- `release.yml`：手动运行时生成 Windows x64 安装包，可在该次 Actions 的 Artifacts 下载，保留 14 天，不创建公开 Release。
- 推送 `v<版本号>` 的正式标签时，核对标签、package.json 和锁文件版本，构建并验证安装包，发布安装程序、blockmap 与校验文件。Demo 标签不触发发布。
- 所有构建都先从 `docs/design/brand/logo-source.png` 生成最新界面、应用及托盘图片。原生助手在 GitHub Windows runner 上使用 Visual Studio 工具构建。
- 构建任务仅有源码读取权限，只有最终发布任务可写入 Release。使用 GitHub 自动提供的短期 token，无需配置任何模型 API Key 或个人 GitHub token。
- 已公开的同名 Release 不会被重跑覆盖；失败留下的草稿可以重跑完成。未配置代码签名，因此安装程序未签名。

历史 `v0.1.5` 标签保留当时的源码，不含后续新 Logo 和工作流。新 Logo 从 `v0.1.6` 开始正式发布；不要移动旧标签。测试当前分支可手动运行工作流。

## 入库检查

提交前查看暂存文件清单；`.gitignore` 不能保护已经被跟踪的文件。`release/`、`.tools/`、`.env*`、`settings.json*` 与私钥文件已忽略，不要强制添加。本地 API Key 在应用数据目录以系统加密保存，不属于源码。

Git 历史中的作者、提交者和标签邮箱已统一为项目所有者指定的公开邮箱；设计服务地址已从历史和当前文档清理。首次上传仅推送清理后的当前源码到 `main`，不推送旧版本标签或创建 Release。旧历史的回滚备份位于忽略的本地工具目录，不能上传。
