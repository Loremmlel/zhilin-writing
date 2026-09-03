# 知临中学 V5.5 DOCX Import 实施报告

## 状态

- 报告日期：2026-08-31
- 实施分支：`feature/v5.5-docx-import`
- 当前验证基线：`676a863` 之后的 Task 13 工作树
- 最后一个功能提交：`f9567c8 feat: snapshot DOCX replies and attribution notices`
- Producer/E2E 提交：`6342acf test: verify DOCX import producers end to end`
- 数据库迁移：[`drizzle/0005_docx_import.sql`](../drizzle/0005_docx_import.sql)
- 部署授权：用户已于 2026-08-31 明确接受 Microsoft Word Online 未验证限制，并授权 owner-only 私有部署。

V5.5 已实现浏览器 Worker 内的 `.docx` 导入链路：安全读取 OOXML package，生成 canonical Markdown、图片、普通批注与一层/多级来源回复图，提供可恢复 Preview，并通过单次 D1 batch 幂等提交为普通帖子、初始 revision 与 imported Annotation 数据。它不是 Word renderer，也不追求版面复刻。

## 17 项实施结论

### 1. officeparser 版本与 feature probe

锁定的 devDependency 是 `officeparser@7.8.0`（[`package.json`](../package.json)）。独立 probe 使用相邻、交叠/嵌套、threaded/resolved 三组固定 fixture，验证 inline range、相邻区分、交叠区分、稳定 comment ID、immediate parent、resolved state、无需 selected-text 搜索七个 gate（[`scripts/probe-officeparser.mjs`](../scripts/probe-officeparser.mjs)、[`tests/docx-officeparser-probe.test.ts`](../tests/docx-officeparser-probe.test.ts)）。结果仅 `adjacentDistinct` 与 `stableCommentId` 满足要求，`productionEligible=false`；完整证据见 [`docs/adr/2026-08-28-officeparser-docx-import.md`](adr/2026-08-28-officeparser-docx-import.md)。

### 2. Production path 决策

生产路径没有使用 officeparser，而是使用 `@zip.js/zip.js@2.8.60`、`fast-xml-parser@5.11.1` 与本站的轻量 OOXML walker（[`lib/docx-import/package.ts`](../lib/docx-import/package.ts)、[`lib/docx-import/xml.ts`](../lib/docx-import/xml.ts)、[`lib/docx-import/parse.ts`](../lib/docx-import/parse.ts)）。`officeparser` 只被 [`lib/docx-import/officeparser-probe.ts`](../lib/docx-import/officeparser-probe.ts) 与 probe 脚本引用，未进入 `lib/`、`app/`、`components/` 的生产导入调用链。

### 3. OOXML parts

Package gate 必须读取 `[Content_Types].xml` 与 `word/document.xml`；存在时读取 styles、numbering、document relationships、comments、commentsExtended、footnotes、endnotes、core properties 与 `word/media/*`。可选 part 缺失按明确降级处理，relationship target 必须仍位于 package 内；external hyperlink 只允许 `http:`、`https:`、`mailto:`，不会通过 XML 或 relationship 请求网络（[`lib/docx-import/lookups.ts`](../lib/docx-import/lookups.ts)、[`lib/docx-import/package.ts`](../lib/docx-import/package.ts)）。

### 4. Import IR schema

IR `version=1` 由 discriminated block union、inline segments、assets、accepted threads、replies、skipped threads、typed warnings、source identity、final UUID 与 canonical Markdown 组成（[`lib/docx-import/types.ts`](../lib/docx-import/types.ts)）。Preview 前生成最终 `importBatchId`、`ann_<uuid>` 与 reply UUID；Commit schema 使用 Zod 严格拒绝未知字段与伪造作者（[`lib/docx-import/commit-schema.ts`](../lib/docx-import/commit-schema.ts)）。

### 5. 单遍 comment range 形成

