# Spec Delta

## Purpose

为 pingscreen 的回答提供可保存的字号设置，让用户按自己的阅读需要调整文字大小；同时通过纯白的简约卡片减少固定说明与元信息，保留提问和必要反馈。卡片从紧凑高度随回答输出增高，达到与宽度相等的高度上限后滚动；提供直观的 X 关闭入口。截图仅用于模型上下文，不展示在卡片中。

## ADDED Requirements

### Requirement: Configurable answer font size

系统 SHALL 在设置页的“应用”分类提供回答字号滑块及当前数值，默认 16px，支持 14–24px、步长 1px。系统 SHALL NOT 在回答卡片内新增 `Aa` 字号调整入口。回答内标题、代码和表格 SHALL 随正文调整，标题略大于正文，代码和表格接近正文。

#### Scenario: User changes the answer font size

- **WHEN** 用户在设置页选择一个有效的回答字号并打开下一张回答卡片
- **THEN** 回答正文使用所选择的字号显示
- **AND** 所选字号与原字号不同时，正文的显示大小随之改变

#### Scenario: Answer card has no new font adjustment entry

- **WHEN** 用户查看回答卡片
- **THEN** 卡片中不出现新增的 `Aa` 字号调整入口

#### Scenario: Default and range are displayed

- **WHEN** 用户首次打开“应用”设置，且没有保存过回答字号
- **THEN** 回答字号显示 16px，滑块支持 14–24px、步长 1px

#### Scenario: Markdown text follows the preference

- **WHEN** 用户使用 14px、16px 或 24px 阅读含标题、代码、表格的回答
- **THEN** 标题、代码和表格文字随正文一起改变大小
- **AND** 输入区和其他应用界面不因此整体缩放

### Requirement: Font preference is automatically saved

系统 SHALL 自动保存设置页中的有效回答字号，并在应用重启后保留。系统 SHALL 将已保存的字号应用于下一次打开的回答卡片；本变更 SHALL 沿用打开设置会结束当前回答会话的行为，不要求在原会话上实时调字号。

#### Scenario: Preference survives restart

- **WHEN** 用户调整回答字号、设置自动保存成功，并重新启动应用
- **THEN** 设置页显示此前保存的字号
- **AND** 新打开的回答卡片使用该字号

#### Scenario: Next card uses the changed preference

- **WHEN** 用户从托盘打开设置、修改字号并重新发起一次提问
- **THEN** 原会话按既有流程结束
- **AND** 新回答卡片使用修改后的字号，无须用户额外点击保存

### Requirement: Compatible font preference loading

系统 SHALL 在字号缺失、不是数值或非有限时使用默认 16px，将有限越界数值限制到 14–24px 并取整数。读取和更新字号 SHALL 保留其他设置的已保存值。

#### Scenario: Existing configuration has no font preference

- **WHEN** 应用读取没有回答字号字段的旧配置
- **THEN** 设置页和新回答卡片使用有效的默认字号
- **AND** 用户现有的模型、手势和开机启动设置不因缺少该字段而重置

#### Scenario: Invalid font preference

- **WHEN** 配置中的字号不是有效数值或不属于最终确定的支持范围
- **THEN** 非数值或非有限值回退到 16px，有限越界值限制到 14–24px 并取整数
- **AND** 卡片不因无效字号而无法阅读

#### Scenario: Font update does not persist model drafts

- **WHEN** 设置页有未保存的模型配置草稿，用户修改回答字号
- **THEN** 自动保存仅提交此次字号配置
- **AND** 模型草稿不随字号修改被保存

### Requirement: Remove capture timestamp from the card

系统 SHALL 从回答卡片的可见界面删除「快照 · 时间」显示。本要求仅删除显示，不要求删除截图时间数据或改变截图、追问所使用的画面。

#### Scenario: Card context has no capture timestamp

- **WHEN** 用户查看新打开的回答卡片
- **THEN** 卡片不显示「快照」及其截图时间组成的元信息

### Requirement: Screenshots are not displayed in the answer card

系统 SHALL NOT 在回答卡片展示截图、截图查看入口或定位预览。截图与定位数据 SHALL 继续用于现有模型提问及追问流程，不因隐藏展示而丢失。

