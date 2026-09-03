# 知临中学 V5.5 DOCX Import 设计

## 状态

- 日期：2026-08-28
- 状态：架构章节已由用户逐项确认，等待本文档最终审阅
- 范围：`.docx` → canonical Markdown + Annotation + Annotation Replies
- 非目标：Word renderer、DOCX export、AnnotationGuard、跨块/重叠/表格/图片 Annotation

## 目标与设计原则

V5.5 将 Word 中本站能够表达的语义确定性地转换为现有数据模型。支持的结构必须生成稳定、可测试的 Import IR 和 canonical Markdown；不支持的结构必须按明确规则降级、跳过或拒绝，不能静默损坏数据。

生产路径采用浏览器 Web Worker 中的轻量 OOXML Import Walker：ZIP 解压与 XML 语法解析使用成熟库，本站自己实现 styles、numbering、document、comments 和 relationships 到 `DocxImportIR` 的语义转换。该实现不是通用 Word renderer，也不自行实现 ZIP 或 XML parser。

不允许使用以下路径定位批注：

```text
DOCX → HTML → Markdown → selectedText 搜索 → 猜测 range
```

批注范围必须和正文 segment 在同一次 `document.xml` 遍历中形成。

## 架构边界

### 1. Worker

Worker 接收原始 `.docx` `ArrayBuffer`，负责：

- package 与 XML 安全校验；
- 读取必要 OOXML parts；
- 构建正文、assets、comment definitions 和 thread 关系；
- 形成并验证 annotation ranges；
- 生成 canonical Markdown、typed warnings 和 skipped thread records；
- 报告分阶段 progress，响应 cancel，并返回 structured result/error。

Worker 不访问 D1/R2，不读取登录态，不持久化原始 DOCX。

### 2. Browser controller

页面控制器负责：

- 生成 `import_batch_id`；
- 计算 source SHA-256；
- 启动 Worker、转发取消并执行 20 秒硬超时；
- 为已接受的 root/reply 生成最终站内 UUID；
- 将支持的图片上传到现有 temporary R2 asset pipeline；
- 用 temporary asset URL/refs 完成 Preview IR；
- 在 IndexedDB 保存可恢复 Preview。

### 3. Preview

Preview 使用现有 Markdown-first 编辑、渲染和 Annotation UI 语义，展示最终标题、正文、图片、表格、批注、Word author mapping、warnings 和 skipped threads。修改正文后重新解析 canonical Markdown 并校验 annotation ID、selected text 和结构；任何 `severity=error` 都禁止 Commit。

### 4. Server commit

服务端把 Preview payload 视为不可信输入，独立验证认证、allowlist、schema、Markdown AST、annotations、assets、attribution 和 batch 幂等性。服务端不重新解析原始 DOCX。正式关系数据用单次 D1 `batch()` 提交。

## officeparser feature probe

开发生产 walker 前，使用 lockfile 中实际安装的 `officeparser` 7.x 做最长 2 小时的 feature probe。开始时记录准确版本；2026-08-28 npm registry 的 stable 是 7.8.0，但 ADR 只以实际安装版本为准。

probe 必须同时证明：

1. comment anchor 精确到 inline range；
2. adjacent comments 不合并；
3. nested/overlapping comments 可区分；
4. comment ID 稳定可获取；
5. threaded reply immediate parent 可获取；
6. resolve state 可获取；
7. 不需要 selectedText 反向搜索。

任一项失败即停止 production-path 评估，记录失败 fixture 和结论，继续使用 OOXML Import Walker。即使全部通过，也必须比较其单一语义树、browser 安全控制和 deterministic output 是否优于 walker 后再决定；禁止混用 officeparser 正文树与自有 comment tree。Mammoth 若加入，只能作为正文 regression oracle，不能提供 canonical Markdown 或 comment range。

## Package 与 XML 安全

### Package gate

文件必须同时满足：

- 扩展名为 `.docx`；
- ZIP signature 合法；
- 存在 `[Content_Types].xml`；
- 存在 `word/document.xml`。