正文 walker 按 source order 处理 `commentRangeStart` / text run / `commentRangeEnd`，在每个 `InlineSegment` 创建时复制 active comment IDs，并在 block 结束后以 JavaScript UTF-16 code unit 计算 block-local range（[`lib/docx-import/walker.ts`](../lib/docx-import/walker.ts)、[`lib/docx-import/annotations.ts`](../lib/docx-import/annotations.ts)）。测试覆盖 CJK、emoji surrogate pair、combining character、RTL、相邻、重叠、嵌套、空范围与跨 block（[`tests/docx-import-comments.test.ts`](../tests/docx-import-comments.test.ts)）。

### 6. 不存在 source mapping 或 selected-text 反向搜索

导入路径不构建 OOXML → HTML/Markdown source map，也不以 `selectedText.indexOf(...)` 猜 anchor。审计命中的 `selectedText` 只用于 Preview 展示和服务端把既有 IR range 与已解析 Annotation directive 的可见文本重新核对（[`components/docx-import/docx-import-preview.tsx`](../components/docx-import/docx-import-preview.tsx)、[`lib/docx-import/commit-plan.ts`](../lib/docx-import/commit-plan.ts)）；`indexOf/lastIndexOf` 命中只属于 XML/entity/namespace tokenizer 或进度枚举。

### 7. Heading、list、table 规则

Heading 只依据明确 style / `basedOn` / outline semantics，H5–H9 clamp 为 H4；Quote/IntenseQuote 转为 blockquote。List 通过 `numId → abstractNum → ilvl/numFmt` 解析，保留三层并确定性 flatten 更深层级。基础矩形表格转为 GFM table，无 header 时合成空 header；merged cell 与 cell 内多段落按 source order 展平，不输出 raw HTML（[`lib/docx-import/walker.ts`](../lib/docx-import/walker.ts)、[`lib/docx-import/markdown.ts`](../lib/docx-import/markdown.ts)、[`tests/docx-import-body.test.ts`](../tests/docx-import-body.test.ts)、[`tests/docx-import-rich-content.test.ts`](../tests/docx-import-rich-content.test.ts)）。

### 8. Reply graph 与 resolved state

Root/reply definition 来自 `comments.xml`；最后一个 comment paragraph 的 `w14:paraId` 与 `commentsExtended.xml` 的 `w15:paraIdParent` 建 immediate parent，`w15:done` 保存 Word resolved metadata。缺失 commentsExtended 时保守退化为 flat roots；missing parent、duplicate paraId、unbound CommentEx 与 cycle 按连通 component 原子跳过，不提升 reply 冒充 root（[`lib/docx-import/annotations.ts`](../lib/docx-import/annotations.ts)）。

### 9. Deterministic overlap

同一 block 的 root candidates 按 `start ASC → length DESC → sourceCommentId UTF-16 ASC` 排序，greedy 接受；touching endpoints 保留，任何严格相交、包含、嵌套或重复范围确定性跳过，并在 warning payload 中记录冲突来源（[`lib/docx-import/annotations.ts`](../lib/docx-import/annotations.ts)、[`tests/docx-import-comments.test.ts`](../tests/docx-import-comments.test.ts)）。

### 10. Imported identity、attribution 与权限

Imported root/reply 持久化为 `source_type='DOCX_IMPORT'` 且 `author_id=NULL`，保留 Word author/initials/time/order/resolved/import batch；schema、planner 与数据库 CHECK 三层拒绝 native author 冒充。`attributed_user_id` 仅显示“关联站内用户”，不授予编辑、删除或所有权。只有帖子作者/导入者可移除 imported root，管理员仍可 hide/unhide；imported reply 无独立删除入口（[`db/schema.ts`](../db/schema.ts)、[`lib/annotations/identity.ts`](../lib/annotations/identity.ts)、[`lib/annotations/policy.ts`](../lib/annotations/policy.ts)、[`tests/docx-import-identity.test.ts`](../tests/docx-import-identity.test.ts)）。

### 11. Typed warnings

[`lib/docx-import/types.ts`](../lib/docx-import/types.ts) 定义 22 个 warning code，覆盖 heading/list clamp、视觉格式丢弃、不安全链接、TOC/修订、表格、floating/unsupported image、textbox/equation/shape/notes，以及所有 unsupported/illegal Annotation range/thread。Cosmetic warning 按 code/count 聚合；每个 skipped thread 保留独立 sourceRef、replyCount 与冲突/graph reason。Package/XML/timeout/Preview hard failures使用独立 typed error code。

