# DOCX Import V5.5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a supported `.docx` entirely in the browser into one canonical post revision containing Markdown, temporary-R2 images, Word-rooted Annotation threads, imported replies, source identity, and typed deterministic degradation results.

**Architecture:** A browser Web Worker opens the OPC ZIP with Zip.js, rejects unsafe packages/XML, parses OOXML with fast-xml-parser in source order, and emits a site-specific semantic IR whose inline segments carry active Word comment IDs. The browser finalizes stable preview IDs, uploads supported images to the existing temporary asset endpoint, and persists a 24-hour Preview; an authenticated server endpoint treats the payload as untrusted, revalidates canonical Markdown/identity/assets, and writes all durable D1 relations in one batch.

**Tech Stack:** TypeScript 5.9, React 19, Next.js/Vinext, Milkdown Crepe, unified/remark, Drizzle ORM, Cloudflare D1/R2, `@zip.js/zip.js@2.8.60`, `fast-xml-parser@5.11.1`, `zod@4.4.3`, `officeparser@7.8.0` (probe-only dev dependency), `fake-indexeddb@6.2.5` (tests), Node 22 test runner.

**Spec:** `docs/superpowers/specs/2026-08-28-docx-import-v5-5-design.md`

## Global Constraints

- Preserve V1–V5 auth, allowlist, Markdown, assets, lifecycle, Activity, Notification, revision, Annotation, and administrator behavior.
- Original DOCX bytes remain in the browser and are never sent to D1, R2, the server, analytics, or long-lived browser storage.
- Production parsing defaults to the focused OOXML walker. `officeparser` may enter production only if all seven probe gates pass; one failure ends its production-path evaluation.
- Do not convert through HTML, do not search `selectedText`, and do not persist DOCX, Markdown-source, DOM, or ProseMirror offsets as annotation anchors.
- Use JavaScript UTF-16 code-unit offsets only after IR construction for block-local legality, ordering, preview, and diagnostics.
- Apply every fixed limit verbatim: 20 MB compressed file, 1000 ZIP entries, 200 MB total uncompressed, 100:1 per-entry ratio, 20 MB XML part, depth 100, 200 images, 10 MB image, 500 comments plus replies, 1.5 MB final UTF-8 Markdown, 20-second Worker timeout, 24-hour Preview TTL.
- Reject `DOCTYPE`, `ENTITY`, encrypted entries, OLE `.doc`, malformed packages, missing `[Content_Types].xml`, and missing `word/document.xml`; never fetch external XML or relationship resources.
- Imported Annotation/Reply always has `author_id=NULL`, remains visibly `DOCX_IMPORT`, is immutable, and gains no ownership from `attributed_user_id`.
- Generate `import_batch_id`, final annotation IDs, and final reply IDs before Preview; preserve them through refresh and Commit retry.
- One import creates one post, one complete initial revision, one `POST_CREATED` Activity, zero historical Annotation activities, and at most one attribution notification per mapped user per batch.
- Every server mutation validates authorization and ownership. D1 formal relations use one `db.batch()`; R2 objects remain temporary after a failed D1 batch and rely on the existing seven-day GC.
- Each task follows RED → observed expected failure → minimum GREEN implementation → focused regression → progress-document update → commit → immediate push to `origin/main` with a short-lived Sites source credential.
- Use `pwsh.exe` for Windows shell commands. Do not persist Sites credentials in remotes, files, environment profiles, or Git configuration.
- Keep the existing owner-only Sites access policy and current social-preview assets unchanged.

## File and module map

The implementation adds one focused domain under `lib/docx-import/`:

- `types.ts`: IR, warning, error, block, asset, source-comment, thread, preview, and commit payload types.
- `limits.ts`: fixed V5.5 limits and typed errors.
- `xml.ts`: XML preflight, ordered parsing, namespace-tolerant node helpers, and depth checking.
- `package.ts`: Zip.js package reader and ZIP safety accounting.
- `lookups.ts`: styles, numbering, relationships, core properties, comments, CommentEx, and notes lookups.
- `walker.ts`: one ordered `document.xml` walk and active-comment-set propagation.
- `annotations.ts`: comment graph, block-local ranges, atomic thread validation, sorting, and greedy overlap.
- `markdown.ts`: Import IR to canonical Markdown, table escaping, note appendix, and preview Markdown validation.
- `parse.ts`: package-to-parsed-document orchestration; no UI, D1, or R2 dependencies.
- `worker-protocol.ts` and `docx-import.worker.ts`: structured progress/result/error/cancel boundary.
- `browser.ts`: Worker timeout/cancel controller, SHA-256, stable ID finalization, and temporary image upload.
- `preview-store.ts`: 24-hour IndexedDB persistence without source bytes.
- `commit-schema.ts`, `commit-plan.ts`, and `commit-service.ts`: strict untrusted-input schema, pure batch planning, and D1 execution.

UI files stay under `components/docx-import/`; existing V5 Annotation components are extended for source identity rather than duplicated.

---

### Task 1: Lock dependencies and run the officeparser feature probe

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `scripts/fixtures/generate-docx-fixtures.mjs`
- Create: `scripts/probe-officeparser.mjs`
- Create: `lib/docx-import/officeparser-probe.ts`
- Create: `tests/docx-officeparser-probe.test.ts`
- Create: `tests/fixtures/docx/generated/probe-adjacent.docx`
- Create: `tests/fixtures/docx/generated/probe-overlap-nested.docx`
- Create: `tests/fixtures/docx/generated/probe-threaded-resolved.docx`
- Create: `docs/adr/2026-08-28-officeparser-docx-import.md`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- Produces: `OFFICEPARSER_PROBE_GATES`, `officeparserProductionEligible(report)`, and a JSON-serializable `OfficeparserProbeReport`.
- Produces: deterministic fixture generator `writeDocxFixture(path, parts)` used by later parser tests.
- Decision output: ADR states the exact installed version, each observed gate, and the production-path decision.

- [x] **Step 1: Install exact dependencies without production code**

Run:

```powershell
npm install --save-exact '@zip.js/zip.js@2.8.60' 'fast-xml-parser@5.11.1' 'zod@4.4.3'
npm install --save-dev --save-exact 'officeparser@7.8.0' 'fake-indexeddb@6.2.5'
```

Expected: `package-lock.json` resolves exactly those direct versions; `officeparser` and `fake-indexeddb` remain under `devDependencies`.

- [x] **Step 2: Write the failing gate-contract test**

Create a table-driven test that demands exactly seven named gates and makes eligibility their conjunction:

```ts
test("officeparser is eligible only when every required comment capability passes", () => {
  const passing = Object.fromEntries(OFFICEPARSER_PROBE_GATES.map((gate) => [gate, true]));
  assert.equal(officeparserProductionEligible({ version: "7.8.0", gates: passing }), true);
  assert.equal(
    officeparserProductionEligible({
      version: "7.8.0",
      gates: { ...passing, inlineRange: false },
    }),
    false,
  );
});
```

- [x] **Step 3: Run RED**

