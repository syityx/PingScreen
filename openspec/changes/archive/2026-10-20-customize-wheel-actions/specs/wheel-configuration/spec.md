# Spec Delta

## Purpose

允许用户按常用屏幕任务配置轮盘的功能、顺序和显示项数，并在切换布局及重启后保留完整配置。点选与框选共用同一套功能配置，使轮盘展示、手势选择和最终执行保持一致。

## ADDED Requirements

### Requirement: One ordered configuration for all wheel sizes
系统 SHALL 维护一套六槽位有序配置，支持四、五、六项显示，实际轮盘仅使用前 N 个槽位。切换显示项数 SHALL 保留隐藏槽位的功能、名称、图标、提示词和顺序，且配置在重启后保留。

#### Scenario: Switch sizes without losing hidden actions
- **WHEN** 用户配置六个槽位，依次切换为四项、五项、六项并重启应用
- **THEN** 每个布局分别显示同一顺序的前四、前五、全部六项，隐藏过的功能配置保持原值

### Requirement: Layered wheel editing in the same window
系统 SHALL 在主配置页轮盘分类仅展示轮盘预览及右侧编辑按钮。点击后 SHALL 在同一窗口进入二级页，左侧预览、右侧纵向功能列表，顶部提供项数及保存入口，二级及三级页隐藏主导航并占满窗口；所有六个槽位可编辑，隐藏项有标记。自定义选项 SHALL 进入仅配置名称、图标、提示词的三级页，完成只更新草稿并返回二级页。返回主页面 SHALL 保留原位置和其他分类草稿。

#### Scenario: Open editor and return
- **WHEN** 用户从主轮盘预览右侧点击编辑再返回
- **THEN** 当前窗口切换页面，不打开新窗口或标签页，返回后主页面滚动位置和模型连接草稿保持

#### Scenario: Complete custom editing
- **WHEN** 用户选择自定义并在三级页填写有效名称、图标和提示词，点击完成
- **THEN** 返回二级页，列表及预览显示草稿内容，已保存轮盘不变

### Requirement: Handle based ordering
系统 SHALL 在列表每项右侧仅提供编辑按钮和 3×3 小方块拖动按钮。用户 SHALL 能按住手柄并用鼠标左键拖动整行排序，预览实时同步，列表换位 SHALL 平滑过渡且不因动画抖动，减少动态效果时直接换位；拖动取消 SHALL 恢复原顺序。键盘 SHALL 能通过同一手柄调整顺序。所有功能在 700×400 及侧栏两种状态下均可访问。

#### Scenario: Reorder with the mouse or keyboard
- **WHEN** 用户拖动某槽位的九宫格手柄到另一位置，或聚焦手柄使用方向键
- **THEN** 同一槽位身份随整行移动，列表和预览顺序一致，已保存配置不变

#### Scenario: Cancel a drag
- **WHEN** 用户拖动过程中按 Esc 或发生指针取消
- **THEN** 恢复拖动前顺序，不触发功能编辑

### Requirement: Focused function chooser
系统 SHALL 仅在点击列表编辑按钮时将对应行稍微放大，并保持该行和功能选择操作清晰，其余背景虚化且不可操作。功能选项 SHALL 包含五种预设和自定义。点击背景或按 Esc SHALL 退出聚焦并恢复焦点；点击行、长按和拖动 SHALL 不触发该效果。

#### Scenario: Choose a preset or custom function
- **WHEN** 用户点击编辑并选择预设或自定义
- **THEN** 预设更新草稿并关闭聚焦，自定义进入三级配置页

#### Scenario: Dismiss focus
- **WHEN** 用户点击聚焦层背景或按 Esc
- **THEN** 返回正常二级列表，原编辑按钮获得焦点，未选择功能不改变草稿

### Requirement: Preview transition between pages
系统 SHALL 在主配置页与二级页之间连续过渡轮盘预览的位置和大小，并支持反向返回。快速导航或调整窗口 SHALL 不留下旧预览副本，系统减少动态效果时 SHALL 直接切换且保留全部编辑能力。