### 12. Worker 与固定限额

[`lib/docx-import/limits.ts`](../lib/docx-import/limits.ts) 固定：20 MB compressed DOCX、1000 ZIP entries、200 MB 总解压、100:1 单 entry 比率、20 MB XML、100 层 XML、200 张图片、单图 10 MB、500 条 comments+replies、1.5 MB canonical Markdown、6 MB commit body、10,000 IR nodes、100,000 segments、20 秒 Worker timeout。Worker 只接收 transferable `ArrayBuffer`，报告六阶段 progress，支持 cancel/timeout，并在任何终态清理（[`lib/docx-import/docx-import.worker.ts`](../lib/docx-import/docx-import.worker.ts)、[`lib/docx-import/browser.ts`](../lib/docx-import/browser.ts)）。Worker/XML 审计无 `fetch`、XHR、sendBeacon 或 WebSocket。

### 13. Preview 与 IndexedDB 生命周期

IndexedDB `zhilin-writing` schema v2 新增 `docx-import-previews`，以 `importBatchId` 为 key，24 小时 TTL；load/list 先 purge 过期或畸形记录。Preview 保存 finalized IR、Markdown、temporary asset refs、author mappings 与图片 `Uint8Array`，不保存原始 DOCX `File`、`Blob`、`ArrayBuffer`；commit、取消或放弃会清理记录（[`lib/indexed-db.ts`](../lib/indexed-db.ts)、[`lib/docx-import/preview-store.ts`](../lib/docx-import/preview-store.ts)、[`tests/docx-preview-store.test.ts`](../tests/docx-preview-store.test.ts)）。

### 14. D1 / R2 一致性

浏览器先按 source order 上传图片为现有 temporary R2 asset；服务端重新验证 owner、temporary 状态、kind、MIME、filename 与大小。D1 单次 `batch()` 同时写 post、initial revision、import batch、asset claims/refs、root/reply、anchors、root/reply revision snapshots、一个 `POST_CREATED` activity 与聚合 attribution notices；中途失败整批回滚，未 claim 的 R2 对象继续保持 temporary，由既有 GC 回收（[`lib/docx-import/commit-plan.ts`](../lib/docx-import/commit-plan.ts)、[`lib/docx-import/commit-service.ts`](../lib/docx-import/commit-service.ts)、[`tests/docx-import-commit.test.ts`](../tests/docx-import-commit.test.ts)）。

### 15. Commit 幂等性

`import_batches.id`、source filename/SHA、importer、durable payload hash 与 unique constraints 共同建立 batch identity。精确重试返回已有 post/revision；另一 importer、source 或 payload 冲突；并发 unique-key race 在失败后重新查询并只接受 exact match。每条 imported root/reply 的 submission key 为 `docx:<batch>:<sourceCommentId>`（[`drizzle/0005_docx_import.sql`](../drizzle/0005_docx_import.sql)、[`lib/docx-import/commit-service.ts`](../lib/docx-import/commit-service.ts)）。

### 16. Producer 与完整链路结果

公开 fixture manifest、许可/provenance 与固定 SHA-256 位于 [`tests/fixtures/docx/public/manifest.json`](../tests/fixtures/docx/public/manifest.json) 和 [`tests/fixtures/docx/public/PROVENANCE.md`](../tests/fixtures/docx/public/PROVENANCE.md)。获取脚本 fail closed；generated semantic matrix 现在同时固定 extended timestamp 与 raw MS-DOS timestamp，UTC/Asia-Tokyo 双时区回归证明字节不随主机时区变化（[`scripts/fixtures/generate-docx-fixtures.mjs`](../scripts/fixtures/generate-docx-fixtures.mjs)、[`tests/docx-import-e2e.test.ts`](../tests/docx-import-e2e.test.ts)）。