#### Scenario: Card with captured context

- **WHEN** 卡片拥有截图上下文并显示回答
- **THEN** 卡片中没有截图、截图入口或定位预览
- **AND** 提问和追问继续沿用该截图上下文

### Requirement: Remove persistent keyboard instructions

系统 SHALL 取消卡片底部常驻的「Enter 发送 · Shift + Enter 换行」说明，同时保留原有键盘行为。取消说明 SHALL NOT 隐藏当前操作错误或复制完成等临时反馈。本变更不要求增加替代说明入口。

#### Scenario: Composer footer has no persistent keyboard hint

- **WHEN** 卡片没有临时操作反馈
- **THEN** 底部不常驻显示 Enter 发送和 Shift + Enter 换行的说明

#### Scenario: Enter still sends a question

- **WHEN** 用户在可发送状态下输入问题并按 Enter
- **THEN** 问题按原有流程提交

#### Scenario: Shift Enter still inserts a newline

- **WHEN** 用户在输入框按 Shift + Enter
- **THEN** 输入框插入换行

#### Scenario: Enter respects composition input

- **WHEN** 用户通过中文输入法组合输入时按 Enter 确认文字
- **THEN** 系统遵循既有组合输入处理，不将该按键误作问题提交

#### Scenario: Necessary transient feedback remains visible

- **WHEN** 用户复制回答成功或卡片操作失败
- **THEN** 对应临时反馈仍可见，不被当作常驻快捷键说明删除

### Requirement: Reading layout preserves answer interactions

系统 SHALL 在受支持的字号下完整呈现回答内容并支持长回答滚动。卡片视觉调整 SHALL 保留原有 Markdown、提问、复制、停止生成、失败重试及链接能力，不得误删用户实际输入的问题或回答正文；首轮自动生成的任务提示不显示。

#### Scenario: Long Markdown answer remains usable

- **WHEN** 回答包含长段落、列表、标题、代码、表格和链接，用户使用最终支持范围内的较大字号
- **THEN** 内容可阅读和滚动，正文不会被卡片边界裁掉
- **AND** 过宽代码与表格仍可在各自区域查看，链接操作继续可用
- **AND** 输入和发送、停止等必要操作没有被挤出可操作区域

#### Scenario: Card states remain understandable

- **WHEN** 卡片处于待提问、生成中、已完成、已停止或请求失败状态
- **THEN** 各状态的必要反馈和对应操作仍可使用
- **AND** 用户问题及已生成的回答内容不因文字精简而消失

### Requirement: Content focused card styling

系统 SHALL 提供纯白简约卡片，默认宽 640 个逻辑像素，外边框为 2px 浅灰、圆角为 20px。卡片顶部 SHALL 在左上显示 Logo 与“PingScreen”、右上显示仅含 X 的关闭按钮，不显示意图标签、截图入口或设置按钮；保留窗口拖动、Esc 关闭和托盘设置能力。卡片 SHALL NOT 维持固定 16:10 比例或允许用户手工缩放。

#### Scenario: Compact card hierarchy

- **WHEN** 用户查看完成状态的回答卡片
- **THEN** 左上只有 Logo 与“PingScreen”，右上为 X 关闭按钮，卡片与底部输入区均为纯白底色
- **AND** 默认宽度为 640px，外边框为 2px 浅灰、圆角为 20px，回答区与输入区通过留白区分
- **AND** 每轮正文没有新增的重底色容器

#### Scenario: Restricted work area

- **WHEN** 工作区无法容纳默认卡片宽度或当前目标高度
- **THEN** 卡片实际宽度不超过 640px 及工作区宽度，高度不超过实际宽度 及工作区高度，窗口完整位于工作区内
- **AND** 内容仍可滚动，输入框和发送按钮可操作

### Requirement: Answer card height grows with content

系统 SHALL 在新会话以约 160px 高度打开卡片，初始高度不得超过实际宽度 及工作区可用高度。随着可见回答内容增加，系统 SHALL 按内容所需高度增高整个窗口，同一会话不因内容变短而收缩，工作区约束变化除外。系统 SHALL 将高度限制在实际宽度 以内，达到上限后仅回答区滚动，顶部和底部输入区保持可见。

