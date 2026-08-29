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
