# 知临中学 V5 Annotation 设计

## 目标与边界

V5 把正文批注建立为 Markdown AST、Milkdown/ProseMirror document、数据库、revision、Activity 与 Notification 中的一等实体。它只支持一个合法文本块中的连续文本，不支持跨块、代码、图片、附件、表格、多重或重叠批注，也不提前实现 V6 AnnotationGuard。

## Canonical representation

内部 Markdown 使用 `:annotation[正常 inline Markdown]{#ann_UUIDv4}`。`textDirective` children 保留 plain、bold、italic、strikethrough 与 link；编辑器 schema 使用 `annotation` mark，属性为 `annotationId`，边界 `inclusive: false`。普通用户没有 source mode，也不能通过 post create/update 写入 directive。

阅读页 DOM 只负责把临时 selection 映射为 `{blockOrdinal, endBlockOrdinal, blockTextFrom, blockTextTo, selectedText}`。服务器重新解析当前 Markdown，并验证同块、非空白、可支持节点、文字完全一致与无 overlap。DOM position、Markdown source offset、前后文和文字搜索都不是持久锚点。

## Persistence and consistency

- `annotations` 保存 stable id、post/author、不可编辑的内容 Markdown、历史 `original_selected_text`、创建 revision 和软删除/隐藏状态。
- `annotation_replies` 保存一层 thread membership、直接目标用户/回复、不可编辑内容和生命周期状态。
- `post_annotation_anchors` 是当前 revision 的批注成员关系。
- `revision_annotation_states` 保存某 revision 中每个 anchor 的 deleted/hidden 状态；V5 前 revision 没有行即空快照。

`createAnnotation` 在一个 D1 batch 中执行 revision CAS、annotation row、canonical Markdown、current anchor、asset/annotation snapshot、Activity 与 Notification。ID 由服务器生成，submission UUID 保证重试幂等。回复 mutation 同样在一个 batch 中写 reply、direct-target event/notification 与 activity timestamp。

## Lifecycle and restore

无其他成员回复时，作者删除根批注会 unwrap 当前 Markdown、移除 current anchor 并生成 `ANNOTATION_STATE` revision；存在其他成员回复时保留 anchor，只隐藏根内容。批注回复只显示一层，已删除/隐藏内容仅在可见直接回复依赖时保留占位。管理员 hide/unhide 复用 V4 内容管理与审计；当前根状态变化生成 annotation-state revision，回复状态变化不生成正文 revision。

管理员 restore 先证明 current/source Markdown IDs、anchors、snapshot rows 和 post ownership 一致，再在同一事务中复制 source 正文、assets、anchors 和 root states 为新的 `RESTORE` revision。退出当前版本的 annotation rows、replies、Activity 与 Notification 历史保留，但不再属于当前正文。

## Reading interaction

桌面用稳定 annotation id 联动正文 mark、右侧卡片与 SVG connector；卡片按正文顺序放置并向下避让。移动端隐藏侧栏与 connector，点击 mark 打开共享 dialog primitive 的 bottom-sheet 变体。删除/隐藏/退出当前版本后的深链只显示占位或“该批注已不可用”，不泄漏原文，也不返回 404/500。

## V6 entry point

V5 在 current anchors 非空时锁定普通 post editor。V6 应在 ProseMirror transaction/filter/appendTransaction 层接入 AnnotationGuard，覆盖边界删除、selection replace、Cut/Paste、Undo/Redo 与中文 IME，再解除这条锁定；不应改为 string patch。
