# custom-actions Specification

## Purpose

让用户把常用的屏幕分析需求保存为多个独立的命名提示词功能，通过轮盘直接执行。自定义任务复用已有的屏幕截图、定位、模型连接及回答会话，同时由用户控制回答语言、篇幅与格式。

## Requirements

### Requirement: Multiple independently configured custom actions
系统 SHALL 支持在多个槽位分别配置自定义功能，每个功能包含名称、一个内置可选图标和提示词。修改其中一个功能 SHALL 不改变其他功能；名称和提示词 SHALL 非空，名称最多 20 个字符、提示词最多 8000 个字符，超限或无效输入 SHALL 显示错误并阻止保存。图标 SHALL 仅从应用提供的集合中选择。

#### Scenario: Configure independent actions
- **WHEN** 用户为两个槽位分别设置“英文润色”和“代码审查”，选择不同图标并保存不同提示词，随后仅编辑代码审查
- **THEN** 英文润色的名称、图标和提示词保持不变，选择各槽位分别执行其保存的任务

#### Scenario: Validate custom fields
- **WHEN** 名称或提示词仅包含空白、超出长度限制，或保存请求包含不支持的图标
- **THEN** 系统拒绝该保存并指出无效字段，已生效功能保持可用

### Requirement: Immediate execution with existing captured context
系统 SHALL 在用户选中有效自定义功能后直接以其保存的提示词发起首轮请求，携带现有全屏截图、定位及已有局部细节图，点选使用原始手势定位点，框选使用选中区域。系统 SHALL 沿用当前模型连接及流式／非流式设置，不要求用户再次输入或重新截图。

#### Scenario: Execute from a point
- **WHEN** 用户在光标指向的文字上选择英文润色功能并松开
- **THEN** 系统打开回答卡片并直接发送保存的润色任务，包含该次截图和原始定位点，不将松开位置当作目标

#### Scenario: Execute from a selected region
- **WHEN** 用户完成框选并在后续轮盘选择代码审查
- **THEN** 系统立即发送代码审查提示词与该次截图、所选区域定位，截图和细节图继续遵循既有策略

### Requirement: Custom task instructions determine output preferences
系统 SHALL 为自定义任务保留截图定位、同一快照上下文、不确定性和截图内容作为资料等通用规则，但 SHALL 不附加预设任务的默认语言、篇幅、格式、翻译或改写要求。用户保存的提示词 SHALL 作为该任务的首轮任务内容，不能被替换为内置短指令；实际模型输出能力仍取决于当前模型。

#### Scenario: Custom English structured output
- **WHEN** 自定义提示词要求用英文详细分析并只输出 JSON
- **THEN** 发出的请求包含该要求，且系统提示词不另行要求中文、短回答或 Markdown 排版

#### Scenario: Retain snapshot interpretation
- **WHEN** 模型执行自定义任务或后续追问
- **THEN** 请求保留目标坐标含义、截图为历史快照及截图文字为分析资料的通用规则

### Requirement: Stable custom task retries and follow-ups
系统 SHALL 在同一会话中沿用首次选择的任务与提示词，以及同一截图和定位上下文；重试 SHALL 重发相应轮次的问题，追问 SHALL 作为后续问题附加至现有会话。自定义功能 SHALL 沿用现有停止、错误反馈和关闭取消行为；自动执行的首轮任务提示词 SHALL 不作为用户手动输入的问题展示在回答卡片中。

#### Scenario: Retry and follow up
- **WHEN** 自定义功能首轮请求失败，用户重试后继续追问
- **THEN** 重试使用原任务提示词，追问使用用户的新问题，两者沿用该会话截图和定位
- **AND** 卡片隐藏自动任务提示词，但展示用户实际输入的追问与回答

#### Scenario: Cancel generation and ignore delayed output
- **WHEN** 用户在自定义任务生成过程中停止或关闭卡片
- **THEN** 请求按现有流程中止，停止后保留已生成内容，关闭后的延迟输出不重新打开卡片或污染新会话

### Requirement: Preserve built-in interaction semantics
系统 SHALL 保留预设解释、翻译、改写的直接执行行为以及预设“提问”的等待输入行为。“翻译”预设在点选中 SHALL 继续支持滚轮切换点／条；自定义功能即使使用翻译图标或名称也 SHALL 不自动继承翻译模式或翻译提示词。

#### Scenario: Ask waits while custom executes
- **WHEN** 用户分别选择预设“提问”和一个保存好提示词的自定义功能
- **THEN** 提问在输入前不发模型请求，自定义功能无需输入即发起请求

#### Scenario: Translation behavior follows function type
- **WHEN** 用户先在移动过位置的翻译预设上切换点／条，再选择使用翻译图标的自定义功能
- **THEN** 翻译预设使用当前范围，自定义功能仅执行自身提示词，不附加点／条翻译要求
