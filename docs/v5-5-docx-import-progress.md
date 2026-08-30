# V5.5 DOCX Import 进度

## 2026-08-28 — 设计与实施计划

- 状态：完成并已获用户确认。
- 已确认：浏览器 Worker 内的轻量 OOXML Import Walker；ZIP/XML 使用成熟库，本站语义层自研。
- 已确认：Import IR、单遍 comment range、typed warnings、deterministic overlap、thread 原子跳过。
- 已确认：imported identity 永不伪装 native author，attribution 不授予权限。
- 已确认：单次 D1 batch、R2 temporary asset、initial revision、batch 幂等。
- 已确认：Preview/IndexedDB 24 小时恢复、真实 producer fixtures、TDD、分功能提交与 owner-only 私有部署。
- 规范：`docs/superpowers/specs/2026-08-28-docx-import-v5-5-design.md`
- 原始需求归档：`docs/V5.5原始spec.md`；内容与用户提供的 `V5.5原始spec.md` 在统一换行后逐字符一致，源文件 SHA-256 为 `9807b2d397d8e3aa5a31e5dd17b3ce77ba7bfc0381b58213550a48b8620d17bf`。该文件仅作原始资料，实施状态以已确认设计、计划、ledger 和后续用户指令为准。
- 计划：`docs/superpowers/plans/2026-08-28-docx-import-v5-5.md`，13 个 Task；每个 Task 完成后独立提交、推送并暂停等待确认。
- 验证：20 个必需 warning code、全部固定安全限额、幂等/身份/revision/R2 约束均已通过文档静态自审；`git diff --check` 通过。
- 提交：设计 `fed4755`；实施计划 `984b4a3`。

## 2026-08-28 — Task 1：officeparser feature probe

- 状态：完成；本条 ledger 与 Task 1 代码、测试、fixtures、ADR 在同一个提交中。
- 依赖锁定：production `@zip.js/zip.js@2.8.60`、`fast-xml-parser@5.11.1`、`zod@4.4.3`；development `officeparser@7.8.0`、`fake-indexeddb@6.2.5`。`package.json` 与 lockfile 的 direct versions 一致。
- 基线：安装依赖前的现有 `npm run test:unit` 为 95/95 通过。
- RED 1：gate test 因缺少 `lib/docx-import/officeparser-probe.ts` 失败（`ERR_MODULE_NOT_FOUND`）。
- GREEN 1：七项 gate 合同、逐 gate conjunction 和 JSON 序列化测试通过。
- RED 2：deterministic fixture test 因缺少生成脚本失败；实现固定 entry 顺序、固定 `lastModDate`、STORE 写入后通过。
- RED 3：实际 probe test 因缺少 `scripts/probe-officeparser.mjs` 失败；实现真实 AST 观测后通过。
- Fixtures：`probe-adjacent.docx` SHA-256 `892d6335d2e44a301bc435ea328eea551a9a87cbb39056b7decaf1c25488e6f5`；`probe-overlap-nested.docx` `7b1ed2197744d1b16000a918e34d7c9cec9f53d3d15c0a07890f6c4f8bab05e4`；`probe-threaded-resolved.docx` `93ccf246ae05a50f5d3e8200bd72e68d06304e68dd56a31361c928bd147f9a3d`。
- Probe 结果：`inlineRange=false`、`adjacentDistinct=true`、`nestedOverlapDistinct=false`、`stableCommentId=true`、`immediateReplyParent=false`、`resolvedState=false`、`noSelectedTextSearch=false`；`productionEligible=false`。
- 关键证据：多 run/交叠 fixture 期望 `10=ABCDE,11=BC,12=CD`，officeparser AST 只得到 `10=E,11=C,12=D`；reply `21` 未出现在 AST；root `20` 无 resolved metadata。
- 决策：`officeparser@7.8.0` 不进入 production path，只作为 probe/交叉验证 devDependency；Task 2 使用轻量 OOXML Import Walker。
- 详细记录：`docs/adr/2026-08-28-officeparser-docx-import.md`。
- 验证：probe focused tests 4/4 通过；完整 `npm run test:unit` 99/99 通过；`npx tsc --noEmit` 通过；四个新增代码/测试/脚本文件的定向 ESLint 通过；仓库全量 ESLint 直接运行退出 0。
- 环境记录：现有 `npm run lint` 经 WSL 调用 `scripts/sites-env.sh` 时，因该 checkout 的 CRLF 在 `set -o pipefail` 处退出；直接以相同 ESLint 参数运行通过。本 Task 未改动该包装脚本，后续最终验证需在 Sites 构建环境或 LF shell 副本中复核。
- 检查点：Task 2 尚未开始，等待用户确认继续。

## 2026-08-29 — Task 2：Import IR 与 DOCX package/XML 安全边界