#### Scenario: Animate navigation and respect reduced motion
- **WHEN** 用户进入或离开二级编辑页
- **THEN** 预览平滑移动与缩放，减少动态效果启用时直接到达最终位置和大小

### Requirement: Validated atomic wheel preferences
系统 SHALL 仅在二级页点击保存或退出弹窗选择保存时校验并整体保存项数、顺序及功能草稿。失焦、排序、项数切换和三级页完成 SHALL 不提交配置。无效输入 SHALL 提示字段错误；保存失败 SHALL 保留完整草稿并停留在编辑会话。保存 SHALL 不提交模型连接草稿。

#### Scenario: Draft changes do not affect runtime before save
- **WHEN** 用户修改功能、项数、排序并完成三级页编辑但未保存
- **THEN** 预览反映草稿，配置文件与实际手势仍使用最后成功保存的轮盘

#### Scenario: Save succeeds or fails
- **WHEN** 用户在二级页保存完整轮盘
- **THEN** 成功时全部配置一起生效，失败时显示原因并保留草稿和页面，模型草稿不被提交

### Requirement: Guard unsaved exits
系统 SHALL 在有未保存修改时对返回主配置页、切换分类及关闭设置窗口显示保存并退出／不保存退出／取消弹窗。保存成功后 SHALL 执行原退出动作；保存或校验失败 SHALL 停留；不保存 SHALL 恢复生效配置；取消 SHALL 保留页面、草稿和焦点。三级页完成或返回二级页 SHALL 保留草稿而不视为退出会话。

#### Scenario: Choose each exit action
- **WHEN** 用户带修改尝试离开轮盘编辑并选择保存、不保存或取消
- **THEN** 分别保存成功后离开、丢弃后离开或留在原页面，失败保存不允许离开

### Requirement: Region wheel derives from visible actions
系统 SHALL 在完成框选后取当前布局的前 N 个槽位、过滤其中所有“框选”项，并保持其余项的相对顺序，按剩余数量均分显示功能轮盘。隐藏槽位 SHALL 不因过滤而补入。系统 SHALL 保证可保存的配置中，四、五、六项布局过滤后均至少有一个可执行功能。

#### Scenario: Filter region without revealing hidden functions
- **WHEN** 五项可见顺序为解释、翻译、自定义审查、提问、框选，第六项是另一自定义功能，用户完成框选
- **THEN** 后续轮盘显示解释、翻译、自定义审查、提问四项，隐藏的第六项不显示
- **AND** 选择自定义审查时使用选中区域作为目标

#### Scenario: Configured wheel has no region action
- **WHEN** 当前可见项没有框选功能
- **THEN** 手势轮盘不显示框选入口，不额外插入框选或隐藏功能

#### Scenario: Reject a wheel with only region actions
- **WHEN** 用户尝试保存前四个槽位均为框选的配置
- **THEN** 系统拒绝保存并说明必须保留可执行功能，不生成空的后续轮盘

### Requirement: Compatible configuration loading
系统 SHALL 在缺少新槽位配置时保留旧四项／五项选择及解释、翻译、改写、提问、框选的原有顺序，默认仍为五项。新字段损坏时 SHALL 提供可用回退，不导致轮盘崩溃或重置其他偏好、服务商配置及密钥；首次读取 SHALL 不主动改写设置文件。

#### Scenario: Upgrade old four or five item settings
- **WHEN** 应用读取仅有旧轮盘项数的配置
- **THEN** 四项仍显示解释、翻译、改写、提问，五项仍增加框选，其他已保存设置保持

#### Scenario: Invalid new wheel settings
- **WHEN** 槽位配置存在未知功能、损坏结构或无效自定义字段
- **THEN** 应用加载可用的回退轮盘，合法的其他设置仍被保留
- **AND** 未知图标不造成界面加载失败

### Requirement: Neutral custom input focus
系统 SHALL 在三级页名称与提示词输入框聚焦时保留中性边框，不出现蓝色线条、外轮廓或光晕。

#### Scenario: Focus custom fields
- **WHEN** 用户点击名称或提示词输入框
- **THEN** 光标正常进入输入框，边框保持中性，仍可编辑及校验
