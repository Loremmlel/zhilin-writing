# 知临中学 V8 跨段批注设计

## 目标与边界

V8 恢复跨段批注，但不把 Markdown 扩展为新的容器语法，也不修改数据库关系。用户可在连续、受支持的正文块间建立一条批注；阅读、讨论、通知、生命周期和 revision 仍把它视为一个逻辑 thread。

支持根级段落与标题，以及列表项、引用中的段落。代码块、表格、图片、附件、行内代码、硬换行和其他不支持节点是不可跨越的 barrier。批注仍不得重叠或嵌套。

## Canonical Markdown

同一逻辑批注在每个参与块内写一个 inline directive，并复用同一个 `annotation_id`：

```md
:annotation[第一段后半]{#ann_id}

:annotation[第二段全文]{#ann_id}

:annotation[第三段前半]{#ann_id}
```

合法拓扑必须同时满足：

1. 物理段在完整文档块序中连续，中间没有 barrier；
2. 每个块最多一个同 ID 物理段；
3. 第一段覆盖到首块最后一个可见字符；
4. 中间段覆盖块内全部可见字符；
5. 最后一段从末块第一个可见字符开始。

逻辑 `selected_text` 按块以两个换行符连接。数据库仍保存一条 `annotations` 和一条 `post_annotation_anchors`；anchor 的 block ordinal 取第一物理段，选区 descriptor 保持首块起点与末块终点，不新增 migration。

## 创建、阅读与编辑

- DOM Selection 先确认选区只经过连续受支持块，再为每块计算本地 offset；服务端重新解析当前 Markdown 并执行相同验证。
- wrap 为每块生成同 ID directive，unwrap 一次移除该 ID 的全部物理段。
- 阅读页、编辑页和深链同时激活所有同 ID mark；侧栏卡片和 connector 以第一段可见范围定位。
- AnnotationGuard 只保护逻辑范围最左、最右两个端点。正常的 split/join 及内部段落边界编辑只要结果仍满足 canonical 拓扑，就不触发撤下确认。
- revision signature 聚合全部物理段，保证跨段文本或结构变化仍进入既有冲突与恢复检查。

## DOCX Import

Word comment 的起止 marker 可以跨连续受支持文本块。IR 使用可选 `endBlockId` 表达末块，Markdown renderer 输出同 ID 多段 directive，Preview 与 Commit 都重新校验块序、每块范围、重叠、aggregate selected text 和 canonical topology。穿过不支持节点的 comment 继续作为 typed warning 跳过。

## 验收

- 单段行为与旧 revision round-trip 不回归；
- 段落、标题、引用、列表间的合法跨段 selection 可创建、解析、删除；
- barrier、空段、跳段、部分覆盖中间段、重叠和嵌套被拒绝；
- split/join 与内部边界编辑安全，逻辑外端点删除仍触发 AnnotationGuard；
- 同 ID 多 mark 在阅读与编辑布局中共同激活；
- DOCX 跨段 comment 通过 Worker → Preview → Commit → reload 全链路，仍只生成一个 thread/anchor。