OLE Compound File magic `D0 CF 11 E0 A1 B1 1A E1` 明确拒绝，并返回“不支持旧版 `.doc` 或加密/受保护 Office 文档”。不尝试破解密码。

### 固定限额

```text
compressed DOCX             ≤ 20 MB
ZIP entries                 ≤ 1000
total uncompressed data     ≤ 200 MB
per-entry compression ratio ≤ 100:1
single XML part             ≤ 20 MB
XML nesting depth           ≤ 100
images                      ≤ 200
single image                ≤ 10 MB
root comments + replies     ≤ 500
canonical Markdown UTF-8    ≤ 1.5 MB
Worker timeout              = 20 s
Preview IndexedDB TTL       = 24 h
```

超过任一限制立即返回 typed error，不做部分导入。ZIP reader 还必须拒绝 encrypted entry、危险重复 entry 和 path traversal；在解压前使用 central-directory metadata 做预检，解压后重新核对实际大小。

### XML gate

所有 XML part 在解析前进行原始字节/文本检查：发现不区分大小写的 `<!DOCTYPE` 或 `<!ENTITY` 立即拒绝。XML parser 禁用 DTD 和 external entity，不解析、不请求任何远程 resource。解析前检查 part 大小，解析过程中或安全预扫描中限制 nesting depth。

## OOXML parts

主文档必读：

```text
[Content_Types].xml
word/document.xml
```

存在时读取：

```text
word/styles.xml
word/numbering.xml
word/_rels/document.xml.rels
word/comments.xml
word/commentsExtended.xml
word/footnotes.xml
word/endnotes.xml
docProps/core.xml
word/media/*
```

缺少可选 part 不失败。relationship target 必须解析为 package 内安全路径；external hyperlink 只保留白名单 scheme，不能借 relationship 读取网络资源。

## Import IR

IR 是 Word 语义的中间表示，不保存 HTML 或 DOCX source offsets。

```ts
interface DocxImportIR {
  version: 1;
  importBatchId: string;
  source: {
    filename: string;
    sha256: string;
    producer?: string;
  };
  suggestedTitle: string;
  blocks: ImportBlock[];
  assets: ImportAsset[];
  threads: ImportedThread[];
  skippedThreads: SkippedThread[];
  warnings: ImportWarning[];
  canonicalMarkdown: string;
}

type ImportBlock =
  | ParagraphBlock
  | HeadingBlock
  | QuoteBlock
  | ListBlock
  | TableBlock
  | ImageBlock
  | NotesAppendixBlock;

interface InlineSegment {
  text: string;
  marks: Array<"strong" | "em" | "strike" | "code">;
  link?: string;
  commentIds: string[];
}

interface ImportedThread {
  annotationId: string;
  sourceCommentId: string;
  blockId: string;
  blockLocalStart: number;
  blockLocalEnd: number;
  sourceAuthorName: string;
  sourceInitials?: string;
  sourceCreatedAt?: string;
  sourceDocumentOrder: number;
  sourceResolved: boolean;
  attributedUserId?: string;
  bodyMarkdown: string;
  replies: ImportedReply[];
}

interface ImportedReply {
  replyId: string;
  sourceCommentId: string;
  parentSourceCommentId: string;
  sourceAuthorName: string;
  sourceInitials?: string;
  sourceCreatedAt?: string;
  sourceDocumentOrder: number;
  sourceResolved: boolean;
  attributedUserId?: string;
  bodyMarkdown: string;
}
```

实际 TypeScript schema 还会为 blocks/assets/warnings 使用 discriminated unions，并拒绝未知字段或版本。`annotationId`、`replyId` 和 `importBatchId` 在 Preview 前生成，Commit 时不得重铸。随机 ID 不参与 producer 输出等价性比较；比较时以 source IDs、结构、ranges、内容和 warnings 为准。

## 单遍正文遍历与 range 形成

walker 先构建 styles、numbering、relationships、comments 和 commentsExtended lookup，再按照 `word/document.xml` body 顺序遍历一次。

```text
commentRangeStart(id) → activeCommentIds.add(id)
text run              → segment.commentIds = copy(activeCommentIds)
commentRangeEnd(id)   → activeCommentIds.delete(id)
```