#### Scenario: New card starts compact

- **WHEN** 用户在可容纳默认尺寸的工作区打开新会话，尚无回答内容
- **THEN** 卡片宽 640px、初始高约 160px，不保留上一会话的高度或空白占位
- **AND** 品牌、X、空白输入框及圆形发送按钮可见，不增加说明文字

#### Scenario: Streaming answer increases height

- **WHEN** 默认卡片正在连续输出回答，内容自然高度超过当前窗口高度且尚未达到上限
- **THEN** 整个窗口随内容增高，最高为 640px，宽度保持 640px
- **AND** 不为每次文字更新反复缩小或来回跳动，不挤走输入区

#### Scenario: Long answer scrolls at the height limit

- **WHEN** 回答、用户问题及必要反馈所需高度超过实际卡片宽度
- **THEN** 窗口停止增高，回答区通过滚动访问完整内容
- **AND** 顶部 X 与底部输入、发送或停止按钮保持可操作

#### Scenario: Follow-up and shorter content keep the attained height

- **WHEN** 同一会话发生追问、停止、完成、反馈消失或重试，且工作区约束没有变化
- **THEN** 尺寸计算包含所有可见问答，已达到的高度不因内容变短而收缩
- **AND** 新内容仅在需要且未达上限时使窗口继续增高

#### Scenario: Actual width determines the height limit

- **WHEN** 工作区使卡片实际宽度限制为 320px
- **THEN** 高度上限为 320px，不沿用默认宽度下的 640px 上限
- **AND** 输入和发送、停止仍可操作，长回答可滚动

#### Scenario: Growth near the bottom of the work area

- **WHEN** 卡片位于工作区底部附近并随回答增高
- **THEN** 窗口按需上移以保持完整可达，不超出工作区
- **AND** 用户拖动后的当前位置被保留作为调整依据，不返回最初截图位置

#### Scenario: Scroll position remains usable during generation

- **WHEN** 用户在生成中向上滚动阅读已有内容
- **THEN** 增高及后续输出不强制将用户拉回底部
- **AND** 用户接近底部时继续沿用跟随最新内容的行为

### Requirement: Close button ends the current answer session

系统 SHALL 在右上角提供只显示 X 的关闭按钮，具有“关闭”可访问名称，支持鼠标及键盘操作且不属于窗口拖动区域。X 与 Esc SHALL 使用相同关闭行为：结束当前会话、关闭卡片并中止正在生成的请求；关闭后的延迟输出或尺寸更新不得重新显示卡片或影响下一会话。

#### Scenario: Close an idle or completed card

- **WHEN** 用户点击右上角 X 或通过键盘激活该按钮
- **THEN** 当前回答卡片关闭、会话结束，行为与 Esc 一致
- **AND** 点击按钮不会变成拖动窗口

#### Scenario: Close while generating

- **WHEN** 用户在回答生成中点击 X
- **THEN** 当前请求被中止，卡片关闭
- **AND** 后续到达的输出和高度事件不重新打开卡片

#### Scenario: Reused window starts a new session safely

- **WHEN** 用户关闭旧卡片后打开新会话，旧会话仍有延迟事件
- **THEN** 新会话从自身的紧凑高度及内容开始显示
- **AND** 旧事件不修改新会话的内容、高度或可见状态

### Requirement: Minimal inline composer

系统 SHALL 在卡片下部提供无提示文本的输入框和位于右侧的圆形发送按钮，发送按钮仅显示向上箭头并具有可访问名称。生成中同一位置 SHALL 提供停止操作，复制和失败等临时反馈仅在需要时显示；初始待提问状态不增加说明文字。

#### Scenario: Empty composer

- **WHEN** 用户打开待提问或已完成的卡片，输入框为空
- **THEN** 输入框不显示 placeholder，右侧圆形发送按钮不显示“发送”文字
- **AND** 输入框与按钮横向排列，输入框具有可访问名称

#### Scenario: Generation can be stopped

- **WHEN** 模型正在生成回答
- **THEN** 原发送位置提供无常驻文字的停止按钮
- **AND** 用户能够停止生成且已生成内容保留
