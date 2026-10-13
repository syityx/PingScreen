pingscreen 0.1.5 · Windows x64 正式版

安装与升级
运行 pingscreen-Setup-0.1.5.exe，按提示完成安装。
更新前从系统托盘退出旧版 pingscreen / Demo，再安装到原目录。
正式版沿用 %APPDATA%\pingscreen 的已有配置。
Demo 的 %APPDATA%\pingscreen-demo 目录独立；仅用过 Demo 的用户请在正式版重新填写模型配置。

首次使用
填写支持图片输入的 Chat Completions 兼容服务地址、模型名称和 API Key。
“测试连接”检查当前填写内容，不自动保存；“保存”才会保存模型配置。
手势、轮盘和开机启动修改后立即保存。API Key 由 Windows 系统加密保存。

在目标位置按住 Alt + 鼠标左键拖动，选择解释、翻译、改写、提问或框选后松开。
翻译扇区滚轮切换“点 / 条”：点聚焦指向文字，条由模型判断所在行的一段文字。
中心松开、Esc、右键、提前松开触发键均可取消。Alt + 单击不会提问。
Ctrl + Alt + P 暂停 / 恢复。回答卡片支持追问、复制、停止与手动重试。

每次请求发送目标显示器的完整截图、定位信息和局部细节图。
截图与对话只保留在会话内存中，追问沿用同一张快照；需要最新内容请重新发起手势。
连接测试使用生成图片，不上传桌面。模型服务按其政策处理请求。

配置页为连续紧凑布局，支持平滑滚动、轻度吸附与左侧导航。
关闭设置窗口后仍驻留托盘；退出请右键托盘图标选择“退出”。

MIT 协议 · Copyright (c) 2026 pingscreen contributors
基于 lolPing：https://github.com/darrenprx/lolPing
原作者版权：Copyright (c) 2026 Danrui Meng；完整声明见应用内 LICENSE / THIRD_PARTY_LICENSES.txt。
