# Proposal

## Why

目前用户必须自行查找并填写服务地址和模型名称，常用云端服务缺少直接入口。提供服务商和模型预设可以降低配置成本，同时保留现有自定义接口能力。

## What Changes

- 增加服务商和模型两个关联下拉框，首批包括通义千问（百炼）、硅基流动、豆包（火山方舟）、OpenAI、Gemini、DeepSeek，以及“自定义”。
- 云端预设内置接口地址和图片模型选项；允许手动填写模型 ID，DeepSeek 包含用户指定的 `DeepSeek-Flash`。
- 自定义保留 Base URL、模型名称、可选 API Key，涵盖 Ollama 等本地 OpenAI 兼容服务。
- 每个服务商独立保存模型和加密密钥；旧配置完整迁移为自定义。
- 保留显式保存、测试不保存、生成图片测试和流式回答行为；普通应用偏好自动保存不提交模型草稿。

## Capabilities

### New Capabilities

- `model-connections`: 服务商预设、关联模型选择、自定义连接、配置隔离与迁移，以及连接测试和运行时配置解析。

### Modified Capabilities

无。现有 `answer-reading` 的字号自动保存隔离要求保持不变。

## Impact

- 涉及共享配置类型与服务商目录、主进程配置存储与测试 IPC、模型调用配置解析、设置页及样式。
- 扩展 settings/model 单元测试和现有 Electron smoke 流程，更新 README 与安装包使用说明。
- 沿用现有 fetch、Chat Completions 和系统密钥加密，无需新增 SDK；配置文件升级需兼容旧格式。
- 各云端的实际接口、区域、模型 ID 与图片请求兼容性需在实现时对照官方文档确认；用户指定的 DeepSeek-Flash 名称保留，尚未独立验证其线上契约。
