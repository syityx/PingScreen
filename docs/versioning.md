# Git 与发布流程

项目仓库位于 `D:\Code\pingscreen`。当前开发分支为 `codex/release-0.1.5`，尚未配置远程仓库。

## 版本基线

- `v0.1.4-demo`：用户确认的紧凑界面 Demo，作为首个可追溯源码快照。
- `v0.1.5`：将这套界面整合进正式安装版。

版本历史从上述快照开始；此前 0.1.0–0.1.2 安装包与开发记录保留在本地，但没有补造历史提交。

Git 跟踪源码、设计资源、测试、许可证与文档；依赖、编译结果、安装包、临时截图和本地配置不入库。文本统一使用 LF，Windows 批处理使用 CRLF。

## 后续发布

1. 新工作使用 `codex/` 前缀分支，记录对应问题和实现。
2. 更新 `package.json`、`package-lock.json` 的版本，以及版本变化、验证记录、正式版和 Demo 使用说明。
3. 运行 `npm run typecheck`、`npm test`、`npm run test:helper`、`npm run smoke`。
4. 运行 `npm run dist` 生成安装包，再运行 `npm run verify:release` 核对归档与安装包，生成 SHA-256 校验文件。
5. 将源码、文档和验证脚本提交，创建对应的带说明版本标签，例如 `git tag -a v0.1.6 -m "pingscreen 0.1.6"`。发布产物在 `release/`，不纳入源码提交。

若要对外托管，在明确仓库地址后配置远程并推送分支及标签。当前版本仅在本地生成发布产物。