每个文本 segment 在创建时即携带真实 active comment set。block 结束后，根据 segment 文本长度计算该 block 内的 JavaScript UTF-16 code-unit offsets，仅用于：

- annotation 合法性与 overlap 检测；
- deterministic sort；
- Preview/debug。

这些 offset 不是 OOXML → Markdown source mapping。IR 完成前不做 Unicode normalization；CJK、surrogate pair、combining character 和 RTL mixed text 用 fixture 验证。

comments 出现在 table、image、footnote/endnote 或不支持容器时，walker 仍记录 source thread 的位置类别，以便产生精确 skipped warning，但不会把 comment IDs 写入可导入正文 anchor。

## 正文语义规则

### Paragraph、heading 与 quote

- 普通 paragraph 保持 source order；空段按 canonical renderer 的稳定规则保留或合并。
- heading 读取 `w:pStyle`、styles `w:basedOn` 与 effective `w:outlineLvl`。
- style id/name 规范化后明确为 Heading1–Heading9 才按 heading 处理；否则用 effective outline level 兜底。
- H5–H9 clamp 到 H4，并聚合 `HEADING_LEVEL_CLAMPED`。
- 只有 Quote、IntenseQuote 或规范化等价 style 变为 blockquote；不按缩进、字号、粗体或居中猜测。

### Lists

通过 `numPr → numId → numbering.xml num → abstractNum → ilvl/numFmt` 得到 list type 和 depth。`bullet` 为 unordered；常见 numeric/alphabetic/roman 为 ordered。最多三层，第 4 层及以后 flatten 到第 3 层并聚合 `LIST_DEPTH_CLAMPED`。相邻 list items 的组合由 numId、list kind、level 和 source order 确定，不按可视缩进猜测。

### Inline formatting、code、links 与 fields

- `w:b` → strong，`w:i` → em，`w:strike` → strike；应用 character/paragraph style inheritance 后得到 effective formatting。
- underline、颜色、字体、字号、highlight 等视觉格式忽略，并最多聚合一次 `VISUAL_FORMATTING_DROPPED`。
- inline code 只接受集中配置的 character style whitelist：`Code`、`CodeChar`、`SourceCode` 及规范化等价项；不通过字体猜 code。
- `w:hyperlink` relationship 只允许 `https:`、`http:`、`mailto:`。不安全或未知 scheme 不产生链接，但保留 display text，并生成 typed warning。
- field instruction 不保留，默认保留 cached/display result。TOC field 整段跳过并聚合 `TOC_SKIPPED`。

### Track Changes

`w:ins`/`moveTo` 保留，`w:del`/`moveFrom` 丢弃，得到“接受全部修订”的最终文本。存在 revision markup 时聚合一次 `TRACK_CHANGES_FLATTENED`，不保留历史。

### Tables

只生成基础矩形 Markdown table：

- 第一行具有明确 Word header semantics 时作为 header；
- 否则合成空 header，所有 Word rows 保持 data rows，并产生 `TABLE_HEADER_SYNTHESIZED`；
- cell 内允许 text、strong/em/strike、link；
- cell 多 paragraph 用 `/` 连接，并聚合 `TABLE_CELL_FLATTENED`；
- table cell 内 comment 对应整个 thread 跳过。

发现 rowSpan、colSpan、`vMerge` 或 `gridSpan` 时，不输出 HTML table；整表按行变为 `cell A | cell B | cell C` 可读纯文本，并产生 `TABLE_MERGED_CELLS_FLATTENED`。

### Images 与特殊内容

- 只导入 embedded PNG/JPEG/GIF/WebP；alt 依次取 `wp:docPr@descr`、`title`、文件名、`image`。
- EMF/WMF/SVG 跳过并产生 `IMAGE_FORMAT_UNSUPPORTED`；潜在 SVG 不上传同源 R2。
- floating image 使用受支持底图并放到最近合理正文位置，产生 `FLOATING_IMAGE_FLATTENED`。
- `w:txbxContent` 有可读文本时在锚点附近降为 paragraph，产生 `TEXTBOX_FLATTENED`。
- OMML equation 输出 `[公式]`，产生 `EQUATION_SKIPPED`。
- Shape/SmartArt 优先保留可读文本，否则跳过并产生 typed warning。

