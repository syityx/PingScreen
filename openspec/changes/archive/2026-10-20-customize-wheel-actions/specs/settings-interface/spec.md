# Spec Delta

## MODIFIED Requirements

### Requirement: Failure only automatic save feedback
系统 SHALL 保持手势、开机启动和回答字号等普通偏好的自动保存行为，仅在失败时显示自动保存提示，不常驻显示普通、进行中或成功文字。轮盘 SHALL 通过二级编辑页统一手动保存并保护未保存退出。模型连接显式保存、连接测试及切换服务商的必要反馈 SHALL 继续可用。

#### Scenario: Automatic save succeeds
- **WHEN** 用户修改手势、开机启动或回答字号并保存成功
- **THEN** 对应值自动持久化，界面不显示自动保存的普通、进行中或成功文字
- **AND** 未保存的模型连接及轮盘草稿不会被提交

#### Scenario: Automatic save fails
- **WHEN** 普通自动保存偏好无法保存
- **THEN** 界面显示失败原因，并沿用现有失败回退行为，不将未保存值伪装为保存成功

#### Scenario: Wheel uses explicit save
- **WHEN** 用户编辑轮盘并离开输入框或完成三级自定义配置
- **THEN** 变更只更新轮盘草稿，直到二级页统一保存才生效