- 状态：实现完成；Task 3 尚未开始。
- RED：新增 `tests/docx-package-security.test.ts` 后，测试按预期因缺少 `lib/docx-import/limits.ts`、`package.ts`、`types.ts` 和 `xml.ts` 失败（`ERR_MODULE_NOT_FOUND`）；原有 99 项单测仍通过。
- 类型边界：新增不可变 `DOCX_IMPORT_LIMITS`、typed `DocxImportError`/error code、20 个首版 warning code，以及 blocks、inline segments、assets、threads、skipped threads、`ParsedDocx`、`DocxImportIR`、`DocxPreviewRecord` 的 discriminated TypeScript interfaces。
- Package gate：验证 `.docx` 扩展名、20 MB compressed size、OLE magic、ZIP local-file signature、必需 parts、1000 entries、200 MB uncompressed total、100:1 per-entry ratio、20 MB XML part，以及 encrypted、symlink、unsafe path、Unicode/case-fold duplicate entry；显式安全目录条目允许存在但不暴露为可读 part。
- Zip.js API：`ZipReader` 与 `getEntries()` 均使用 `strictness: "strict"`、`checkAmbiguity: true`、`maxAppendedDataSize: 0`；解压读取使用 strict local-header check、CRC-32 与 overlapping-entry check，并在解压后重新核对实际 byte length。
- XML gate：读取支持 UTF-8 BOM、UTF-16LE BOM 与 UTF-16BE BOM；解析前对原始文本不区分大小写拒绝 `DOCTYPE`/`ENTITY`，限制 100 层 nesting。`XMLValidator.validate()` 先验证结构，`XMLParser` 使用 `preserveOrder: true`、`ignoreAttributes: false`、`attributeNamePrefix: "@_"`、`processEntities: false`、禁用 tag/attribute value coercion；namespace-tolerant helpers 保持 source order。
- Fixtures：新增通用确定性 DOCX fixture helper，可生成压缩、加密、symlink、entry-count 与受控 central/local header metadata 边界样本；安全测试覆盖最小有效包及全部 Task 2 hard-failure classes。
- GREEN：package/XML focused tests 15/15 通过；`asset-lifecycle` 与 `markdown` focused regression 9/9 通过；`npx tsc --noEmit` 与六个新增/修改代码测试文件的定向 ESLint 均退出 0。
- 环境说明：`npx` 仍打印仓库既有的 npm `http-proxy` 配置弃用提示；直接 Node test runner 的输出无 warning。本 Task 未修改 npm 配置。
- 提交：本节与 Task 2 代码、fixtures 和测试同一提交；推送后暂停，等待确认再进入 Task 3。

## 2026-08-29 — Task 3：DOCX 正文语义与 canonical Markdown

- 状态：实现完成；Task 4 尚未开始。
- RED：新增 `tests/docx-import-body.test.ts` 后，测试按预期因缺少 `lib/docx-import/markdown.ts` 失败（`ERR_MODULE_NOT_FOUND`）；审阅阶段另补相邻列表合并与正文行首 Markdown 转义用例，分别观察到 3 个列表块而非 2 个、以及 `#`/`-`/`>` 未转义的预期失败。
- Styles：`styles.xml` 的 paragraph/character style 使用 cycle-safe `basedOn` 解析；只接受显式 Heading1–Heading9、Quote/IntenseQuote 与集中 code style whitelist，不根据字体、字号、颜色或缩进猜测语义。H5–H9 flatten 为 H4，并聚合 `HEADING_LEVEL_CLAMPED`。
- Lists：通过 `numPr → numId → abstractNum → ilvl/numFmt` 解析 bullet、numeric、alphabetic 与 roman 类型；最多保留三层，后续层级 flatten 并聚合 `LIST_DEPTH_CLAMPED`。相邻项目仅在 numId、format 与原始 level 均相同时合并。
- Inline/links：支持 bold、italic、strike 与显式 code character style；视觉格式不进入正文语义并聚合 `VISUAL_FORMATTING_DROPPED`。external hyperlink 仅允许 `http:`、`https:`、`mailto:`；不安全目标保留 display text、丢弃 URL，并聚合新增 typed warning `HYPERLINK_UNSAFE_DROPPED`。
- Fields/revisions：普通 simple/complex field 丢弃 instruction、保留 cached result；TOC 整段跳过并聚合 `TOC_SKIPPED`。`w:ins`/`moveTo` 保留，`w:del`/`moveFrom` 丢弃，并聚合 `TRACK_CHANGES_FLATTENED`。
- Ordered walker：正文按 source order 生成稳定 block/item ID；comment range 的 active IDs 在单遍遍历中复制到每个 `InlineSegment.commentIds`。本 Task 按计划不构造 threads、assets 或 skipped threads，留给 Task 4/5。
- Canonical Markdown：只渲染 IR 语义，确定性输出 H1–H4、paragraph、quote、三层 ordered/unordered list、inline marks、code 与安全链接；转义可能重解释正文的 Markdown 标点，不做 Unicode normalization，并在渲染后执行 1.5 MB UTF-8 hard limit。
- GREEN：Task 3 body 与既有 Markdown/annotation round-trip focused tests 14/14 通过；完整 `npm run test:unit` 120/120 通过；`npx tsc --noEmit` 与八个新增/修改代码测试文件的定向 ESLint 均退出 0；`npx` 仅输出仓库既有的 `http-proxy` 弃用提示。
- 提交：本节与 Task 3 代码、fixtures 和测试同一提交；推送后暂停，等待确认再进入 Task 4。