### Footnotes 与 endnotes

正文 reference 变为 `[1]`、`[2]`；文末增加：

```text
---

脚注（从 Word 导入）

[1] ...
[2] ...
```

footnotes/endnotes 共享稳定 appendix 编号，产生一次 `NOTES_FLATTENED_TO_APPENDIX`。notes 中的 comments 不导入 Annotation。

## Word comments 与 threaded replies

`word/comments.xml` 读取 comment id、author、initials、date、body、source order 和最后 paragraph 的 `w14:paraId`。

存在 `word/commentsExtended.xml` 时，使用 `w15:paraId` 找到 CommentEx，再用 `w15:paraIdParent` 建立 immediate parent：无 parent 为 root，有 parent 为 reply；`w15:done=1` 写入 `sourceResolved=true`。缺少 commentsExtended 时所有 comments 退化为 flat roots，不猜 reply relationship。

reply graph 的缺失 parent、cycle、重复 paraId 或无法绑定 root 都导致对应 thread 原子跳过；reply 不提升为 root，不创建孤儿 Annotation。root 无法导入时整个 thread 跳过，warning payload 包含 `replyCount`。

## Annotation 合法性与 overlap

root comment 只有同时满足以下条件才可接受：

- definition 存在；
- text range 非空；
- 完全位于一个普通可支持 text block；
- 不在 table、image、footnote/endnote；
- 不跨 block；
- 不与已接受 annotation 相交、包含或嵌套。

同一 block 的 candidates 按以下键排序：

```text
startOffset ASC
length DESC
sourceCommentId ASC
```

随后 greedy accept。`A.end === B.start` 不算 overlap，因此 adjacent annotations 合法。冲突 thread 产生 `ANNOTATION_OVERLAP_SKIPPED`，payload 包含 `conflictsWithSourceCommentId`。所有 annotation skip 都逐 thread 保留 source reference，不被 cosmetic warning 聚合吞掉。

## Warning model

```ts
interface ImportWarning {
  code: ImportWarningCode;
  severity: "info" | "warning" | "error";
  sourceRef?: string;
  count?: number;
  payload?: Record<string, unknown>;
}
```

第一版至少包含：

```text
HEADING_LEVEL_CLAMPED
LIST_DEPTH_CLAMPED
VISUAL_FORMATTING_DROPPED
TOC_SKIPPED
TRACK_CHANGES_FLATTENED
TABLE_HEADER_SYNTHESIZED
TABLE_CELL_FLATTENED
TABLE_MERGED_CELLS_FLATTENED
FLOATING_IMAGE_FLATTENED
IMAGE_FORMAT_UNSUPPORTED
TEXTBOX_FLATTENED
EQUATION_SKIPPED
NOTES_FLATTENED_TO_APPENDIX
ANNOTATION_EMPTY_RANGE
ANNOTATION_CROSS_BLOCK
ANNOTATION_NON_TEXT_RANGE
ANNOTATION_TABLE_UNSUPPORTED
ANNOTATION_OVERLAP_SKIPPED
ANNOTATION_ORPHAN_DEFINITION
ANNOTATION_THREAD_SKIPPED
```

新增 code 继续使用同一 typed model。cosmetic warnings 按 code 聚合并带 count；annotation skip 逐 thread 保存。Preview 默认最多展开 50 条，其余按类别汇总。自然语言只存在于 UI 本地化层。

## Identity、attribution 与权限

`annotations` 与 `annotation_replies` 采用统一来源模型：

```text
source_type = NATIVE | DOCX_IMPORT
author_id = nullable
source_author_name
source_initials
source_created_at
source_comment_id
source_document_order
source_resolved
import_batch_id
imported_by_user_id
attributed_user_id = nullable
```

约束：

