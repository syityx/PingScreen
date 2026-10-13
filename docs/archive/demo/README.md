# Demo 历史归档

当前源码仅支持正式版构建，Demo 构建入口与运行分支已移除。历史 Demo 源码可通过 Git 标签 `v0.1.4-demo` 查看。

- `usage-0.1.5.txt`：归档的 Demo 使用说明，停止作为当前构建输入。
- `answer-preview.png`：旧 Demo 回答界面展示图，停止作为当前产品资源。
- 旧 ZIP 和打包目录位于本地 `release/archive/demo/`；该目录随整个 `release/` 被 Git 忽略。
- 历史验收记录仍在 `docs/verification/0.1.3-demo.md` 与 `0.1.4-demo.md`，其中旧路径表示当时的发布位置。

清理没有修改已发布安装包、历史版本标签或用户的正式版与 Demo 配置目录。版本号保持 0.1.5。

清理后的类型检查、37 项应用测试和 Electron 完整模拟流程通过；确认 `release/` 及归档子目录命中 `.gitignore`，且没有被 Git 跟踪。
