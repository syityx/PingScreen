<div align="center">
  <img src="docs/media/logo.png" width="180" alt="pingscreen 图标" />
  <p><strong>PingScreen 哪里不会点哪里</strong></p>
  <p>指向屏幕上的文字、按钮、图片或图表，让 AI 解释、翻译、改写，或回答你的问题。<br />按住 <strong>Alt + 鼠标左键</strong>，拖向一个意图，松开即可。</p>
  <p>
    <a href="#安装">安装</a> ·
    <a href="#使用">使用</a> ·
    <a href="#隐私与数据">隐私与数据</a>
  </p>
  <p>
    <img src="https://img.shields.io/badge/平台-Windows_x64-167a86" alt="平台：Windows x64" />
    <img src="https://img.shields.io/badge/版本-0.1.8-2878e8" alt="版本：0.1.8" />
    <a href="LICENSE"><img src="https://img.shields.io/badge/许可-MIT-52616b" alt="许可：MIT" /></a>
  </p>
  <img src="docs/media/demo.gif" width="920" alt="pingscreen 实际操作演示" />
</div>

## 安装

支持 **Windows x64**，需要支持图片输入的模型服务。

1. 下载并运行 [最新正式版安装程序](https://github.com/syityx/PingScreen/releases/latest)。
2. 打开设置，选择服务商和模型，填写 API Key；其他兼容接口选择「自定义」。
3. 点击「测试连接」，成功后点击「保存」。

支持通义千问、硅基流动、豆包、OpenAI、Gemini、DeepSeek 及自定义兼容服务。更新时先从托盘退出旧版，再安装到原目录，已有设置会保留。

## 使用

将鼠标放在目标上，按住 **Alt + 鼠标左键**，拖向轮盘功能后松开。

- **解释、翻译、改写：** 直接分析指向的内容；停在翻译扇区时可用滚轮切换点／条范围。
- **提问：** 输入你想问的问题；**框选：** 先选择区域，再选择功能。
- **自定义轮盘：** 在设置中点击轮盘「编辑」，选择四／五／六项、拖动排序，或配置自己的名称、图标和提示词，完成后保存。

回答支持复制、停止、重试和追问；Enter 发送，Shift + Enter 换行。**追问沿用同一张截图，画面变化后请重新发起手势。**

按 Esc 取消手势或关闭回答，**Ctrl + Alt + P** 暂停／恢复。设置和退出入口在系统托盘，关闭设置窗口后应用仍在后台运行。

## 隐私与数据

**每次请求会向你配置的模型服务发送目标显示器的完整截图、定位信息和局部细节图，框选也会发送整屏上下文。** 应用不持续录屏，截图和对话仅保留在当前会话内存中。

API Key 由 Windows 系统加密保存。模型服务的数据处理与费用遵循其自身政策；回答效果取决于所选模型。受保护内容、系统安全桌面等场景可能无法使用。

更多说明：[使用说明](docs/release-readme.txt) · [版本变化](docs/changelog.md) · [模型连接说明](docs/model-providers.md)

## 致谢与许可

采用 [MIT 许可证](LICENSE)。原生输入助手等基础能力源自 [lolPing](https://github.com/darrenprx/lolPing)，保留原作者版权声明，详见 [第三方许可](THIRD_PARTY_LICENSES.txt)。
