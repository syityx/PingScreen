# Design

## Context

动机见 proposal.md。当前 Settings 是单连接扁平对象，SettingsStore 只持有一个 encryptedKey，public() 仅返回 hasKey；model.ts 通过 endpoint() 拼接 /chat/completions，使用 Bearer 鉴权并发送 image_url。测试 IPC 合并草稿后直接回退 store.key()，新增服务商后必须改变该回退逻辑。设置页已有串行保存、模型显式保存和应用偏好自动保存；tests/settings.test.ts、tests/model.test.ts 与 src/main/smoke.ts 提供验证入口。

## Goals / Non-Goals

**Goals:** 服务商选择贯穿界面、存储、测试和实际请求；尽量复用既有传输；保证旧配置和密钥隔离。

**Non-Goals:** 不增加本地部署管理、OAuth、账号同步、多个同服务商账号、自动抓取模型列表或新的原生 Gemini 协议适配。

## Decisions

### 1. 静态服务商目录与统一连接解析

新增共享目录，条目包含稳定 provider ID、中文名称、基础地址、模型显示名与 API ID、默认模型。首批名单见 proposal。模型显示名与 API ID 分开，尤其 DeepSeek-Flash 必须保留指定显示名；实现前核实其实际 API ID，不能仅凭显示名假造请求契约。百炼和火山方舟默认使用面向中国大陆的区域地址，其他区域及代理使用自定义。

沿用 Chat Completions、image_url、SSE/JSON 解析；Gemini 使用官方兼容入口。不引入各厂商 SDK，减少重复传输和错误处理。目录不包含密钥，预设地址由主进程依据 provider ID 解析，不相信渲染端对预设地址的覆盖。手工模型 ID 支持火山方舟部署 ID 等账号相关值。

### 2. 版本化连接配置与独立密钥

持久化升级为 version 2：activeProvider、以 provider ID 为键的 profiles，以及独立应用偏好。profile 包含 model、stream，自定义另含 baseUrl；每个 profile 独立 encryptedKey。公开配置提供各 profile 的非敏感字段、hasKey/keyProblem，不返回密钥或密文。主进程通过已保存的 activeProvider 生成运行时连接快照，避免目录逻辑散落到问答路径。

采用每服务商一个 profile，避免保留单一密钥造成跨服务发送；不做多账户连接管理。未知 provider ID 在保存或测试时明确拒绝；读取已不存在的 provider 时安全回退自定义，不挪用未知 profile 的凭据。归一化沿用原有地址、模型、长度与偏好限制。

### 3. 草稿状态和显式提交

设置页两个下拉框依次为服务商、模型。“其他模型”显示模型 ID 输入；自定义显示原地址和模型输入。API Key 始终为密码输入，切换时清空输入框和清除标记，不将 A 的未保存密钥带到 B；非敏感草稿按 provider 暂存，离开有未保存密钥的服务商时提示该密钥尚未保存。

保存仅原子提交当前 profile 和 activeProvider；其他 provider 草稿不隐式保存。应用偏好提交独立 patch，不改变 activeProvider 或任一 profile。测试发送明确 provider ID 与当前草稿；仅从同一 provider 读取已存密钥，clearKey 优先，非空新密钥覆盖。沿用 busy 禁用连接编辑，防止测试完成后结果错配。

### 4. 测试与实际调用共用解析

测试和正式问答使用同一解析器生成地址、模型、stream、密钥，测试不写盘。保留合成图片、30 秒超时、失败反馈和请求取消；不对新服务商回退使用当前活动服务商密钥。预设目录只推荐图片模型，手工 ID 的可用性由实际测试校验，不将 HTTP 成功等同于已验证画面理解质量。

## Risks / Trade-offs

- [模型与区域接口变化] → 目录集中维护，提交前核对官方地址、模型 ID、图片及流式格式；自定义作为其他区域和代理入口。
- [DeepSeek-Flash 的线上契约尚未核实] → 保留用户指定选项，在实现任务中核实 API ID 和图片格式；若与统一兼容协议冲突，明确报告并修订设计，不静默替换模型或宣称已实测。
- [密钥与草稿切换混淆] → provider ID 贯穿 IPC 和存储，测试覆盖不同域名下的凭据归属与清除行为。
- [无真实账号无法在线验证所有服务] → 使用请求契约测试和合成图片测试入口，记录实际完成的线上验证，不把模拟响应称为实测。

## Migration Plan

1. 读取 version 1 时在内存映射到 custom profile，复制原 encryptedKey，无需解密后重新加密；原文件保持不变。
2. 首次成功保存（包括应用偏好）时将已保存状态写成 version 2，沿用临时文件加 rename 的原子写入；不包含模型草稿。首次升级前保留旧文件备份，备份仍只有加密密钥。
3. 检验重启、多 provider 恢复、加密不可用与损坏密钥场景。
4. 回退旧应用需要恢复升级前备份；直接读取 version 2 不承诺兼容旧应用。备份后的新 profile 仅由新版读取，文档说明回退边界。
