# settings-interface Specification

## Purpose

为配置页提供清晰、易读且紧凑的信息层级，让用户在较小窗口中直接调整设置，通过可收起的侧栏和可打断的平滑跳转访问各分类，同时可靠地理解操作失败与配置状态。

## Requirements

### Requirement: Bundled simplified Chinese settings typeface
系统 SHALL 为配置页内置未来荧黑 SC 标准宽度版，中文、西文、数字及输入控件统一使用该字体，提供原生 400、500 和 600 字重。字体 SHALL 不依赖系统安装或远程加载，并随应用附带其开源许可；原有字号及单行高度约束继续生效。

#### Scenario: Display the selected typeface offline
- **WHEN** 用户在未安装未来荧黑、没有网络的电脑上打开配置页
- **THEN** 配置页从应用内资源加载未来荧黑 SC 标准宽度版，普通文字、配置项名称及标题使用对应实际字重
- **AND** 控件和分类仍可完整访问，单行配置项继续保持统一高度

### Requirement: Consistent single line setting rows
系统 SHALL 对只有一行的配置项使用统一行高，图标、名称和控件在行内垂直居中，不因使用下拉框、滑块或开关而产生不同的外框高度。多行内容和异常提示 SHALL 允许按实际内容增高。

#### Scenario: Mixed controls share a common row height
- **WHEN** 用户在默认或最小窗口、侧栏展开或收起状态查看触发键、拖动阈值、开机启动和回答字号
- **THEN** 这些单行配置项的外框高度一致，图标、名称和各类控件垂直居中
- **AND** 下拉框不会将所在行撑成不同高度，滑块行也没有额外的横向缩进

### Requirement: Concise setting content
系统 SHALL 让普通配置项仅呈现名称、控件和当前值，删除分类副标题、重复的项目解释、三块蓝色说明卡片及应用分类的安全说明卡片。精简 SHALL 保留可操作控件、必要错误与输入含义，不删除版本和版权归属信息。

#### Scenario: Settings contain fewer explanations
- **WHEN** 用户浏览模型连接、手势、轮盘和应用分类
- **THEN** 分类下不显示宣传副标题，触发键、拖动阈值、开机启动和回答字号不再附带常驻解释段落
- **AND** 不显示“只在你发起手势时读取画面”“单击继续交给原应用”“聚焦目标，不改变定位”蓝色卡片及“API Key 使用 Windows 系统加密”说明卡片

#### Scenario: Essential configuration remains understandable
- **WHEN** 用户填写模型连接或调整应用偏好
- **THEN** 字段名称、可选项、当前值、保存／测试操作及输入必要含义仍可识别
- **AND** 密钥输入仍能区分未配置、留空保留和待清除状态，配置失败原因仍可见

### Requirement: Failure only automatic save feedback
系统 SHALL 保持普通偏好的自动保存行为，仅在保存失败时显示自动保存提示，不常驻显示“修改即自动保存”“正在自动保存”或“已自动保存”。模型连接显式保存、连接测试及切换服务商的必要反馈 SHALL 继续可用。

#### Scenario: Automatic save succeeds
- **WHEN** 用户修改手势、轮盘、开机启动或回答字号并保存成功
- **THEN** 对应值自动持久化，界面不显示自动保存的普通、进行中或成功文字
- **AND** 未保存的模型连接草稿不会被提交

#### Scenario: Automatic save fails
- **WHEN** 普通偏好无法保存
- **THEN** 界面显示失败原因，并沿用现有失败回退行为，不将未保存值伪装为保存成功

### Requirement: Compact runtime status
系统 SHALL 在配置页状态栏显示状态圆点、状态名称和启用开关，删除正常状态下的手势操作说明及重复的“开启／关闭”文字。系统 SHALL 保留启动、暂停和输入助手失败等真实状态以及必要异常提示。

#### Scenario: Ready and paused state
- **WHEN** 输入助手处于运行或暂停状态
- **THEN** 状态栏分别显示“已就绪”或“已暂停”，以及对应开关状态
- **AND** 不附带“按住……拖向意图后松开提交”等常驻说明

#### Scenario: Helper failure remains visible
- **WHEN** 输入助手启动失败
- **THEN** 状态栏显示异常状态及可用的处理提示，不显示为已就绪

### Requirement: Larger typography with compact layout
系统 SHALL 将配置项名称、选项和输入文字显示为 15px，分类标题显示为 20px；版本和版权等次要信息保持较小。系统 SHALL 通过减少内边距和分类间距形成紧凑布局，在最小窗口及侧栏两种状态下保持文字、控件与底部内容可访问。