## 2026-08-29 — Task 4：Word 批注范围、回复图与 deterministic overlap

- 状态：实现与代码审阅修复完成；Task 5 尚未开始。
- RED：新增 `tests/docx-import-comments.test.ts` 后，测试按预期因缺少 `lib/docx-import/annotations.ts` 失败（`ERR_MODULE_NOT_FOUND`）。
- Single pass：正文 walker 在遇到 `commentRangeStart`/`commentRangeEnd` 时更新 active comment IDs，在 block/list-item 关闭时从完成的 segments 推导原始 UTF-16 spans；不搜索文本、不经过 Markdown offset，也不做 Unicode normalization。测试覆盖 CJK、`😀` surrogate pair、`e\u0301` combining sequence 与 RTL 文本。
- Locations：同段普通正文、标题、引用与 list item 使用稳定 block/item ID；跨段范围、空范围、table cell、image/non-text 与缺失 definition 分别产生逐 thread typed warning。Task 5 尚未解析 table/image 内容，本 Task 只记录其 location 并原子跳过对应批注。
- Thread graph：从 `comments.xml` 读取 source order、author、initials、date、body 与最后 paragraph 的 `w14:paraId`；仅用 `commentsExtended.xml` 的 `w15:paraIdParent` 建 immediate parent、`w15:done` 建 resolved state。缺失 commentsExtended 时所有 definitions 保守退化为 flat roots，不猜 reply。
- Graph failure：missing parent、duplicate paraId、unbound CommentEx 与 cycle 按连通 component 原子跳过，不提升 reply 为 root；指向重复 paraId 的歧义子节点也并入该无效 component。所有已知 catalog thread 的跳过 warning payload 都包含 `replyCount`，graph failure 另含 deterministic reason。
- Overlap：同 block root candidates 按 `start ASC → length DESC → sourceCommentId ASC` 排序后 greedy accept；sourceCommentId 使用平台无关的 UTF-16 code-unit 比较。仅严格相交才冲突，因此 touching endpoints 保留，包含、嵌套、交叠与重复范围都稳定跳过，并记录 `conflictsWithSourceCommentId`。
- Canonical Markdown：accepted ranges 在最终 ID 生成后渲染为现有 `:annotation[...]{#ann_*}` directive，跨 inline strong/em/strike/link 保留原语义；测试使用注入式稳定 ID factories，生产默认沿用现有 `ann_<uuid-v4>` 与 UUID reply IDs。
- 审阅修复：整 block inline-code 范围拒绝；directive/entity-shaped 原文与批注正文安全转义；comments+replies 500 条 hard limit；语义重复的 source comment ID hard fail；存在 `commentsExtended.xml` 时缺失/非唯一 CommentEx 绑定按 `UNBOUND_COMMENT_EX` 原子跳过并保留所有可解析候选父边；递归识别 drawing/pict 内嵌 comment markers 并归类 non-text；预定义与数字 XML entity 在 parser 边界对文本和属性统一安全解码，UTF-16 offset 以实际文本计算，预定义实体保持 XML 大小写规则，CDATA 保留字面内容，未声明及非法 numeric entity 按 `XML_MALFORMED` 拒绝。
- GREEN：Task 4 与既有 annotation selection/round-trip/Markdown focused regression 28/28 通过；Task 4 + package/XML security regression 33/33 通过；完整 `npm run test:unit` 138/138 通过；`npx tsc --noEmit` 与九个 Task4 新增/修改代码测试文件的定向 ESLint 均退出 0。`npx` 仅输出仓库既有的 `http-proxy` 弃用提示。
- 最小实现：计划列出的 `lookups.ts` 无需改动；comments optional parts 由现有受限 package reader 直接读取，避免为单一调用增加转发层。
- 提交：本节与 Task 4 代码和测试同一提交；推送后暂停，等待确认再进入 Task 5。

## 2026-08-29 — Task 5：表格、图片、脚注与特殊内容的确定性降级