- native content 必须有 `author_id`，DOCX source 字段为空；
- imported content 的 `author_id` 永远为 `NULL`，source/batch/importer 字段有效；
- attribution 不授予编辑、删除或所有权；
- imported root/reply immutable；
- UI 始终显示 Word 来源、原 author，存在映射时再显示关联用户；
- `source_resolved` 只显示“Word 中已解决”，不自动隐藏或映射新的 resolve 功能。

Post 作者即 importer，可 Remove imported annotation thread。没有后来 native replies 时，soft-delete imported thread 并从当前 Markdown unwrap anchor；存在 native replies 时保留 anchor 和 deleted imported placeholder，native replies 永不级联删除。普通 attributed user 无删除权；管理员 hide/restore 继续使用 V5 lifecycle。

用户后来在 imported thread 下发表 native reply 时仍使用正常站内互动。Word author/attributed user 不被当作原生收件人；只有明确回复 native reply 时才按现有规则通知其作者。

## Persistence 与 revision

数据库新增或扩展：

- `import_batches`：batch id、importer、post、source filename/SHA-256、committed time；
- annotations/replies 的 source、import、attribution 字段，并允许 imported `author_id=NULL`；
- imported reply 的 revision snapshot relation，使 restore 可恢复 initial imported state；
- notification metadata，用于 attribution aggregate count/import batch。

一次 import 只创建一个完整 initial revision，包括 title、Markdown、assets、root annotation state 和 imported replies。不能先创建无批注 v1 再逐条生成 annotation-state revision。

管理员 restore 复制 source revision 的正文、assets、anchors、root states 与 imported reply states；退出当前 revision 的数据库历史保留。native replies 沿用 V5 既有历史语义，不被恢复动作伪造为 Word 历史。

## Commit 验证与原子性

Commit 前服务端重新检查：

- authenticated user 与 allowlist；
- IR version/schema、batch ownership 和 duplicate commit；
- title 与 Markdown UTF-8 size；
- canonical Markdown AST 中 annotation IDs、selected text、单块 range、无 nested/overlap；
- annotation/reply UUID、source ID 和 parent graph 唯一有效；
- imported `author_id` 必须为 null；
- attributed user 是有效站内用户；
- temporary asset 属于 importer，类型/大小/引用合法；
- external URL scheme 合法；
- payload 不能插入其他 post/revision ID 或伪装 native author。

正式提交在一次 D1 `batch()` 中包含：

```text
import batch metadata
post
initial revision
asset references
annotations
annotation replies
annotation snapshots
imported-reply snapshots
POST_CREATED activity
DOCX_ATTRIBUTION_NOTICE notifications
```

bulk inserts 使用固定小 chunks 规避 bound parameter 上限，但所有 statements 仍属于同一 batch；任一失败全部 rollback。

`import_batch_id` 是幂等主键。已提交 batch 且属于当前 importer 时返回同一 post；并发 race 中只允许一个 batch insert 成功，另一个捕获唯一键冲突后查询并返回同一结果。不能生成两个帖子。

Preview images 已是 R2 temporary objects。D1 成功时只绑定 asset refs，不移动 R2；D1 失败时对象保持 temporary，由现有 7-day GC 回收。

## Activity 与 Notification

导入只创建正常 `POST_CREATED` Activity。历史 Word root/replies 不创建 `ANNOTATION_CREATED`、`ANNOTATION_REPLY_CREATED` Activity，也不触发普通实时互动通知。

唯一例外为 `DOCX_ATTRIBUTION_NOTICE`：每个 attributed user、每个 batch 最多一条，metadata 带该用户关联的 comment 数量，文案为“X 导入《帖子》，其中 N 条 Word 批注与你关联。”不创建对应个人 Activity。

## Preview 与 IndexedDB

入口为 `/posts/import`，所有有效白名单用户可见。流程：

```text
选择 DOCX
→ Worker parse
→ Import IR
→ temporary image upload
→ validation
→ Preview
→ Confirm Import
```

Preview 至少展示 title、最终 Markdown rendering、images、tables、annotation highlights/threads、author mappings、warning summary 和 skipped threads。桌面使用文档主体与批注/警告侧栏；900px 以下沿用现有 stacked/bottom-sheet 语义。不是营销页，不引入新的视觉系统。