#### Scenario: Readable configuration text
- **WHEN** 用户查看配置页
- **THEN** 配置项名称、下拉选项及输入文字为 15px，分类标题为 20px
- **AND** 回答字号偏好仍仅作用于下一张回答卡片，不改变配置页的固定字号

#### Scenario: Minimum size remains usable
- **WHEN** 用户将窗口缩至 700 × 400，并分别展开和收起侧栏
- **THEN** 所有分类可访问，字段、数值和操作按钮不重叠、不被横向裁切，底部内容可通过滚动访问
- **AND** 空间不足时允许合理换行，不通过缩小文字强行塞入单行

### Requirement: Settings window geometry
系统 SHALL 在可容纳默认尺寸的屏幕工作区中，以 900 × 560 的窗口尺寸初始打开配置页，最小窗口尺寸为 700 × 400，并允许用户移动及缩放窗口。该约束 SHALL 仅作用于配置窗口。

#### Scenario: Open and resize settings
- **WHEN** 用户首次创建配置窗口，屏幕工作区可容纳默认尺寸
- **THEN** 窗口尺寸为 900 × 560，用户可以拖动窗口及调整大小
- **AND** 手动缩放不能小于 700 × 400

#### Scenario: Other windows are unchanged
- **WHEN** 用户触发轮盘或打开回答卡片
- **THEN** 它们继续遵循各自的尺寸和交互约束，不使用配置页的尺寸限制

### Requirement: Collapsible settings sidebar
系统 SHALL 在配置页默认展开侧栏，提供可通过鼠标及键盘操作的收起／展开按钮。收起后 SHALL 仅展示图标导航，悬停显示分类名称，并保留可访问名称、当前分类高亮和恢复展开入口。

#### Scenario: Collapse and restore sidebar
- **WHEN** 用户点击侧栏收起按钮
- **THEN** 侧栏缩为仅图标的窄栏，内容区获得更多横向空间，当前分类及输入草稿保持
- **AND** 再次点击展开按钮后恢复名称和图标导航

#### Scenario: Identify icon only destinations
- **WHEN** 侧栏已收起，用户悬停分类图标或使用键盘访问导航
- **THEN** 鼠标悬停显示分类名称，键盘及辅助技术仍能识别和激活各分类
- **AND** 收起／展开按钮自身也具有可识别的名称与展开状态

### Requirement: Natural manual scrolling
系统 SHALL 保留四分类连续页面，手动滚动自然跟手，停止后不自动吸附到分类标题。滚轮、触控板、滚动条和滚动键操作 SHALL 能立即接管尚未完成的侧栏跳转，不被旧动画继续拉回。

#### Scenario: Stop between categories
- **WHEN** 用户手动滚动并停在两个分类之间
- **THEN** 页面保留该位置，不自动向任一分类标题移动

#### Scenario: Interrupt sidebar navigation
- **WHEN** 点击侧栏后平滑跳转仍在进行，用户进行滚轮、触控板、滚动条拖动或页面滚动键操作
- **THEN** 程序跳转停止，页面立即响应用户操作，旧跳转不恢复
- **AND** 编辑输入框时的方向键保留其正常编辑含义

### Requirement: Smooth navigation and stable highlighting
系统 SHALL 在点击侧栏时短暂、柔和地滚动至对应分类；连续点击时以最新目标为准。导航高亮 SHALL 稳定反映用户选择或手动滚动后的当前阅读位置，末尾分类不能对齐顶部时仍可正确选中。系统 SHALL 尊重系统减少动态效果偏好。

#### Scenario: Latest destination wins
- **WHEN** 用户在一次跳转完成前又点击另一分类
- **THEN** 页面从当前显示位置转向最新目标，不排队执行旧跳转
- **AND** 跳转途中高亮不因经过其他分类而闪烁

#### Scenario: Short final section
- **WHEN** 用户点击内容较短的末尾分类，页面剩余高度不足以将其标题移至顶部
- **THEN** 页面滚至可到达的最近位置，点击的分类仍保持高亮

#### Scenario: Manual scrolling updates highlight
- **WHEN** 用户接管滚动或导航完成后继续手动滚动
- **THEN** 高亮稳定更新至当前阅读分类；窗口缩放和侧栏收起后也能重新正确定位

#### Scenario: Reduced motion
- **WHEN** 系统启用减少动态效果偏好，用户点击侧栏分类
- **THEN** 页面直接到达目标位置，不播放平滑滚动动画