- 状态：实现与三轮代码审阅修复完成；Task 6 尚未开始。
- RED：新增 `tests/docx-import-rich-content.test.ts`，先后观察到 rich-content 模块缺失、URL 中竖线未转义、percent-encoded media target 未解析，以及审阅补充的图片缓存/源顺序/MIME、未引用 note 批注、表格 grid offset、列表图片、纯图片空批注范围、无效图片残留段落拆分等预期失败，再逐项实现至 GREEN。
- Tables：矩形表格输出 GFM table；无显式 header 时合成空 header 并聚合 `TABLE_HEADER_SYNTHESIZED`；单元格多段落以 ` / ` 展平。`gridSpan`、`vMerge`、`rowSpan`、`colSpan` 等合并标记统一按 source order 降级为普通段落，不输出 raw HTML；`tblGrid`、`gridBefore`、`gridAfter` 用于稳定矩形化。table cell 批注仍按 `ANNOTATION_TABLE_UNSUPPORTED` 原子跳过。
- Images：仅接受 relationship 指向 `word/media/` 的内嵌 PNG/JPEG/GIF/WebP；同时校验 `[Content_Types].xml` 的 Default/Override（含 percent-decoding）、扩展名、MIME 与 magic signature。alt 依次取 descr、title、filename、`image`；floating image 保留并聚合 warning。正文按图片所在 source offset 拆分，列表内图片保持单一 list item 后附图片；纯图片段落保留零长度文字 segment，确保空范围仍归类为空批注。
- Asset safety：单图 10 MB、总图片数 200 的 hard limit；相同 package media bytes 复用缓存，避免重复引用造成内存放大。缺失、不安全、格式/MIME/signature 不一致的图片确定性跳过；material validation 拒绝候选后进行轻量二次 walk，避免无效图片在 Markdown 中留下错误段落拆分。
- Special content：textbox 中可读段落以 ` / ` 展平；OMML 输出稳定占位符 `[公式]`；可读 DrawingML shape text 保留，不可读 shape 聚合 `SHAPE_CONTENT_SKIPPED`。所有降级均使用 typed warning。
- Notes：footnote/endnote 按正文引用顺序共享稳定编号，正文插入 `[N]`，文末追加 `---` 与“脚注（从 Word 导入）”列表；未引用 notes 中的批注也会被扫描并归类为 non-text，避免误绑定正文。notes 降级 warning 聚合输出。
- 审阅修复：消除重复媒体引用的内存放大；补齐图片 source order、MIME/扩展名/signature 一致性、未引用 note 批注、table grid offset；修复列表图片重复项目、纯图片空范围、无效 signature 残留拆分与 merged-table 合成空格问题。最终独立审阅无 Critical、Important 或 Minor 发现。
- GREEN：Task 5 + 正文/批注/asset focused regression 38/38 通过；完整 `npm run test:unit` 150/150 通过；TypeScript、定向 ESLint 与 `git diff --check` 在提交前复核。
- 提交：本节与 Task 5 代码和测试同一提交，消息为 `feat: import DOCX rich content safely`；推送后暂停，等待确认再进入 Task 6。

## 2026-08-29 — Task 6：Worker 边界与可恢复的 24 小时 Preview

- 状态：实现、独立 rereview 与修复完成；Task 7 尚未开始。
- 同步与基线：`feature/v5.5-docx-import` 已通过 Sites 短期凭据从 `origin` 获取并确认 `Already up to date`；Task 6 开始前完整单测为 150/150 通过。
- RED：新增 Worker、Preview store 与旧草稿迁移测试后，分别观察到 `browser.ts`、`worker-protocol.ts`、`preview-store.ts`、共享 IndexedDB opener 缺失的预期失败；测试自身的 strip-only TypeScript 语法问题修正后再次确认失败来自缺少生产模块。
- Worker protocol：定义 `start`、`cancel`、`progress`、`success`、`failure` 精确消息联合。真实 Worker 依次报告 `package-validation → xml-preload → document-walk → thread-validation → markdown-generation → done`，不访问网络或持久层；原始 DOCX 以 transferable `ArrayBuffer` 单次送入 Worker。
- Controller：`parseDocxWithWorker` 默认执行固定 20 秒 hard timeout，转发 caller abort，并在 success、structured parser failure、abort、timeout 和 source-read failure 后统一清理 listener/timer、终止 Worker、忽略 late messages。Worker 的 typed code、message 与 details 原样重建为 `DocxImportError`，Worker 启动失败也统一包装为 typed `PARSE_FAILED`。
- Finalization：浏览器使用 `crypto.subtle.digest('SHA-256')` 计算 source hash；`finalizeDocxPreview` 在 Preview 前一次生成所有最终 `ann_<uuid>` root ID 与 UUID reply ID，并用最终 IDs 重新渲染 canonical Markdown。Worker 内只使用非最终 source placeholder，刷新与重试复用持久化后的 finalized payload。
- IndexedDB：新增共享 `lib/indexed-db.ts`，把 `zhilin-writing` schema 从 version 1 升至 version 2；保留无 keyPath 的 `drafts` store，新增以 `importBatchId` 为 keyPath、`expiresAt` 为 index 的 `docx-import-previews` store。现有 draft adapter 不再以 version 1 单独打开数据库。
- Preview lifecycle：新增 save/load/remove/purge API；load 前清理过期记录，`expiresAt <= now` 的边界记录立即删除。保存时白名单化顶层字段、严格校验 canonical ISO 时间戳、从 `createdAt` 推导 24 小时 TTL，并仅允许 `Uint8Array` 作为持久化图片字节；畸形旧记录在清理时一并删除。测试覆盖 filename/SHA、final IR/Markdown、warnings、temporary asset refs、author mappings、最终 root/reply IDs 的恢复，并确认记录不包含原始 DOCX `File`、`Blob` 或 `ArrayBuffer`。
- 独立 rereview：新子代理未发现 Critical；发现 Worker 外层 scope 丢失 transferable、asset bytes 类型校验过宽、`Date.parse` 接受畸形时间戳，以及进度回调异常未收敛等问题，均已通过先 RED 后 GREEN 的测试修复。
- GREEN：Task 6 Worker/Preview focused tests 19/19 通过；完整 `npm run test:unit` 171/171 通过；`npx tsc --noEmit`、八个相关文件的定向 ESLint、`git diff --check` 与 `npm run build` 均退出 0。`npx` 仍只输出仓库既有的 npm `http-proxy` 配置弃用提示；构建仅保留既有的大 chunk 警告。
- 最小实现：图片上传与 Preview UI 按计划留在 Task 7；Task 6 只建立可测试的 Worker/ID/存储边界，未新增依赖或重复 IndexedDB adapter。
- 提交：本节与 Task 6 代码和测试同一提交，消息为 `feat: run DOCX import in a recoverable worker preview`；推送后暂停，等待确认再进入 Task 7。