| Producer                      | 证据/能力                        | 结果                                                      |
| ----------------------------- | -------------------------------- | --------------------------------------------------------- |
| Microsoft Office Word 14.0000 | Mammoth comments                 | PASS：正文批注可导入，孤儿定义稳定降级。                  |
| Microsoft Office Word 14.0000 | Mammoth footnotes                | PASS：脚注/尾注进入统一附录。                             |
| Google Docs（版本未声明）     | PDF Association 明确来源陈述     | PASS：标题与多级 heading 稳定；不伪造包内 producer。      |
| LibreOffice 5.4.5.1           | mat2 dirty DOCX / floating image | PASS：正文、图片可读，floating image typed warning 降级。 |
| Microsoft Word Online         | 无合格公开 fixture               | SKIP：用户已明确接受该已知限制。                          |

E2E 覆盖 `package → Worker → finalized Preview → temporary assets → commit schema/plan → reloaded canonical Markdown → V5 AST → ProseMirror document`；不同 deterministic ID factory 得到相同 normalized IR、Markdown、warnings 与 initial revision state。

### 17. 剩余不支持与确定性降级

- 不支持旧 `.doc`、加密/受保护 Office 文档、DOCX export 与 Word 精确排版。
- 不导入跨 block、空、table cell、纯图片/non-text、交叠/嵌套批注；整个 thread 原子跳过。
- 不保留 Track Changes 历史：保留 insert/moveTo、丢弃 delete/moveFrom；TOC 跳过。
- 不保留 H5–H9、四层以上列表、merged-cell/table layout、floating positioning、视觉字体/字号/颜色/underline 等版面信息；均按 typed warning 降级。
- OMML 使用 `[公式]` 占位；不可读 shape 跳过；textbox 与 notes 展平；图片仅支持内嵌 PNG/JPEG/GIF/WebP。
- V5.5 不实现 AnnotationGuard，也不解除 V5 对已有 active annotation 帖子的危险正文编辑锁。
- Microsoft Word Online 兼容性未由可信公开 fixture 验证。

## 最终不变量审计

| 审计项                                     | 结果                                                                                  |
| ------------------------------------------ | ------------------------------------------------------------------------------------- |
| `selectedText` / `indexOf` / `lastIndexOf` | 无正文反向搜索；命中均为 Preview/commit 校验、XML tokenizer、namespace 或进度枚举。   |
| `officeparser` production import           | 无；仅 probe 文件和脚本。                                                             |
| imported `author_id`                       | root/reply 均强制 `NULL`；schema/planner/DB constraint 三层保护。                     |
| historical annotation activity             | 导入只产生一个 `POST_CREATED`；`annotationActivityCount=0`，归属使用 batch 聚合通知。 |
| Worker/XML network access                  | 无 fetch/XHR/sendBeacon/WebSocket。                                                   |
| raw DOCX persistence                       | 无；Preview store 主动移除/拒绝原始 `File`、`Blob`、`ArrayBuffer`。                   |

## 2026-08-31 验证记录

| 命令                                                            | 结果                                                                      |
| --------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `npm run test:unit`                                             | PASS：227 total，226 pass，1 explicit Word Online skip，0 fail。          |
| `npx tsc --noEmit`                                              | PASS。                                                                    |
| `npm run lint`                                                  | PASS；仅保留既有 jsx-ast-utils parser 提示。                              |
| `npm test`                                                      | PASS：上述 226/1/0；生产构建成功；7/7 rendered artifact assertions 通过。 |
| `git diff --check`                                              | PASS。                                                                    |
| `npx drizzle-kit check`                                         | PASS：`Everything's fine`。                                               |
| `node scripts/fixtures/fetch-public-docx-fixtures.mjs --verify` | PASS：4 个公开 fixture hash 验证；Word Online 明确跳过。                  |
| `node scripts/fixtures/generate-docx-fixtures.mjs --check`      | PASS：4 个 generated fixture byte-for-byte current。                      |

既有非失败提示：npm `http-proxy` 配置弃用提示、构建代理提示、Vinext 路由静态分类提示与大 chunk warning。它们未造成测试、类型、Lint、schema、fixture、构建或 rendered artifact 失败。

## 部署门槛

用户已明确接受“Word Online 未验证”作为已知限制。该缺口不再阻止 Task 13 的 owner-only 私有部署；限制记录继续保留，待未来获得可信且可再分发的 fixture 后补充验证。