Run: `npm run test:unit -- tests/docx-officeparser-probe.test.ts`

Expected: FAIL because `lib/docx-import/officeparser-probe.ts` does not exist.

- [x] **Step 4: Implement the gate evaluator and deterministic probe fixtures**

Define the exact gate names:

```ts
export const OFFICEPARSER_PROBE_GATES = [
  "inlineRange",
  "adjacentDistinct",
  "nestedOverlapDistinct",
  "stableCommentId",
  "immediateReplyParent",
  "resolvedState",
  "noSelectedTextSearch",
] as const;
```

The fixture generator must write OPC parts with fixed timestamps and fixed XML strings. The adjacent fixture uses two end/start-touching ranges; the overlap fixture uses two intersecting ranges plus one nested range; the threaded fixture includes `w14:paraId`, `w15:paraIdParent`, and `w15:done=1`.

- [x] **Step 5: Run GREEN and the actual probe**

Run:

```powershell
npm run test:unit -- tests/docx-officeparser-probe.test.ts
node scripts/fixtures/generate-docx-fixtures.mjs
node scripts/probe-officeparser.mjs
```

Expected: the unit test passes; the probe prints one report containing all seven booleans and finishes within two hours. If any gate is false, the script reports `productionEligible: false` and no later production module imports `officeparser`. If all seven are true, stop before Task 2 and amend the ADR and implementation plan rather than silently changing the approved production architecture.

- [x] **Step 6: Record evidence, commit, and push**

Write the actual version, gate evidence, and conclusion in the ADR. Update the progress document with commands and results. Run `git diff --check`, commit as `docs: record officeparser DOCX probe`, obtain a Sites source write credential, and push `HEAD:main` immediately.

---

### Task 2: Define the IR and enforce DOCX package/XML safety

**Files:**

- Create: `lib/docx-import/types.ts`
- Create: `lib/docx-import/limits.ts`
- Create: `lib/docx-import/xml.ts`
- Create: `lib/docx-import/package.ts`
- Create: `tests/helpers/docx-fixture.ts`
- Create: `tests/docx-package-security.test.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- Produces: `DocxImportError`, `DocxImportErrorCode`, `DOCX_IMPORT_LIMITS`, `ImportWarning`, `ImportBlock`, `InlineSegment`, `ParsedDocx`, `DocxImportIR`, and `DocxPreviewRecord`.
- Produces: `openDocxPackage(file): Promise<DocxPackageReader>` with `has(path)`, `readText(path)`, `readBytes(path)`, `entries`, and `close()`.
- Produces: `parseOrderedXml(xml, partName)` and namespace-tolerant helpers `xmlChildren`, `xmlChild`, `xmlAttr`, `xmlText`.
- Consumes: `makeDocxFixture(parts, options)` in every later parser test.

- [x] **Step 1: Write failing package and XML tests**

Cover valid minimum package plus every hard failure class:

```ts
test("rejects DTD before the XML parser sees it", async () => {
  const file = await makeDocxFixture({
    "[Content_Types].xml": MINIMAL_CONTENT_TYPES,
    "word/document.xml": "<!DOCTYPE w:document><w:document/>",
  });
  await assert.rejects(
    () => openAndReadMainDocument(file),
    (error: unknown) => error instanceof DocxImportError && error.code === "XML_DTD_FORBIDDEN",
  );
});

test("rejects a compression ratio above 100 to 1", async () => {
  const file = await makeHighlyCompressibleDocx(2_000_000);
  await assert.rejects(
    () => openDocxPackage(file),
    (error: unknown) => error instanceof DocxImportError && error.code === "ZIP_RATIO_LIMIT",
  );
});
```

Also assert extension, ZIP magic, OLE magic, encrypted entry, duplicate/ambiguous filename, traversal path, entry count, total uncompressed size, required parts, XML part size, nesting depth, and malformed XML.

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/docx-package-security.test.ts`

Expected: FAIL on missing `limits.ts`, `package.ts`, and `xml.ts` exports.

- [x] **Step 3: Implement the minimal typed trust boundary**

Use immutable limits:

```ts
export const DOCX_IMPORT_LIMITS = Object.freeze({
  compressedBytes: 20 * 1024 * 1024,
  zipEntries: 1000,
  uncompressedBytes: 200 * 1024 * 1024,
  compressionRatio: 100,
  xmlPartBytes: 20 * 1024 * 1024,
  xmlDepth: 100,
  images: 200,
  imageBytes: 10 * 1024 * 1024,
  commentsAndReplies: 500,
  markdownUtf8Bytes: 1_500_000,
  workerTimeoutMs: 20_000,
  previewTtlMs: 24 * 60 * 60 * 1000,
});
```

Define `ImportWarning` as `{ code, severity, sourceRef?, count?, payload? }` and make the code union include at least:

```ts
type ImportWarningCode =
  | "HEADING_LEVEL_CLAMPED"
  | "LIST_DEPTH_CLAMPED"
  | "VISUAL_FORMATTING_DROPPED"
  | "TOC_SKIPPED"
  | "TRACK_CHANGES_FLATTENED"
  | "TABLE_HEADER_SYNTHESIZED"
  | "TABLE_CELL_FLATTENED"
  | "TABLE_MERGED_CELLS_FLATTENED"
  | "FLOATING_IMAGE_FLATTENED"
  | "IMAGE_FORMAT_UNSUPPORTED"
  | "TEXTBOX_FLATTENED"
  | "EQUATION_SKIPPED"
  | "NOTES_FLATTENED_TO_APPENDIX"
  | "ANNOTATION_EMPTY_RANGE"
  | "ANNOTATION_CROSS_BLOCK"
  | "ANNOTATION_NON_TEXT_RANGE"
  | "ANNOTATION_TABLE_UNSUPPORTED"
  | "ANNOTATION_OVERLAP_SKIPPED"
  | "ANNOTATION_ORPHAN_DEFINITION"
  | "ANNOTATION_THREAD_SKIPPED";
```

Cosmetic codes aggregate by code/count. Every skipped Annotation thread retains its own `sourceRef` and structured conflict/reply payload.

Open Zip.js with `checkAmbiguity: true`, `strictness: "strict"`, and bounded appended data. Preflight `EntryMetaData.encrypted`, `symlink`, `compressedSize`, `uncompressedSize`, normalized package path, unique filename, totals, and ratio before extraction; recheck extracted byte length. Reject `DOCTYPE`/`ENTITY` case-insensitively before calling fast-xml-parser. Use `preserveOrder: true`, `ignoreAttributes: false`, `attributeNamePrefix: "@_"`, `processEntities: false`, and explicit boolean/tag value behavior.

- [x] **Step 4: Run GREEN and focused regression**

Run:

```powershell
npm run test:unit -- tests/docx-package-security.test.ts
npm run test:unit -- tests/asset-lifecycle.test.ts tests/markdown.test.ts
```

Expected: all pass with no warning output.

- [x] **Step 5: Record, commit, and push**