## 2026-08-29 — Task 7：导入工作区与可验证 Preview

- 状态：实现与自检完成；Task 8 尚未开始。
- 入口与权限：新增成员专用 `/posts/import`，服务端执行 `requireMember("/posts/import")` 并只向客户端提供站内用户 ID/显示名；新帖子页增加“从 DOCX 导入”入口。导入页沿用现有校刊纸面、Milkdown、Annotation mark、`/api/assets` 与共享确认弹窗，不新增上传或编辑依赖。
- 状态机：工作区覆盖 `selecting → parsing → uploading → previewing`，并为 Task 9 预留 `committing → complete`。文件选择只接受一个非空 `.docx` 且压缩体积不超过 20 MB；Worker 显示六个真实阶段、20 秒边界与取消。支持图片按源顺序逐张上传、计数进度、失败重试；失败前已上传对象保持 temporary，由既有 GC 回收。
- Preview：解析完成后生成一次性 batch/root/reply IDs，把 `docx-asset:` 引用替换为认证临时 URL，再保存 24 小时 Preview。标题与正文可编辑；Milkdown 显示 canonical Markdown、图片、表格与 Annotation mark。右栏显示 Word 原作者、批注/一层回复、可选站内关联、typed warnings 和逐条 skipped threads；默认最多展示 50 条明细，其余按本地化类别聚合计数。存在 accepted Annotation 时显示精确 V5.5 编辑锁提示。
- 本地恢复：Preview store 新增按 `createdAt` 倒序列出有效记录，并持久化用户编辑后的标题、Markdown、author mappings、最终 IDs 与 temporary asset refs；过期/畸形记录仍在加载前清理。恢复时重新验证 expiry、图片数量/MIME/文件名、temporary URL 形状、author mapping 用户与 source author；主动放弃使用共享 alert dialog，删除 IndexedDB 记录且不伪装同步删除 R2 temporary objects。
- Commit 前校验：新增 `validateEditedImportPreview()`，统一 trim/校验 120 字标题、非空正文、1.5 MB UTF-8 上限、error-severity warning、exact annotation ID set、duplicate/missing/unknown anchor、selected text 不变、nested/overlap、unsafe URL、过期 Preview 与临时图片引用。成功 payload 复用 Preview 的 batch/root/reply IDs，只替换最终 title/canonical Markdown；任一 blocking error 都保持编辑内容并禁用 Confirm。真正的 authenticated atomic commit 仍留在 Task 9。
- RED/GREEN：Preview tests 先因 `preview-validation.ts` 缺失失败；恢复列表先因 `listImportPreviews` 缺失失败；标题持久化、临时图片缺失/篡改也分别观察到预期失败后实现。最终 Task 7 focused tests 13/13 通过；完整 `npm run test:unit` 178/178 通过；`npx tsc --noEmit`、定向 ESLint、strict premium UI audit、`git diff --check`、`npm run build` 与七项 rendered artifact assertions 均退出 0。构建产物包含 `/posts/import`；按当前 Sites 规则，用户未单独授权 browser/visual/E2E QA，因此未启动 Agent preview 或浏览器交互测试。
- 最小实现：Task 7 不新增数据库表、不实现正式 Confirm endpoint、不伪造成功状态，也不提前实现 Task 8 imported identity schema 或 Task 9 atomic commit；Confirm 保持 disabled，Task 9 接入现有 validation payload 后再启用。
- 提交：本节将与 Task 7 代码和测试同一提交，消息为 `feat: add DOCX import preview workspace`；推送后暂停，等待确认再进入 Task 8。

## 2026-08-30 — Task 8：Imported identity 与完整初始快照模型

