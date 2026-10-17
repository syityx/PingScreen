# Spec Delta

## Purpose

为屏幕问答提供可选择的云端服务商和图片模型连接，减少用户手工配置接口的负担；同时保留本地及其他兼容服务的自定义连接，并保证切换服务商时配置、密钥、连接测试和升级迁移行为可预测。

## ADDED Requirements

### Requirement: Cloud provider selection
系统 SHALL 提供服务商下拉框，包含通义千问（百炼）、硅基流动、豆包（火山方舟）、OpenAI、Gemini、DeepSeek 和自定义。云端预设 SHALL 自动提供对应服务地址，无需用户手工输入。

#### Scenario: Select a cloud provider
- **WHEN** 用户选择任一内置云端服务商
- **THEN** 界面显示该服务商的模型选择与 API Key 输入，使用其内置地址
- **AND** 不要求用户填写 Base URL

### Requirement: Provider scoped model selection
系统 SHALL 提供与服务商关联的模型下拉框，推荐支持图片输入的模型，并允许通过“其他模型”手工填写模型 ID。DeepSeek 的模型选项 SHALL 包含名称为 `DeepSeek-Flash` 的条目，不能静默替换为其他模型。

#### Scenario: Choose a recommended model
- **WHEN** 用户更换服务商并展开模型下拉框
- **THEN** 仅显示该服务商的预设模型以及“其他模型”入口

#### Scenario: Use a deployment or unlisted model
- **WHEN** 用户选择其他模型并填写模型或部署 ID
- **THEN** 保存、测试及实际问答使用所填写的 ID

#### Scenario: Select DeepSeek Flash
- **WHEN** 用户选择 DeepSeek
- **THEN** 可以选择 `DeepSeek-Flash`，请求使用经确认的对应 API 模型标识

### Requirement: Custom compatible connections
系统 SHALL 在选择自定义时提供 Base URL、模型名称和 API Key 输入，接受 HTTP/HTTPS 的 OpenAI Chat Completions 兼容服务，并允许 API Key 留空。基础地址与完整 chat/completions 地址 SHALL 继续可用。

#### Scenario: Configure a local service
- **WHEN** 用户通过自定义填写 Ollama 等本地兼容服务地址、图片模型名称且不填密钥
- **THEN** 系统允许保存和测试，发出的请求不含其他服务商的密钥

### Requirement: Isolated provider profiles and credentials
系统 SHALL 为每个服务商独立保留模型、流式偏好和密钥，自定义另保留地址。密钥 SHALL 使用系统加密保存且不以明文返回设置界面；留空保留和主动清除仅影响当前服务商。系统加密不可用时 SHALL 拒绝保存新密钥。

#### Scenario: Switch between configured providers
- **WHEN** 用户从已保存的服务商 A 切换到 B 再切回 A
- **THEN** 恢复 A 的连接配置及密钥存在状态
- **AND** 测试或问答仅使用目标服务商自己的密钥

#### Scenario: Clear one credential
- **WHEN** 用户清除 B 的密钥并保存
- **THEN** A 的密钥保持原样，B 不再附带该密钥

### Requirement: Explicit connection save and draft testing
服务商、模型及密钥修改 SHALL 在保存后才用于实际问答。测试 SHALL 使用当前草稿和目标服务商的密钥，以生成图片验证连接且不保存配置或上传桌面。普通应用偏好自动保存 SHALL 不提交模型草稿。测试结果 SHALL 只对应发起测试的配置。

#### Scenario: Test an unsaved provider
- **WHEN** 已保存 A，用户选择 B 并测试但没有保存
- **THEN** 测试请求发送到 B，实际问答继续使用 A，重启后仍选择 A

#### Scenario: Auto save while editing a connection
- **WHEN** 用户编辑连接草稿后调整回答字号
- **THEN** 仅字号被自动保存，连接草稿及服务商选择没有被提交

#### Scenario: Image input fails
- **WHEN** 测试请求被拒绝或没有得到有效文本
- **THEN** 界面显示连接失败原因，不标记成功且不改变已保存连接

### Requirement: Legacy settings migration
系统 SHALL 将旧单连接配置映射到自定义并保留地址、模型、流式偏好、加密密钥及其他应用设置，不根据地址猜测云端服务商。首次读取 SHALL 不直接重写旧文件，后续成功保存 SHALL 原子持久化升级配置。

#### Scenario: Open an existing installation
- **WHEN** 用户升级后加载旧配置
- **THEN** 自定义被选中且原配置继续可用于问答，无须重新输入密钥
- **AND** 仅打开设置不会改写原文件

#### Scenario: Restart after migration
- **WHEN** 用户成功保存升级配置并重启
- **THEN** 所选服务商、各已保存配置和其他应用偏好均恢复