Update progress with each safety case and the exact dependency APIs used. Run `git diff --check`, commit as `feat: validate DOCX packages safely`, obtain a new short-lived Sites credential, and push immediately.

---

### Task 3: Parse styles, numbering, body text, links, fields, and tracked changes

**Files:**

- Create: `lib/docx-import/lookups.ts`
- Create: `lib/docx-import/walker.ts`
- Create: `lib/docx-import/markdown.ts`
- Create: `lib/docx-import/parse.ts`
- Create: `tests/docx-import-body.test.ts`
- Modify: `tests/helpers/docx-fixture.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- Produces: `loadDocxLookups(pkg): Promise<DocxLookups>`.
- Produces: `walkMainDocument(documentNodes, lookups): WalkedDocument`.
- Produces: `renderCanonicalImportMarkdown(blocks, assets, threads): string`.
- Produces: `parseDocx(file, onProgress?): Promise<ParsedDocx>`; at this task it returns body blocks, warnings, and an empty accepted-thread list while preserving `commentIds` on segments.

- [x] **Step 1: Write failing semantic tests**

Use one fixture containing based-on styles, H1/H5, Quote/IntenseQuote, paragraph/list styles, bold/italic/strike, explicit `CodeChar`, safe/unsafe hyperlinks, cached field text, TOC, `w:ins`, and `w:del`:

```ts
test("uses semantic styles and accepted revision text without visual guessing", async () => {
  const parsed = await parseDocx(await semanticBodyFixture());
  assert.match(parsed.canonicalMarkdown, /^# 一级标题/m);
  assert.match(parsed.canonicalMarkdown, /^#### 五级标题/m);
  assert.match(parsed.canonicalMarkdown, /> 明确引用/);
  assert.match(parsed.canonicalMarkdown, /\*\*粗体\*\*.*\*斜体\*.*~~删除线~~/);
  assert.match(parsed.canonicalMarkdown, /`代码字符样式`/);
  assert.match(parsed.canonicalMarkdown, /保留的插入/);
  assert.doesNotMatch(parsed.canonicalMarkdown, /已删除修订|TOC 1-3/);
  assert.deepEqual(warningCodes(parsed), [
    "HEADING_LEVEL_CLAMPED",
    "TOC_SKIPPED",
    "TRACK_CHANGES_FLATTENED",
    "VISUAL_FORMATTING_DROPPED",
  ]);
});
```

Add table-driven list tests for bullet/numeric/alphabetic/roman formats and levels 0–3, asserting level 3 clamps to the third site level and aggregates `LIST_DEPTH_CLAMPED`.

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/docx-import-body.test.ts`

Expected: FAIL because lookups, walker, renderer, and orchestrator do not exist.

- [x] **Step 3: Implement lookups and the ordered walker**

Resolve paragraph and character styles through cycle-safe `basedOn` traversal. Normalize style IDs/names only for explicit Heading1–Heading9, Quote, IntenseQuote, and the centralized code whitelist. Resolve `numPr → numId → abstractNum → ilvl/numFmt`; do not inspect font metrics or indentation.

The body walker must carry these state values through nested OOXML containers:

```ts
type WalkContext = {
  activeCommentIds: Set<string>;
  hyperlink?: string;
  field: { instruction: string; collectingResult: boolean } | null;
  revision: "accepted" | "discarded";
  location: "body" | "table" | "note" | "textbox";
};
```

At every text run, create one `InlineSegment` with copied `commentIds`, effective marks, and a sanitized `http:`, `https:`, or `mailto:` link. Preserve unsafe-link display text and emit a typed warning. Keep `w:ins`/`moveTo`; skip `w:del`/`moveFrom`. Aggregate cosmetic warnings with counts.

- [x] **Step 4: Implement canonical Markdown rendering**

Render only IR semantics: H1–H4, paragraphs, quotes, three-level ordered/unordered lists, escaped inline marks, code, and safe links. Normalize renderer whitespace deterministically without Unicode normalization. Enforce the 1.5 MB UTF-8 limit after rendering.

- [x] **Step 5: Run GREEN and round-trip regression**

Run:

```powershell
npm run test:unit -- tests/docx-import-body.test.ts
npm run test:unit -- tests/markdown.test.ts tests/annotation-roundtrip.test.ts
```

Expected: body tests and the existing V5 canonical parser/stringifier tests pass.

- [x] **Step 6: Record, commit, and push**

Update progress with supported style/list/field rules and warning evidence. Commit as `feat: import DOCX body semantics` after `git diff --check`; push immediately with a Sites credential.

---

### Task 4: Form comment ranges, threaded replies, and deterministic overlap results

**Files:**

- Create: `lib/docx-import/annotations.ts`
- Create: `tests/docx-import-comments.test.ts`
- Modify: `lib/docx-import/lookups.ts`
- Modify: `lib/docx-import/walker.ts`
- Modify: `lib/docx-import/parse.ts`
- Modify: `lib/docx-import/markdown.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- Produces: `parseWordComments(commentsXml, commentsExtendedXml): WordCommentCatalog`.
- Produces: `buildWordThreads(catalog): WordThread[]` with immediate parents, source order, and resolved state.
- Produces: `resolveAnnotationThreads(walked, threads): { accepted; skipped; warnings }`.
- Consumes: per-segment active comment IDs produced by Task 3; never consumes searched text.

- [x] **Step 1: Write failing range and graph tests**

Cover one, adjacent, overlap, nested, empty, cross-paragraph, list-item, table-cell, image, missing definition, threaded replies, resolved state, missing commentsExtended, missing parent, duplicate paraId, and cycle. Include CJK, `😀` surrogate pairs, `e\u0301`, and RTL text in ranges.

```ts
test("keeps adjacent ranges and greedily skips an intersecting candidate", async () => {
  const parsed = await parseDocx(await adjacentAndOverlapFixture());
  assert.deepEqual(
    parsed.threads.map((thread) => [
      thread.sourceCommentId,
      thread.blockLocalStart,
      thread.blockLocalEnd,
    ]),
    [
      ["1", 0, 2],
      ["2", 2, 4],
    ],
  );
  assert.deepEqual(
    parsed.skippedThreads.map((thread) => ({
      source: thread.sourceCommentId,
      code: thread.warning.code,
      conflict: thread.warning.payload?.conflictsWithSourceCommentId,
    })),
    [{ source: "3", code: "ANNOTATION_OVERLAP_SKIPPED", conflict: "1" }],
  );
});
```

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/docx-import-comments.test.ts`

Expected: FAIL because comment catalog, graph, and range resolver do not exist.

- [x] **Step 3: Complete single-pass range formation**

In `walker.ts`, handle range markers exactly where encountered:

```ts
if (name === "w:commentRangeStart") context.activeCommentIds.add(requiredId(node));
if (name === "w:t") appendSegment(xmlText(node), [...context.activeCommentIds]);
if (name === "w:commentRangeEnd") context.activeCommentIds.delete(requiredId(node));
```

At block close, derive each comment's UTF-16 start/end from the completed segments and record every location category/block transition. Do not normalize text or map through Markdown.

- [x] **Step 4: Build threads and resolve legality**

Map a comment's last `w14:paraId` to the matching record in `word/commentsExtended.xml` via CommentEx `w15:paraId`; use only `w15:paraIdParent` for immediate parent and `w15:done` for `sourceResolved`/`source_resolved`. Without `commentsExtended.xml`, make each definition a flat root. A bad root or graph makes its entire thread skipped; include `replyCount` in `ANNOTATION_THREAD_SKIPPED` payload.

For each block, sort root candidates by `start ASC`, `length DESC`, `sourceCommentId ASC`, then greedy accept. Treat only `candidate.start < accepted.end && accepted.start < candidate.end` as intersection so touching endpoints survive.

- [x] **Step 5: Render annotation directives and run GREEN**

Wrap accepted inline ranges as the existing `:annotation[]{#ann_*}` canonical directive after IDs are finalized. For the pre-finalized parser test, use stable injected ID factories. Run:

```powershell
npm run test:unit -- tests/docx-import-comments.test.ts
npm run test:unit -- tests/annotation-selection.test.ts tests/annotation-roundtrip.test.ts tests/markdown.test.ts
```

Expected: all range/graph tests and all existing V5 annotation tests pass.

- [x] **Step 6: Record, commit, and push**

Update progress with the single-pass proof, UTF-16 cases, graph fallback, and overlap ordering. Commit as `feat: import DOCX comment threads` and push immediately.

---

### Task 5: Import tables, images, notes, text boxes, equations, and deterministic degradation

**Files:**

- Create: `tests/docx-import-rich-content.test.ts`
- Modify: `lib/docx-import/types.ts`
- Modify: `lib/docx-import/lookups.ts`
- Modify: `lib/docx-import/walker.ts`
- Modify: `lib/docx-import/annotations.ts`
- Modify: `lib/docx-import/markdown.ts`
- Modify: `lib/docx-import/parse.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- Produces: `ImportAssetCandidate` values containing local asset ID, filename, MIME, bytes, alt text, source relationship, and floating flag.
- Produces: rectangular `TableBlock`, flattened merged-table paragraphs, and one `NotesAppendixBlock`.
- Preserves: table/image/note location facts consumed by the thread resolver.

- [ ] **Step 1: Write failing rich-content tests**

Use fixtures for table with explicit header, table without header, multiparagraph cell, `gridSpan`, `vMerge`, supported inline/floating PNG/JPEG/GIF/WebP, SVG/EMF/WMF, image alt precedence, textbox, OMML, shape text, footnote/endnote, and comments inside table/image/note.

```ts
test("degrades merged tables and notes without raw HTML or lost text", async () => {
  const parsed = await parseDocx(await richContentFixture());
  assert.match(parsed.canonicalMarkdown, /A \| B/);
  assert.doesNotMatch(parsed.canonicalMarkdown, /<table|<td/);
  assert.match(parsed.canonicalMarkdown, /脚注（从 Word 导入）/);
  assert.match(parsed.canonicalMarkdown, /\[1\] 脚注正文/);
  assert.ok(warningCodes(parsed).includes("TABLE_MERGED_CELLS_FLATTENED"));
  assert.ok(warningCodes(parsed).includes("NOTES_FLATTENED_TO_APPENDIX"));
});
```

- [ ] **Step 2: Run RED**

Run: `npm run test:unit -- tests/docx-import-rich-content.test.ts`

Expected: FAIL on missing table/image/note behavior.

- [ ] **Step 3: Implement table semantics**

Detect explicit header semantics from row properties. Otherwise synthesize an empty Markdown header and emit `TABLE_HEADER_SYNTHESIZED`. Join multiple cell paragraphs with `/` and emit one counted `TABLE_CELL_FLATTENED`. On `gridSpan`, `vMerge`, rowSpan, or colSpan, flatten the entire table to source-order row text joined with `|` and emit one `TABLE_MERGED_CELLS_FLATTENED`. Escape pipes and newlines; emit no raw HTML. Mark all comments located in tables as thread-level `ANNOTATION_TABLE_UNSUPPORTED`.

- [ ] **Step 4: Implement assets and special-content degradation**

Resolve only embedded relationship targets under `word/media/`. Allow PNG/JPEG/GIF/WebP after signature/MIME agreement and enforce count/byte limits. Use `descr → title → filename → image` for alt. Skip SVG/EMF/WMF with `IMAGE_FORMAT_UNSUPPORTED`. Preserve floating supported images at the nearest source-order body position and emit `FLOATING_IMAGE_FLATTENED`.

Flatten readable `w:txbxContent` near its anchor, output `[公式]` for OMML, preserve readable shape/SmartArt text, and emit the typed warning for each unsupported semantic category.

- [ ] **Step 5: Implement note appendix and run GREEN**

Assign a shared stable sequence to footnote/endnote references, render `[N]` in the body, and append the required horizontal rule/title/list. Never propagate note comments into accepted Annotation threads.

Run:

```powershell
npm run test:unit -- tests/docx-import-rich-content.test.ts
npm run test:unit -- tests/docx-import-body.test.ts tests/docx-import-comments.test.ts tests/asset-lifecycle.test.ts
```

Expected: all pass; warning aggregation has one cosmetic row per code and one detailed row per skipped thread.

- [ ] **Step 6: Record, commit, and push**

Update progress with table/image/note behavior and limit evidence. Commit as `feat: import DOCX rich content safely` and push immediately.

---

### Task 6: Add the Worker boundary and recoverable 24-hour Preview storage

**Files:**

- Create: `lib/indexed-db.ts`
- Modify: `lib/drafts/indexed-db.ts`
- Create: `lib/docx-import/worker-protocol.ts`
- Create: `lib/docx-import/docx-import.worker.ts`
- Create: `lib/docx-import/browser.ts`
- Create: `lib/docx-import/preview-store.ts`
- Create: `tests/docx-worker.test.ts`
- Create: `tests/docx-preview-store.test.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- `parseDocxWithWorker(file, { onProgress, signal, timeoutMs: 20_000 })` resolves a structured parse result or rejects a typed import error.
- `finalizeDocxPreview(parsed, { importBatchId, sourceSha256, idFactory })` mints all final root/reply UUIDs before Preview.
- `saveImportPreview`, `loadImportPreview`, `removeImportPreview`, and `purgeExpiredImportPreviews` share IndexedDB version 2 with the existing draft store.

- [ ] **Step 1: Write failing Worker protocol tests**

Test the exact message union (`start`, `progress`, `cancel`, `success`, `failure`), ordered progress stages, caller abort, the fixed 20-second timeout, Worker termination after every terminal outcome, and preservation of a structured error code/payload. Inject a fake Worker and fake timer so the timeout test is immediate.

```ts
test("terminates a timed-out DOCX worker with a typed error", async () => {
  const worker = new FakeWorker();
  await assert.rejects(
    parseDocxWithWorker(file, { workerFactory: () => worker, timeoutMs: 20_000 }),
    (error: DocxImportError) => error.code === "PARSE_TIMEOUT",
  );
  assert.equal(worker.terminated, true);
});
```

- [ ] **Step 2: Write failing IndexedDB lifecycle tests**

Use `fake-indexeddb/auto`. Start one case from the current version-1 `drafts` database, upgrade it, and prove the draft remains readable. Prove the Preview record contains the source filename/hash, parsed IR, warnings, temporary asset refs, mappings, and final IDs but not original bytes. Prove records at or beyond 24 hours are purged.

Run: `npm run test:unit -- tests/docx-worker.test.ts tests/docx-preview-store.test.ts`

Expected: FAIL because the protocol/controller/store do not exist.

- [ ] **Step 3: Implement one shared IndexedDB opener**

Move database name/version/opening into `lib/indexed-db.ts`. Version 2 creates `docx-import-previews` keyed by `importBatchId` and an expiry index while retaining `drafts`. Make the existing draft adapter use the shared opener; do not open the same database later with version 1.

- [ ] **Step 4: Implement Worker progress, cancel, timeout, and finalization**

The Worker emits `package-validation`, `xml-preload`, `document-walk`, `thread-validation`, `markdown-generation`, then `done`. It never performs network I/O. The controller terminates on success, parser failure, abort, or timeout and ignores late messages.

Compute source SHA-256 with `crypto.subtle.digest`. Generate one `import_batch_id` and all accepted root/reply UUIDs exactly once. Map Word IDs to those UUIDs before canonical annotation directives are emitted, and persist that finalized payload unchanged across refresh/retry.

- [ ] **Step 5: Run GREEN and regression tests**

Run:

```powershell
npm run test:unit -- tests/docx-worker.test.ts tests/docx-preview-store.test.ts
npm run test:unit -- tests/draft-indexed-db.test.ts
```

Expected: all pass; no Preview value contains a `File`, `Blob`, or ArrayBuffer of the original DOCX.

- [ ] **Step 6: Record, commit, and push**

Update progress with protocol states, cancellation/timeout evidence, IndexedDB migration, and TTL behavior. Commit as `feat: run DOCX import in a recoverable worker preview` and push immediately.

---

### Task 7: Build the import workspace and validated Preview

**Files:**

- Create: `app/(site)/posts/import/page.tsx`
- Create: `components/docx-import/docx-import-workspace.tsx`
- Create: `components/docx-import/docx-import-preview.tsx`
- Create: `lib/docx-import/preview-validation.ts`
- Create: `tests/docx-import-preview.test.ts`
- Modify: `app/(site)/posts/new/page.tsx`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- Server page calls `requireMember("/posts/import")` and supplies the current site users for explicit Word-author attribution.
- Client state machine: `selecting → parsing → uploading → previewing → committing → complete`, with cancel and recoverable error states.
- `validateEditedImportPreview(preview)` returns typed blocking errors and a commit-safe canonical payload.

- [ ] **Step 1: Write failing Preview validation tests**

Cover title trimming, the 1.5 MB UTF-8 Markdown limit, unknown/duplicate/missing annotation IDs, edited annotation text mismatch, nested directives, overlapping ranges, unsafe external URLs, and preservation of generated IDs.

```ts
test("blocks commit after the editor removes an imported anchor", () => {
  const result = validateEditedImportPreview({ ...preview, markdown: "正文" });
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((item) => item.code === "ANNOTATION_ANCHOR_MISSING"));
});
```

- [ ] **Step 2: Add route/markup assertions and run RED**

Assert that the new-post page exposes the import entry point and the import route contains the file-picker, progress, warning summary, mapping controls, Annotation-lock notice, cancel, and disabled-confirm states.

Run: `npm run test:unit -- tests/docx-import-preview.test.ts && npm run test:rendered`

Expected: FAIL because the route/components do not exist.

- [ ] **Step 3: Implement selection through temporary image upload**

Accept only one `.docx`, check extension and compressed size before starting, show Worker stage/count progress, and expose cancel. After parsing, upload supported images one at a time through the existing authenticated temporary `/api/assets` path, replace local asset references with returned canonical URLs, record temporary asset IDs, validate, and then persist Preview. On upload failure, keep already-uploaded objects temporary and show a retryable typed error.

- [ ] **Step 4: Implement editable Preview and warning presentation**

Render the final title, Milkdown Markdown body, images, tables, Annotation highlights/threads, source author identity, explicit attribution selectors, warning summary, and individually referenced skipped threads. Expand at most 50 detailed warnings by default and aggregate the rest by code/count. Localize typed codes in the component; never persist localized strings as warning truth.

After title/body edits, rerun Preview validation. Any `severity="error"` or validation error disables Confirm. If accepted annotations exist, show the exact V5 temporary editing-lock notice. Restored Previews rerun asset/expiry validation before becoming confirmable.

- [ ] **Step 5: Run GREEN and the first meaningful Preview gate**

Run:

```powershell
npm run test:unit -- tests/docx-import-preview.test.ts
npm run test:rendered
npx tsc --noEmit
```

Expected: all pass. Start the development server, request `/posts/import` through the existing auth test harness, and verify the route returns the stable shell without runtime errors. Open that stable route once in the Codex Site preview panel; do not perform browser interaction testing unless separately authorized.

- [ ] **Step 6: Record, commit, and push**

Update progress with the state machine, validation rules, warning cap, restore behavior, and Preview evidence. Commit as `feat: add DOCX import preview workspace` and push immediately.

---

### Task 8: Extend the durable model for imported identity and full initial snapshots

**Files:**

- Modify: `db/schema.ts`
- Create: `drizzle/0005_docx_import.sql`
- Modify: `drizzle/meta/_journal.json`
- Create or modify: `drizzle/meta/0005_snapshot.json`
- Create: `tests/docx-import-migration.test.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**Schema changes:**

- `import_batches`: batch ID, importer, source filename/hash, post, revision, committed timestamp; batch ID is the idempotency key.
- Imported source columns on roots and replies: source type, author name, initials, source timestamp/comment ID/document order/resolved flag, import batch, importer, and nullable attributed user.
- Existing `author_id` becomes nullable; native rows retain `source_type='NATIVE'`, imported rows require `author_id IS NULL` and `source_type='DOCX_IMPORT'`.
- `revision_imported_reply_states` captures each imported reply's visibility/deletion state in every post revision snapshot.
- Notifications gain `DOCX_ATTRIBUTION_NOTICE`, `metadata_json`, `import_batch_id`, and a uniqueness constraint that permits at most one notice per recipient/batch/type.

- [ ] **Step 1: Write a failing migration contract test**

Create a pre-migration SQLite database with representative V5 native data, apply all migrations, then assert native author/annotation/reply/history rows survive. Insert a legal imported root/reply, reject an imported row with non-null author, and reject a duplicate attribution notice.

Run: `npm run test:unit -- tests/docx-import-migration.test.ts`

Expected: FAIL because migration 0005 and the new Drizzle fields do not exist.

- [ ] **Step 2: Define the Drizzle model and generate a migration baseline**

Use enum-like text checks for source and notification types. Keep native submission keys required; imported rows use deterministic keys such as `docx:${batchId}:${sourceCommentId}`. Add indexes for batch lookup, post/source order, attribution, and imported-reply snapshot lookup.

- [ ] **Step 3: Make the SQLite migration lossless**

Where SQLite cannot alter nullability/check constraints, rebuild the table inside the migration with explicit column lists, copy every V5 column, restore foreign keys and indexes, then drop the old table. Do not infer or rewrite native timestamps, IDs, soft-delete state, or submission keys.

- [ ] **Step 4: Run GREEN and inspect generated SQL**

Run:

```powershell
npm run test:unit -- tests/docx-import-migration.test.ts
npx drizzle-kit check
rg -n "DROP TABLE|CREATE TABLE|FOREIGN KEY|UNIQUE INDEX" drizzle/0005_docx_import.sql
```

Expected: tests and Drizzle consistency pass; every rebuild has an explicit data-copy statement and all prior indexes/FKs are restored.

- [ ] **Step 5: Record, commit, and push**

Update progress with migration replay and constraint evidence. Commit as `feat: model imported DOCX annotation identity` and push immediately.

---

### Task 9: Validate untrusted IR and atomically commit an idempotent import

**Files:**

- Create: `lib/docx-import/commit-schema.ts`
- Create: `lib/docx-import/commit-plan.ts`
- Create: `lib/docx-import/commit-service.ts`
- Create: `app/api/docx-import/route.ts`
- Create: `tests/docx-import-commit.test.ts`
- Modify: `components/docx-import/docx-import-workspace.tsx`
- Modify: `docs/v5-5-docx-import-progress.md`

**Interfaces:**

- `DocxImportCommitSchema` is a strict Zod schema; unknown fields fail.
- `commitDocxImport(importerUserId: string, input: unknown): Promise<{ postId: string; revisionId: string; alreadyCommitted: boolean }>` owns all server validation and batch execution.
- `planDocxImportCommit(validated, context)` produces bounded D1 statements and is testable without a live database.

- [ ] **Step 1: Write failing schema and trust-boundary tests**

Cover unauthenticated/non-allowlisted users, unknown payload fields, title/Markdown limits, duplicate/malformed UUIDs, missing/extra annotation directives, cross-block/nested/overlap roots, count limits, imported non-null `author_id`, invalid attribution user, another user's asset, non-temporary asset, bad MIME, unsafe URL, duplicate batch retry, and same batch with a different importer/hash/payload.

```ts
test("cannot forge native authorship in an imported thread", async () => {
  await assert.rejects(
    commitDocxImport(importer.id, forgedInput({ authorId: member.id })),
    /IMPORTED_AUTHOR_MUST_BE_NULL/,
  );
});
```

- [ ] **Step 2: Run RED**

Run: `npm run test:unit -- tests/docx-import-commit.test.ts`

Expected: FAIL because no commit schema/service exists.

- [ ] **Step 3: Implement strict validation and bounded planning**

Reparse canonical Markdown with the existing V5 parser and compare the exact accepted annotation UUID set and selected text against the payload. Recompute block-local UTF-16 ranges, sort by `start ASC, length DESC, sourceCommentId ASC`, and reject any intersecting pair. Validate root/reply graph, a maximum of 500 combined imported items, safe external schemes, every attributed user, and every temporary asset's owner/type/status.

Generate the post and revision IDs server-side. Chunk bulk inserts to a fixed conservative row count (30–50, based on column count) but place every chunk in the same `db.batch()`.

- [ ] **Step 4: Implement the atomic write and idempotency race handling**

Precheck `import_batches`: a matching completed batch returns its original post/revision with `alreadyCommitted=true`; a mismatched owner/hash rejects. The batch inserts, in FK-safe order, the post, one complete initial revision, import metadata, asset bindings, roots, imported replies, annotation/reply snapshot rows, one `POST_CREATED` event, and at most one summary notice per attributed user.

Claim every temporary asset inside the same D1 batch using an owner/status/MIME-guarded statement that fails rather than binding an unowned object. Do not move or delete R2 objects. If the unique import-batch insert loses a race, query and return the already-committed result only when identity/hash match; otherwise return a conflict. Any other statement failure rolls back the full D1 batch.

- [ ] **Step 5: Wire the authenticated endpoint and Confirm action**

The route obtains the authenticated allowlisted member and passes only their ID plus raw JSON to the service. It returns typed 4xx errors without leaking SQL details. On success the client deletes its IndexedDB Preview and navigates to the new post; on network/5xx failure it retains the exact batch/UUID payload for safe retry.

- [ ] **Step 6: Run GREEN and focused regressions**

Run:

```powershell
npm run test:unit -- tests/docx-import-commit.test.ts
npm run test:unit -- tests/posts.test.ts tests/asset-lifecycle.test.ts tests/annotations.test.ts
npx tsc --noEmit
```

Expected: all pass; the duplicate request returns one post ID, and the injected mid-batch failure leaves no post, revision, thread, activity, or notification rows.

- [ ] **Step 7: Record, commit, and push**

Update progress with validation matrix, chunk size, rollback evidence, asset guard, and retry outcome. Commit as `feat: commit DOCX imports atomically` and push immediately.

---

### Task 10: Render source identity and enforce imported-thread permissions

**Files:**

- Modify: `lib/annotations/queries.ts`
- Modify: `lib/annotations/policy.ts`
- Modify: `lib/annotations/service.ts`
- Modify: `lib/annotations/lifecycle.ts`
- Modify: `lib/annotations/transaction.ts`
- Modify: `app/(site)/posts/actions.ts`
- Modify: `app/(site)/posts/[id]/page.tsx`
- Modify: `components/annotations/annotation-thread.tsx`
- Modify: `components/annotations/annotation-sheet.tsx`
- Create: `tests/docx-import-identity.test.ts`
- Modify: `tests/annotation-replies.test.ts`
- Modify: `tests/annotation-lifecycle.test.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

**View model:**

```ts
type AnnotationAuthorView = {
  sourceType: "NATIVE" | "DOCX_IMPORT";
  id: string | null;
  displayName: string;
  avatarAssetId: string | null;
  initials: string | null;
  attributedUser: { id: string; displayName: string } | null;
  sourceResolved: boolean;
};
```

Permission booleans are computed server-side and sent to components; UI labels are never an authorization source.

- [ ] **Step 1: Write failing query, sort, and display tests**

Cover nullable imported authors, visible `Word 导入`, source initials/date/resolved state, an optional `关联 …` label, root sidebar order by canonical anchor position, and reply order by source timestamp, then document order, then source comment ID. Ensure missing users do not drop imported rows through an inner join.

- [ ] **Step 2: Write failing lifecycle permission tests**

Prove imported root/replies are immutable, the attributed user receives no edit/delete permission, the post author/importer can remove the imported thread, and administrators retain V5 hide/restore. For removal, cover both branches: no later native replies unwraps the anchor; native replies retain the anchor plus a deleted imported placeholder and never delete native replies.

Run:

```powershell
npm run test:unit -- tests/docx-import-identity.test.ts tests/annotation-replies.test.ts tests/annotation-lifecycle.test.ts
```

Expected: FAIL on nullable joins/source identity and imported-thread policy.

- [ ] **Step 3: Extend queries and components without duplicating Annotation UI**

Use left joins for native and attributed users. Map both sources into the common author view. Render imported identity as source name plus `Word 导入`; when mapped, append `关联 {site user}` without replacing the source identity. Render `Word 中已解决` as metadata only and keep the thread visible.

Derive root order from the annotation IDs encountered by the canonical Markdown parser, not `created_at`. Keep native reply behavior; use the deterministic source ordering for imported replies.

- [ ] **Step 4: Enforce source-aware mutations**

Every edit/delete service rejects `DOCX_IMPORT`. Replying to an imported root remains allowed for members, but null root authors produce no normal interaction recipient. Replying to a native reply can still notify that native author.

Implement `removeImportedAnnotationThread` only for the post author/original importer (plus existing administrator controls). Soft-delete imported content according to the two removal branches and never cascade to native replies. Keep authoritative checks in service/policy code even when buttons are absent.

- [ ] **Step 5: Run GREEN and regression tests**

Run:

```powershell
npm run test:unit -- tests/docx-import-identity.test.ts tests/annotation-replies.test.ts tests/annotation-lifecycle.test.ts
npm run test:unit -- tests/annotations.test.ts tests/annotation-visibility.test.ts
npx tsc --noEmit
```

Expected: all pass; imported rows render without a native user and cannot traverse native-only mutation paths.

- [ ] **Step 6: Record, commit, and push**

Update progress with identity rendering, ordering, permission matrix, and both soft-delete branches. Commit as `feat: distinguish imported DOCX annotation threads` and push immediately.

---

### Task 11: Snapshot imported replies and send transparent attribution summaries

**Files:**

- Modify: `lib/revisions/policy.ts`
- Modify: `lib/revisions/service.ts`
- Modify: `lib/annotations/service.ts`
- Modify: `db/queries.ts`
- Modify: `lib/notifications/policy.ts`
- Modify: `app/(site)/notifications/page.tsx`
- Modify: `app/(site)/notifications/[id]/page.tsx`
- Create: `tests/docx-import-revision.test.ts`
- Create: `tests/docx-attribution-notification.test.ts`
- Modify: `docs/v5-5-docx-import-progress.md`

- [ ] **Step 1: Write failing full-snapshot tests**

Import a thread with replies, remove/hide it, create later annotation-state revisions, and restore the initial revision. Assert that root and every imported reply return to the exact initial visible/deleted/hidden state while later native replies remain governed by the existing V5 rules.

- [ ] **Step 2: Write failing attribution-notice tests**

Map several roots/replies in one batch to the same member and others to a second member. Assert exactly one `DOCX_ATTRIBUTION_NOTICE` per recipient/batch, the count includes all mapped Word comments, the imported source creates no personal Activity and no `ANNOTATION_CREATED`/`ANNOTATION_REPLY_CREATED` events, and the notice does not grant ownership.

Run:

```powershell
npm run test:unit -- tests/docx-import-revision.test.ts tests/docx-attribution-notification.test.ts
```

Expected: FAIL because imported reply snapshots and the new notice rendering are absent.

- [ ] **Step 3: Extend every annotation-state snapshot path**

Whenever V5 records an annotation-state revision, copy current imported reply states into `revision_imported_reply_states` in the same transaction. Initial DOCX commit already writes the complete snapshot. Restore applies root and imported-reply state from the selected snapshot; it does not synthesize or orphan replies.

- [ ] **Step 4: Render the aggregate notification explicitly**

Store stable metadata containing post ID/title, importer display name, and mapped comment count. Add explicit list/detail branching for `DOCX_ATTRIBUTION_NOTICE`, link to the post, and render the localized aggregate sentence. Do not fall through a generic native-interaction template.

- [ ] **Step 5: Run GREEN and existing revision/notification regressions**

Run:

```powershell
npm run test:unit -- tests/docx-import-revision.test.ts tests/docx-attribution-notification.test.ts
npm run test:unit -- tests/revisions.test.ts tests/notifications.test.ts tests/activity.test.ts
npx tsc --noEmit
```

Expected: all pass; restoration is complete and every recipient sees at most one batch notice.

- [ ] **Step 6: Record, commit, and push**

Update progress with snapshot round-trip and notification aggregation evidence. Commit as `feat: snapshot DOCX replies and attribution notices` and push immediately.

---

### Task 12: Add reproducible public producer fixtures and end-to-end import compatibility tests

**Files:**

- Create: `tests/fixtures/docx/public/manifest.json`
- Create: `tests/fixtures/docx/public/PROVENANCE.md`
- Create: `tests/fixtures/docx/public/word-desktop-comments.docx`
- Create: `tests/fixtures/docx/public/word-desktop-footnotes.docx`
- Create: `tests/fixtures/docx/public/google-docs-export.docx`
- Create: `tests/fixtures/docx/public/libreoffice.docx`
- Create when provenance is verified: `tests/fixtures/docx/public/word-online.docx`
- Modify: `scripts/fixtures/generate-docx-fixtures.mjs`
- Create: `scripts/fixtures/fetch-public-docx-fixtures.mjs`
- Create: `tests/docx-import-producers.test.ts`
- Create: `tests/docx-import-e2e.test.ts`
- Create: `tests/fixtures/docx/expected/normalized-ir.json`
- Modify: `docs/v5-5-docx-import-progress.md`

**Pinned public sources:**

- Microsoft Word Desktop comments: Mammoth MIT fixture `https://raw.githubusercontent.com/mwilliamson/mammoth.js/master/test/test-data/comments.docx`, SHA-256 `adc9f524d176f562db830c346c1e9e21c6a6aa6768d9c09892a423f1257fe17c`.
- Microsoft Word Desktop footnotes: Mammoth MIT fixture `https://raw.githubusercontent.com/mwilliamson/mammoth.js/master/test/test-data/footnotes.docx`, SHA-256 `a3d786ba3ad53833dd3d5e01bd55e93b628c1287d8f9210eb94cb7533f270306`.
- Google Docs export described by PDF Association: `https://docs.google.com/document/d/13VYmMbpzDUJuKloZY-vCmOdIZcafTcH1/export?format=docx`, SHA-256 `c77c29900f24e7548b1298fb8ef74500e83f50e075ed9c8798edd637cb03b409`, provenance page `https://pdfa.org/googles-pdf-preview-fails-including-with-pdfs-made-by-google-docs/`.
- LibreOffice: mat2 LGPL-3.0-or-later fixture `https://raw.githubusercontent.com/jvoisin/mat2/master/tests/data/dirty.docx`, SHA-256 `6c50f8f8284578a88ca19c1468ae467d98806c72d3dccf71245a583138b9a7e8`.

- [ ] **Step 1: Make fixture acquisition reproducible**

The fetch script downloads only the manifest URLs, verifies the exact SHA-256 before replacing a fixture, records license/source/provenance and the observed producer evidence, and fails closed on any mismatch. Never classify a producer solely from mutable filenames; require a source statement plus internal package evidence when available.

For Word Online, locate a publicly downloadable, redistributable DOCX with explicit creation/export provenance and pin its hash. If no trustworthy fixture can be obtained, do not relabel another producer: leave the file absent, mark the producer test skipped with a precise reason, record this as an unmet compatibility gate, and stop before claiming or performing final deployment until the user supplies/approves a fixture or explicitly accepts the gap.

- [ ] **Step 2: Complete the generated semantic matrix**

Generate fixed-byte fixtures covering paragraphs, H1–H9, run-style inheritance, bold/italic/strike, code-style whitelist, lists at levels 1–4, Quote/Intense Quote, safe/unsafe links, cached fields, TOC, header/no-header/merged tables, inline/floating images, notes, Track Changes, OMML, text boxes, all required comment cases, threaded/resolved/missing-extended comments, CJK, emoji/surrogate pairs, combining characters, and mixed RTL. Commit the generator and exact outputs together.

- [ ] **Step 3: Write failing producer and normalized-IR tests**

For each available public fixture, assert no crash, deterministic typed warnings, stable source order, and only producer-supported claims. Run each generated fixture twice with two deterministic ID-factory implementations and compare a normalized IR/Markdown projection that excludes only injected UUID values.

```ts
assert.deepEqual(normalizeImport(first), normalizeImport(second));
assert.equal(first.canonicalMarkdown, second.canonicalMarkdown);
assert.equal(JSON.stringify(first.warnings), JSON.stringify(second.warnings));
```

Run: `npm run test:unit -- tests/docx-import-producers.test.ts tests/docx-import-e2e.test.ts`

Expected: FAIL until the manifest, expected IR, and full pipeline harness exist.

- [ ] **Step 4: Exercise the complete semantic pipeline**

Run `DOCX → package validation → Worker parser → finalized Preview → temporary asset stubs → commit schema/plan → reloaded canonical Markdown → V5 parser → ProseMirror document`. Assert body order/formatting, image/table readability, exact accepted ranges without selected-text search, adjacent preservation, deterministic illegal-thread skips, reply graph/resolved metadata, visible imported identity, and complete initial revision state.

- [ ] **Step 5: Run GREEN and producer matrix**

Run:

```powershell
node scripts/fixtures/fetch-public-docx-fixtures.mjs --verify
node scripts/fixtures/generate-docx-fixtures.mjs --check
npm run test:unit -- tests/docx-import-producers.test.ts tests/docx-import-e2e.test.ts
npm run test:unit
```

Expected: all available producer rows pass, fixture hashes match, generated fixtures are byte-for-byte current, and any unavailable Word Online row is an explicit deployment blocker rather than a false pass.

- [ ] **Step 6: Record, commit, and push**

Update progress with a producer/version/feature/result table and any explicit gap. Commit as `test: verify DOCX import producers end to end` and push immediately.

---

### Task 13: Perform final audit, publish the implementation report, and deploy privately

**Files:**

- Create: `docs/v5-5-docx-import-report.md`
- Modify: `docs/v5-5-docx-import-progress.md`

- [ ] **Step 1: Audit every V5.5 invariant before claiming completion**

Run targeted searches and inspect each result:

```powershell
rg -n "selectedText|indexOf\(|lastIndexOf\(" lib/docx-import components/docx-import app/api/docx-import
rg -n "officeparser" lib app components
rg -n "authorId|author_id" lib/docx-import lib/annotations db/schema.ts
rg -n "ANNOTATION_CREATED|ANNOTATION_REPLY_CREATED" lib/docx-import app/api/docx-import
rg -n "fetch\(|XMLHttpRequest|sendBeacon" lib/docx-import/docx-import.worker.ts lib/docx-import/xml.ts
rg -n "File|Blob|ArrayBuffer|sourceBinary|originalDocx" lib/docx-import/preview-store.ts
```

Expected: no selected-text/source-offset reconstruction, no officeparser production import, no Worker/XML remote fetch, no raw DOCX persistence, no imported native author assignment, and no historical interaction Activity. Any legitimate occurrence is explained in the report with its safe role.

- [ ] **Step 2: Run fresh complete verification**

Use the verification-before-completion discipline and run from a clean dependency install if feasible:

```powershell
npm run test:unit
npx tsc --noEmit
npm run lint
npm test
git diff --check
npx drizzle-kit check
node scripts/fixtures/fetch-public-docx-fixtures.mjs --verify
node scripts/fixtures/generate-docx-fixtures.mjs --check
```

Expected: every command exits 0 with fresh output. Also run the Sites checkpoint build and package validation required by the Sites skill. Do not waive or obscure a failing test, unavailable required fixture, schema drift, or deployment check.

- [ ] **Step 3: Write the required implementation report**

Document all 17 requested items with links to code/tests and concrete evidence: officeparser version/probe; production-path decision; OOXML parts; IR schema; single-pass range formation; absence of source mapping; heading/list/table rules; reply/resolve parsing; deterministic overlap; imported identity/attribution permissions; typed warnings; Worker limits; Preview/IndexedDB lifetime; D1/R2 consistency; commit idempotency; producer results; and unsupported constructs.

Add the final verification command/results, migration number, last feature commit, and remaining limitations. Update the progress ledger to `complete` only when every non-explicitly-accepted gate is complete.

- [ ] **Step 4: Commit and immediately push the verified report state**

Run `git status --short` and review the exact diff. Commit as `docs: complete V5.5 DOCX import report`, push to `origin/main` with a short-lived Sites credential, and verify the remote branch contains the commit. Never deploy an uncommitted or unpushed tree.

- [ ] **Step 5: Package and deploy one owner-only Site version**

Use the Sites plugin's project package script and validate the archive. Read the current Site metadata immediately before deployment and prove the access policy remains owner-only. Save a version from the exact final commit/archive, deploy it with the private deployment operation, and poll until terminal success/failure. Do not create a public-access version or modify the existing social image.

- [ ] **Step 6: Verify the deployed result and hand off**

Open the deployed Site URL once in the stable Site tab and verify the authenticated shell/import entry route returns without a deployment/runtime error. Report the private URL, exact commit, verification results, producer matrix, all 17 implementation points, and remaining unsupported Word constructs. If deployment fails, report the terminal failure and leave the last known-good private version active.

---

## Completion Definition

V5.5 is complete only when supported fixtures deterministically produce equivalent normalized IR, canonical Markdown, accepted Annotation ranges, thread graphs, typed warnings, and persisted initial state; unsupported constructs deterministically degrade or reject; duplicate commits create no duplicate post; imported identity cannot masquerade as a native user; all focused and full regressions pass; each feature commit is present on `origin/main`; the report is complete; and the verified version is privately deployed without changing the Site access policy.