- 状态：实现与完整验证完成；Task 9 尚未开始。
- RED：新增真实 SQLite 迁移契约测试，从 0000–0004 构造包含 native root/reply、soft-delete、admin hide、revision state、activity 与 notification 的 V5 数据；测试按预期因缺少 `0005_` migration 失败。nullable imported author 暴露出的 lifecycle 语义另以失败测试确认：`author_id=NULL` 的 Word 历史身份不能被当作“其他站内成员讨论”。
- Durable model：新增 `import_batches` 幂等主键，持久化 importer、source filename/64 位小写十六进制 SHA-256、post、initial revision 与 commit time；root/reply 增加 `NATIVE | DOCX_IMPORT` source identity、Word author/initials/time/comment/order/resolved、batch/importer/attribution 字段；native author 保持必填，imported author 强制为 `NULL`，imported order/resolved 强制非空，imported submission key 强制为 `docx:{batchId}:{sourceCommentId}`。
- Snapshot/notification：新增 `revision_imported_reply_states` 保存 imported reply 的 deletion/hide state；notification 增加 `DOCX_ATTRIBUTION_NOTICE`、`metadata_json`、`import_batch_id`，并以 partial unique index 保证每个 recipient/batch/type 至多一条汇总通知。
- Lossless migration：`0005_docx_import.sql` 以 `PRAGMA defer_foreign_keys=ON` 适配 D1 的隐式事务，对 `annotations`、`annotation_replies`、`notifications` 使用显式列清单重建，并在全部 FK 恢复后显式关闭 defer；V5 native rows 原样复制并仅补 `source_type='NATIVE'` 与新字段 `NULL`。契约测试在单一 `BEGIN/COMMIT` 中回放 0005，覆盖 anchor、revision state、activity 与 notification 的 root/reply 外键；迁移后 `PRAGMA foreign_key_check` 为空，原 lifecycle/history 状态逐字段一致。
- Nullable compatibility：旧 lifecycle/annotation helper 改用实际需要的窄类型；imported `NULL` author 不获得删除权、不会生成原生回复收件人，也不会让已删除帖子因为历史 Word 内容被误判为其他成员讨论。
- GREEN：Task 8 migration focused tests 5/5、完整 `npm run test:unit` 191/191、`npx tsc --noEmit`、`npx drizzle-kit check`、定向 ESLint、`git diff --check` 与 `npm run build` 均通过；Wrangler 4.92.0 临时本地 D1 顺序应用 0000–0005 全部成功。`npx` 仅输出仓库既有的 npm `http-proxy` 弃用提示，构建仅保留既有的大 chunk 警告。
- 提交：本节与 Task 8 schema、migration、snapshot、兼容修复和测试同一提交，消息为 `feat: model imported DOCX annotation identity`；推送后暂停，等待确认再进入 Task 9。

## 2026-08-30 — Task 9：不可信 IR 校验与原子幂等提交

- 状态：实现与完整验证完成；Task 10 尚未开始。
- 同步：从 Sites `origin` 拉取 `feature/v5.5-docx-import` 并确认已是最新；Task 9 基线完整单测为 191/191 通过。
- RED：新增 `tests/docx-import-commit.test.ts` 后，测试按预期因缺少 `commit-schema.ts` 失败；实现初版后又分别暴露 envelope fixture 未同步及递归 Zod block 推断为 `unknown`，修正测试数据与显式 schema 类型后转绿。
- Trust boundary：`DocxImportCommitSchema` 使用 strict Zod object 拒绝未知字段；服务端重新校验标题、1.5 MB UTF-8 Markdown、`.docx` source/SHA、final batch/root/reply UUID、source range、500 条 root+reply 上限、reply graph、author mapping 与 imported `author_id=NULL`。服务端重新解析 canonical Markdown，要求 annotation ID 集合、次数与 selected text 精确一致，并拒绝 nested/cross-block/overlap、unsafe URL、error warning 与被篡改 asset manifest。
- Asset/auth：endpoint 使用不会触发页面跳转的 `getApiMemberAccess()`，未登录、非成员及待 onboarding 状态分别返回 typed JSON 401/403；raw JSON 交给 service 后再验证 allowlist、attributed users，以及每张 temporary image 的 owner、status、MIME、filename、size 与未删除状态。asset claim 位于同一 D1 batch 中，并用 owner/status/MIME guard 触发硬失败；不移动或删除 R2 object。
- Atomic planner：post/revision ID 由服务端生成；FK 顺序包含 post、完整 initial revision、import batch、asset binding/ref、roots/replies、root/reply snapshots、唯一 `POST_CREATED` event 与每位 attribution recipient 至多一条汇总通知。planner 依据列数动态分块，member/asset lookup 也按 100 个 ID 分块，保证每条 D1 statement 不超过 100 个 bind parameter；全部 statements 仍只调用一次 `db.batch()`。imported roots/replies 不生成个人 annotation activity。
- 幂等与恢复：相同 batch/importer/source/durable payload 重试返回同一 post/revision 且 `alreadyCommitted=true`；不同 importer、hash 或 payload 返回 409 conflict。唯一键 race 在 batch 失败后重新读取并只接受 exact match；注入中途失败证明所有 post/revision/thread/snapshot/activity/notification/ref rows 均回滚，temporary asset 保持未绑定。Confirm 在首个 `await` 前同步加锁并切换 committing，再把 exact payload durable 写入 IndexedDB，成功后才 fetch；失败保留同一 batch/root/reply IDs，成功后的本地清理为 best effort，因此 IndexedDB 删除失败也不会误报服务端 commit 失败或制造不同 payload 重试。
- Review hardening：初次 review 的 5 项 Important finding 已全部修复。除 D1、durable Confirm 与 typed API auth 外，服务端和客户端都拒绝 annotation 内的 image alt text；不可信 IR 增加 10,000 node、100,000 segment、1.5 MB text 上限，list children 必须为空，table row/cell、note、thread/reply、warning 与 payload entry 全部计入 aggregate budget，warning payload 只接受有界 primitive value，避免递归结构、乘法膨胀或任意嵌套 payload 造成资源耗尽。
- 最终预算补强：segment 的 `link` 与每个 `commentIds` 条目现在同时计入 aggregate 节点/字节预算；commit 路由在 `JSON.parse` 前对 UTF-8 请求体执行 6 MiB 硬上限，并优先使用 `Content-Length` 拒绝明显超限请求，避免只依赖结构遍历限制。
- Rereview follow-up：raw commit body 改为按 `ReadableStream` 分块读取，按实际字节数在超过 6 MiB 时立即取消，不信任缺失或伪造的 `Content-Length`；新增确定性唯一键竞争测试，证明两个并发 precheck miss 时只有一个 durable commit，另一个精确回读同一结果。
- GREEN：review hardening focused tests 40/40、最终完整 `npm test` 的 208/208 单测、生产构建与 7/7 rendered artifact assertions 均通过；`npx tsc --noEmit`、全量 ESLint、strict premium UI audit 与 `git diff --check` 退出 0。构建产物包含 `/api/docx-import`；仅保留仓库既有的 npm `http-proxy` 弃用提示、ESLint parser 提示与大 chunk warning。按当前授权未启动 browser/visual/E2E QA，也未部署站点。
- 提交：本节将与 Task 9 schema、planner、service、endpoint、Confirm flow 和测试同一提交，消息为 `feat: commit DOCX imports atomically`；推送后暂停，等待确认再进入 Task 10。