正文允许在 Preview 编辑。每次修改后重新走 canonical parser validation；破坏 annotation ID、selected text 或结构时生成 error 并禁止 Commit，可撤销或恢复最初解析结果。这是 import 完整性验证，不是 V6 AnnotationGuard。

包含 active Annotation 时明确提示：“此 DOCX 含正文批注。导入后正文将在 V6 AnnotationGuard 完成前暂时锁定编辑。”无 Annotation 时沿用普通帖子编辑能力。

IndexedDB 沿用 `zhilin-writing` database 并升级 schema，新增 import preview store，保存 batch、filename/SHA、IR、Markdown、warnings、temporary asset refs、author mappings、UUIDs 和 expiry；不保存原始 DOCX binary。TTL 24 小时，加载时清理过期记录，刷新可恢复；Commit 成功或主动放弃时删除 preview row。

## Fixture 与 compatibility

测试语料分为：

1. 仓库脚本确定生成的最小 OOXML fixtures，用于精确、可复现的语义和安全测试；
2. 公开、许可/来源清晰的真实 producer fixtures，用于 Microsoft Word Desktop、Word Online、Google Docs → DOCX、LibreOffice smoke compatibility。

真实 fixture 必须记录 source URL、许可/用途说明、SHA-256 和读取到的 producer metadata。不得修改 metadata 伪装 producer。找不到可信样本时明确记录 coverage gap，不宣称通过。

fixture matrix 覆盖正文格式、1–4 层列表、quote、links/fields/TOC、简单/合并表格、inline/floating images、notes、Track Changes、formula，以及 one/adjacent/overlap/nested/empty/cross-block/list/table/image comments、threaded replies、resolved、missing commentsExtended。文本覆盖 CJK、emoji/surrogate pairs、combining characters 和 RTL mixed text。

## TDD 与验收

每个实现切片遵循 red-green-refactor：先写能因缺失行为失败的测试，再写最小实现，随后运行聚焦测试和相关回归。测试层次包括：

- package/XML safety 与 limits；
- OOXML lookup 和正文语义；
- single-pass comment range 与 overlap；
- thread/resolve/atomic skip；
- warnings 聚合；
- Worker progress/cancel/timeout；
- IndexedDB TTL/recovery；
- malicious IR、identity/asset 越权和 idempotency；
- initial snapshot、imported deletion 和 restore；
- 完整 DOCX → Preview → D1/R2 → reload → Markdown parser → ProseMirror。

最终验证至少运行 typecheck、lint、unit/integration tests、production build、migration test、Sites checkpoint build 和本地导入 smoke flow。必须用实际输出作为完成依据。

## Git、进度记录与部署

以独立可验证的功能切片提交并立即推送：

1. 设计/计划与 officeparser ADR；
2. package/XML safety；
3. 正文/styles/lists/Markdown；
4. comment ranges/threads/overlap；
5. tables/images/notes/degradation；
6. Worker/IndexedDB/Preview；
7. D1 schema/atomic commit/idempotency；
8. imported identity/permissions/notification/revision restore；
9. producer compatibility/E2E/final docs/deployment。

`docs/v5-5-docx-import-progress.md` 随每个切片更新，记录测试证据、commit、push、已知限制和下一步。最终验证通过后部署新的 owner-only 私有 Sites version，保持当前访问策略不变。

## 明确不支持

V5.5 不实现字体/字号/颜色、页边距、页眉页脚、分页/页码、TOC 页码、浮动对象精确布局、Shapes/SmartArt 视觉语义、Track Changes 历史、复杂 field semantics、cross-block/nested/overlapping/table-cell/image Annotation、DOCX export、PDF/ODT import、footnote/math AST、OCR 或 cloud Office integration。

成功标准不是视觉近似 Word，而是：支持结构的 IR/Markdown 和不支持结构的降级/warnings 均确定、稳定且可测试；最终 Annotation range 与 Word 一致且从不依赖 selectedText 搜索。
