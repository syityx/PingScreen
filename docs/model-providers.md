# 云端连接核对记录

核对日期：2026-10-17。以下为官方文档契约核对，未使用真实云端密钥调用，不代表所有账号和地域均已线上实测。

| 服务商 | 默认基础地址 | 推荐 API 模型 ID / 选择方式 | 官方依据 |
| --- | --- | --- | --- |
| 百炼 | https://dashscope.aliyuncs.com/compatible-mode/v1 | qwen3-vl-plus | [兼容接口](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope)、[视觉](https://help.aliyun.com/zh/model-studio/vision) |
| 硅基流动 | https://api.siliconflow.cn/v1 | moonshotai/Kimi-K2.7-Code | [Chat Completions 的 VLM 示例](https://docs.siliconflow.cn/cn/api-reference/chat-completions/chat-completions) |
| 火山方舟 | https://ark.cn-beijing.volces.com/api/v3 | 用户自己的图片模型 / 部署 ID | [官方 SDK 基础地址](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkarkruntime/_constants.py)、[官方视觉请求示例](https://github.com/volcengine/volcengine-python-sdk/blob/master/volcenginesdkexamples/volcenginesdkarkruntime/vision_completions.py) |
| OpenAI | https://api.openai.com/v1 | gpt-4.1-mini | [图片输入](https://developers.openai.com/api/docs/guides/images-vision)、[模型](https://developers.openai.com/api/docs/models/gpt-4.1-mini) |
| Gemini | https://generativelanguage.googleapis.com/v1beta/openai | gemini-3.8-flash | [官方 OpenAI 兼容接口、图片及流式示例](https://ai.google.dev/gemini-api/docs/openai) |
| DeepSeek | https://api.deepseek.com | deepseek-flash（界面显示 DeepSeek-Flash） | [模型及 Vision 支持](https://api-docs.deepseek.com/quick_start/pricing)、[请求契约](https://api-docs.deepseek.com/api/create-chat-completion) |

统一请求为 POST `<基础地址>/chat/completions`，Bearer API Key，messages 中使用 text 和 image_url 内容，截图使用 PNG data URL。stream=true 时读取 SSE choices[].delta.content，stream=false 时读取 choices[].message.content。官方支持图片输入不保证任一手填模型可用，应使用设置页的合成图片测试。

DeepSeek Flash 的图片部分为 `{ "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }`，请求 model 为 `deepseek-flash`；不使用旧别名代替指定名称。

百炼官方说明旧 dashscope 域名仍正常可用，推荐迁移至业务空间专属域名；专属域名和其他地域可通过自定义配置。火山官方视觉示例要求填写账号自己的 endpoint ID，因此不预填一个其他账号无法使用的部署 ID，模型下拉框提供填写入口。

模型目录为内置静态选项，手填其他模型 ID 可覆盖推荐值。后续核对需要同时检查图片输入和 Chat Completions 兼容性，不能仅确认模型名称存在。

## 实现验证范围

- 单元测试检查预设地址不可覆盖、模型 ID、独立加密密钥、旧配置迁移/备份恢复、测试不保存以及请求的目标和鉴权归属。
- Electron smoke 使用本机 HTTP Chat Completions 测试服务，完成自定义地址和模型配置、32×32 合成图片连接测试、显式保存和截图问答。它不是实际 Ollama 模型，不能用于衡量模型识图质量。
- 云端界面和 IPC 流程测试会先解析真实预设地址与密钥，再把网络请求转到本机测试服务；实际云端网络和额度不在自动化测试中使用。六家云端均未使用真实账号在线调用，部署 ID 与模型权限仍需用户连接测试确认。