## 2026-08-30 — Task 10：来源身份展示与 imported thread 权限

- 状态：实现与完整验证完成；Task 11 尚未开始。
- RED：新增 `tests/docx-import-identity.test.ts`，并扩展 annotation replies/lifecycle 测试；先确认缺少统一 author view、Word 元数据格式、canonical anchor 排序、source-aware permission 与 imported thread removal planner 时按预期失败。
- Identity/query：root、reply 与管理员查询分别对 native author、attributed user 使用 left join，`author_id=NULL` 的 imported rows 不再被丢弃；统一 author view 始终保留 Word 原作者，显示 `Word 导入`、可选 initials、`Word 中已解决` 与 `关联 {用户}`，关联用户不替换原身份或头像。
- Ordering：root sidebar 顺序由当前 canonical Markdown AST 中的 annotation ID 顺序决定；同一 imported thread 的 Word replies 依次按 source time、document order、source comment ID 稳定排序，native replies 继续按站内创建时间与 ID 排序。
- Permission：页面只消费服务端生成的 `canDelete` / `canRemoveImportedThread`；attributed user 不获得编辑、删除或所有权，native root/reply 仍仅作者可删除。普通 delete service 显式拒绝 `DOCX_IMPORT`，回复 imported root 或 imported reply 不生成普通收件人，只有明确回复 native reply 才通知其站内作者。
- Removal：新增 importer/post author 专用原子移除事务。没有未删除 native replies 时，soft-delete imported root/replies 并从当前 Markdown unwrap anchor；存在 native replies 时保留 anchor 与 deleted imported placeholder，只 soft-delete imported rows，绝不级联 native replies。管理员既有 hide/unhide 路径继续适用于 imported root/reply。
- UI：桌面 Annotation sidebar、移动端 Sheet 与管理员内容列表复用同一来源文案；importer/post author 在 imported root 上看到“移除导入批注”的现有应用内确认弹窗，导入 reply 本身不显示删除入口；`Word 中已解决` 只作为 metadata，不隐藏线程。
- Review follow-up：修复 2 项 Important finding。混合有/无 Word 时间的 imported replies 现在以缺失时间最后的统一 tuple 排序，六种输入排列得到相同结果；unwrap 分支在 D1 batch 执行时额外以 `NOT EXISTS` 检查未删除 native reply，若规划后出现站内回复则利用既有非空 guard 原子回滚，避免回复因 anchor 被移除而不可访问。
- GREEN：Task 10 focused tests 15/15、完整单测 218/218、`npx tsc --noEmit`、全量 ESLint、strict premium UI audit、anti-pattern/permission 静态搜索、`git diff --check`、生产构建与 7/7 rendered artifact assertions 均通过。仅保留仓库既有的 npm `http-proxy`、ESLint parser 与大 chunk warning；按项目约定未启动 browser/visual/E2E QA，也未部署站点。
- 提交：本节将与 Task 10 identity、query、permission、lifecycle、UI 和测试同一提交，消息为 `feat: distinguish imported DOCX annotation threads`；推送后暂停，等待确认再进入 Task 11。

## 2026-08-30 — Task 11：Imported reply 完整快照与归属汇总通知

