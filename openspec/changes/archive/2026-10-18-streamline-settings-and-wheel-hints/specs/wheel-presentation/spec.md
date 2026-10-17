# Spec Delta

## Purpose

在轮盘选择意图时减少遮挡屏幕内容的固定操作说明，让用户专注于目标画面和轮盘本身，同时保留识别当前选择、翻译范围与取消手势所需的反馈及原有操作能力。

## ADDED Requirements

### Requirement: No top instruction banner while wheel is visible
系统 SHALL 在轮盘显示期间隐藏屏幕顶部的操作说明条，包括拖动提交说明、翻译点／条滚轮说明和“Esc 取消”文字。该要求 SHALL 同时覆盖四项、五项轮盘及框选后再次选择意图的轮盘，不要求删除框选进行中独立的提示。

#### Scenario: Open a gesture wheel
- **WHEN** 用户触发四项或五项手势轮盘
- **THEN** 屏幕顶部不出现操作说明条，移动至翻译扇区或切换翻译范围也不使顶部说明重新出现

#### Scenario: Choose an intent after region selection
- **WHEN** 用户完成框选并进入选择意图的轮盘
- **THEN** 屏幕顶部不显示“点击轮盘选择意图”或“Esc 取消”等操作说明

### Requirement: Wheel feedback and actions remain available
系统 SHALL 保留轮盘扇区、当前意图反馈、翻译点／条状态及轮盘附近的取消反馈。删除顶部说明 SHALL 不改变拖动与松开提交、滚轮切换范围、框选后选意图、Esc 和其他既有取消方式，以及截图和模型请求行为。

#### Scenario: Switch translation scope
- **WHEN** 用户在翻译扇区通过滚轮切换点／条并提交
- **THEN** 轮盘附近可识别当前范围，提交使用对应翻译范围，且屏幕顶部没有说明条

#### Scenario: Cancel without a top keyboard hint
- **WHEN** 用户在轮盘显示期间按 Esc 或使用既有取消方式
- **THEN** 当前手势被取消，不因隐藏说明而失去取消能力或误发请求
