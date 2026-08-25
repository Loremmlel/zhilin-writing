# Activity Events 与站内通知 V2 设计

## 范围

在现有“知临中学”V1 上增加统一公开事件日志、用户 Activity 与私人通知中心。保留现有 ChatGPT 登录、站点白名单、Profile、帖子、两层回复、编辑器、附件与草稿架构。本次不实现 Revision、Annotation、AnnotationGuard、复杂恢复、自由 @mention 或实时推送。

## 事件模型

`activity_events` 是 canonical event log，首期记录 `POST_CREATED` 和 `POST_REPLY_CREATED`。每条事件引用当前 actor、post、可选 reply/root reply/reply-to user，并保留可扩展的 `metadata_json`。事件 ID 由业务实体稳定派生，保证同一帖子或回复的公开动作只产生一条事件。公开 Activity 永不记录阅读、搜索、登录、资料修改、编辑、删除、管理操作、上传或草稿。

帖子或回复的业务写入、事件写入以及适用的通知写入使用同一 D1 batch。回复通过作者范围内的提交幂等键防止 UI/网络重试重复创建。

## 通知模型

`notifications` 是按 `recipient_user_id` 隔离的私人投递记录，通过 `event_id` 关联公开事件。一级回复通知帖子作者；回复任意回复时通知被直接回复者 `reply_to_user_id`，而不是 root 作者；actor 与 recipient 相同则不投递。通知 ID 由 event、recipient 与 type 稳定派生，并以唯一索引兜底去重。

## 查询与展示

个人主页增加 `Posts | Activity`。Activity 按 `created_at DESC` 展示 actor 当前资料与当前可访问内容；关联内容删除或隐藏时只显示不可用状态，不泄漏原文。

导航栏显示当前用户未读数，通知页支持“全部 / 未读”和一次性全部标记已读。点击单条通知先在服务端校验归属并写入 `read_at`，再跳转帖子与稳定 reply anchor。目标 reply 删除时打开仍可见帖子并显示删除提示；帖子不可见时显示明确不可用状态。

## 权限

所有页面继续经过现有 `requireMember`。通知读取、单条已读与全部已读都必须带 `recipient_user_id == current_user_id` 条件。Activity 只展示当前整站成员可见的公开行为。

## 未来 Annotation 接入

后续新增 `ANNOTATION_CREATED`、`ANNOTATION_REPLY_CREATED` 与相应 nullable entity 字段，再复用同一事件创建、通知投递、Activity 渲染和通知目标解析流程；V2 不建立空批注表。

## 验收重点

覆盖帖子/回复事件、直接接收者解析、自回复无通知、重复提交幂等、未读计数与全部已读、稳定回复定位、当前 Profile 展示、删除内容降级、通知所有权校验，以及现有登录/白名单不回退。