- 状态：实现与完整验证完成；Task 12 尚未开始。
- RED：新增 `tests/docx-import-revision.test.ts` 与 `tests/docx-attribution-notification.test.ts`，并扩展 commit 测试；先确认 imported reply restore 结果缺失、重复 reply snapshot 未拒绝、归属通知策略模块缺失及 commit metadata 不完整等预期失败，再逐项实现至 GREEN。
- Snapshot：所有会写入当前 V5 annotation-state revision 的入口，同一事务保存 imported root 与 imported reply 的 deleted/hidden 状态。恢复时读取目标 revision 的 reply snapshots，只更新属于该帖且 `source_type='DOCX_IMPORT'` 的回复；native replies 不被改写或合成。新 restore revision 同步记录恢复后的 imported reply 状态，重复或跨帖 snapshot 被显式拒绝。
- Notification：commit planner 以 recipient + import batch 聚合映射到该用户的 Word 批注数量，排除 importer 自己与空映射；每位收件人最多一条 `DOCX_ATTRIBUTION_NOTICE`，不生成个人 annotation activity。稳定 metadata 只保存 post ID/title、导入者显示名与 mapped comment count，不暴露 root/reply ID，也不赋予编辑、删除或所有权。
- UI/privacy：通知列表与详情页使用专属 DOCX 汇总模板，明确说明仅用于显示来源身份并提供帖子入口，不复用 native annotation 文案。帖子不可访问时不显示已存标题，改为“一篇帖子”，避免软删除或隐藏后的标题泄露；畸形旧 metadata 使用明确的资料不完整提示。
- GREEN：Task 11 focused tests 20/20、revision/annotation regression 43/43、完整单测 222/222、`npx tsc --noEmit`、全量 ESLint、strict premium UI audit、anti-pattern 静态搜索、`git diff --check` 与生产构建均通过。仅保留仓库既有的 npm `http-proxy`、ESLint parser 与大 chunk warning；按项目约定未启动 browser/visual/E2E QA，也未部署站点。
- 最小实现：本任务不新增 schema、migration 或依赖，不提前实现 Task 12；归属映射仍只是透明展示信息。
- 提交：本节将与 Task 11 snapshot、notification policy、UI 和测试同一提交，消息为 `feat: snapshot DOCX replies and attribution notices`；推送后暂停，等待确认再进入 Task 12。

## 2026-08-30 — Task 12：公开 producer fixtures 与端到端兼容性矩阵

- 状态：实现与定向验证完成；按用户要求先提交推送，完整审查与全量回归在推送后继续；Task 13 尚未开始。
- 可复现获取：新增机器可读 manifest、来源说明与失败关闭的 fetch/verify 脚本。脚本只访问 manifest 中的 HTTPS URL，下载后先校验固定 SHA-256，再原子替换本地 fixture；文件名、许可、来源陈述与可用的包内 producer 证据均受校验。
- Producer matrix：

| Producer / version | Fixture feature | Result |
| --- | --- | --- |
| Microsoft Office Word 14.0000 | Mammoth comments | PASS：正文批注可导入；孤儿定义稳定降级。 |
| Microsoft Office Word 14.0000 | Mammoth footnotes | PASS：脚注/尾注进入统一附录。 |
| Google Docs（包内未声明版本） | PDF Association 明确说明的 Google Docs DOCX export | PASS：标题与多级 heading 保持稳定；producer 仅依据明确来源陈述，不伪造包内证据。 |
| LibreOffice 5.4.5.1 Linux x86-64 | mat2 dirty DOCX / floating image | PASS：正文与图片可读，floating image 使用 typed warning 降级。 |
| Microsoft Word Online | 无合格公开 fixture | SKIP / deployment blocker：未找到同时具备明确创建/导出 provenance、再分发条件与匹配内部证据的文件；没有改名冒充。 |

- Generated matrix：`semantic-matrix.docx` 固定字节覆盖普通段落、H1–H9、run-style inheritance、粗体/斜体/删除线、代码样式白名单、四层列表、Quote/Intense Quote、安全/不安全链接、缓存字段、TOC、显式/合成 header 与 merged table、inline/floating image、脚注/尾注、Track Changes、OMML、textbox、相邻/交叠/空/跨 block/table/image/orphan/missing-extended/cycle 批注、threaded/resolved reply、CJK、emoji/UTF-16 surrogate、combining character 与 mixed RTL。生成器 `--check` 对四个 generated fixtures 做 byte-for-byte 校验。
- End-to-end：真实链路执行 package validation → Worker stages → finalized Preview → temporary asset stubs → commit schema/plan → reloaded canonical Markdown → V5 Annotation AST → Milkdown/ProseMirror document；两种独立 deterministic ID factory 得到相同 normalized IR、Markdown 与 warnings。初始 revision 的 root/reply snapshots、import batch、assets 与 imported identity 同步验证。
- RED/GREEN：先确认 manifest、获取脚本、semantic matrix 与 expected normalized IR 缺失导致预期失败；实现后 producer + E2E focused tests 3 PASS / 1 explicit SKIP，`fetch --verify`、generator `--check` 与 `npx tsc --noEmit` 退出 0。完整单测/Lint/构建与代码审查按用户要求在首次推送后继续。
- 提交：本节与 Task 12 fixtures、脚本、expected IR 和测试同一提交，消息为 `test: verify DOCX import producers end to end`；推送后立即进入审查，不开始 Task 13，也不部署站点。
