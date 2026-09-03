# AnnotationGuard V6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let post authors edit annotated Markdown as a normal document while preserving every Annotation anchor/thread/revision invariant, requiring one explicit confirmation only when an edit truly destroys protected anchor semantics, and finish the site's loading, error, selection-preview, and reply-composer UX.

**Architecture:** A pure ProseMirror transaction inspector scans Annotation Mark ranges before and after every proposed document change, classifies safe changes or one aggregated impact, and is wrapped by one editor plugin/controller for confirmation, history, clipboard, drag/drop, and IME behavior. The browser keeps confirmed removals only in the editor session and IndexedDB draft; the server reparses submitted canonical Markdown, computes an annotation delta from the current revision, rejects unconfirmed loss or stale annotation state, and commits post, revision, anchors, lifecycle, assets, and tags in one guarded D1 batch. Existing read rendering and thread components are reused for the edit-page read-only Sidebar and for selection/reply UI refinements.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16 App Router through Vinext 0.0.50, Milkdown/Crepe 7.22.1, ProseMirror through `@milkdown/kit`, unified/remark, Drizzle ORM 0.45.2, Cloudflare D1/R2, IndexedDB, Node 22 test runner, happy-dom 18, and a native Vinext navigation progress bridge.

**Spec:** `docs/superpowers/specs/2026-08-31-annotation-guard-v6-design.md`

## Global Constraints

- Preserve V1–V5.5 authentication, allowlist, Profile, Markdown, assets, Activity, Notification, lifecycle, revision, conflict, Annotation, responsive reader, and DOCX Import behavior.
- Preserve the V5 annotated-post edit lock until Tasks 1–9 and the final regression gates in Task 10 pass.
- Keep one canonical Annotation Mark, parser/serializer, editor, thread query, and lifecycle model; do not create a parallel annotation or editor system.
- Treat current first and last grapheme clusters as protected endpoints. Deleting or replacing either endpoint requires retirement confirmation even when a shorter anchor could remain structurally valid.
- An active anchor is non-empty, continuous, occurs once, remains within one supported text block, and cannot overlap or nest another anchor.
- Ordinary formatting-only transactions and selection-only transactions are safe even when their selection crosses Annotation boundaries.
- All destructive IDs are aggregated into one dialog. Confirmed destructive execution removes marks and applies original steps in one history event; stale replay is rejected.
- Copy, paste, cut, and drag/drop slices never carry Annotation Mark or `annotationId` to another position.
- The edit-page Annotation Sidebar is read-only: activate, locate, read the root, and read replies only. Reply, delete, remove, and moderation controls remain unavailable there.
- Destructive Chinese IME uses the approved safety mode: block the first composition, ask once, restore the exact selection, then authorize a fresh re-entry against the same document state; never replay operating-system candidate text.
- Confirmed deletion IDs exist only in the local editor session/draft until Save. Discarding the draft must leave server Markdown and threads unchanged.
- The server is authoritative: parse canonical Markdown, validate structure and ownership, compute `retained`/`removed`/`unexpected`, require every removed ID to be confirmed, and require the base revision and annotation state to still be current.
- Post-author anchor retirement is distinct from annotation-author deletion. Retired threads leave the current post without placeholders but remain revision-restorable.
- A conflict interval containing any Annotation creation, removal, lifecycle change, or anchor-state change forbids ordinary force overwrite. The local draft survives and the user must reload the online version and reapply edits.
- `last_activity_at` does not change for post body edits. `edited_at` changes only for a successfully committed body/title edit. Metadata-only saves preserve existing V3 semantics.
- Use one `db.batch()` for every formal save relation. Do not update the post first and retire threads asynchronously.
- Respect focus safety, `aria-busy`, live status text, contrast, keyboard order, Escape cancellation, safe default focus, and `prefers-reduced-motion`.
- Do not add cross-block, overlapping, nested, image, or table annotations; collaboration; mentions; reactions; social graph; messaging; export; realtime; or notifications outside the approved V6 scope.
- Each implementation task follows RED → observe expected failure → minimum GREEN → focused regression → `git diff --check` → commit → push to `origin/feature/v6-annotation-guard`.
- Use a short-lived Sites source credential for each push; never persist credentials in remotes, files, profiles, or Git configuration.
- Keep the Site owner-only and do not change the existing URL or social-preview assets.

## File and Module Map

- `lib/annotations/invariants.ts`: canonical Markdown anchor scan and validation shared by server save and restore.
- `lib/annotations/save-plan.ts`: pure annotation delta, confirmation, retirement, and conflict-transition planning.
- `lib/editor/annotation-ranges.ts`: ProseMirror document range scan, grapheme endpoint descriptors, and supported-block checks.
- `lib/editor/annotation-guard.ts`: pure `inspectAnnotationTransaction(beforeDoc, transaction)` classifier.
- `lib/editor/annotation-guard-plugin.ts`: editor plugin/controller for pending impact, confirmation, composite execution, stale checks, history authorization, IME authorization, and callbacks.
- `lib/editor/annotation-clipboard.ts`: recursive Slice sanitization for copy, paste, cut, and drag/drop.
- `lib/editor/annotation-session.ts`: deterministic confirmed-removal set and replay/authorization helpers.
- `lib/annotations/selection-preview.ts`: saved selection descriptor plus DOM Range/CSS Custom Highlight lifecycle.
- `components/editor/annotation-guard-dialog.tsx`: one accessible multi-Annotation destructive confirmation dialog.
- `components/editor/annotated-editor-layout.tsx`: editor plus read-only live Annotation Sidebar/sheet.
- `components/annotations/annotation-readonly-thread.tsx`: reuse wrapper that exposes no mutation controls.
- `components/loading/route-progress.tsx`: root Vinext navigation progress bridge.
- `components/loading/skeletons.tsx`: shared route and section skeleton primitives.
- `components/pending/pending-submit-button.tsx`: shared immediate mutation pending button/status behavior.
- `db/schema.ts` and `drizzle/0006_mushy_smasher.sql`: anchor-retirement lifecycle columns and indexes/checks.
- `lib/posts/service.ts`: authoritative annotated save transaction and conflict enforcement.
- `lib/revisions/service.ts`: controlled restore of current anchors and retirement lifecycle.
- `lib/drafts/indexed-db.ts`: optional `confirmedAnnotationDeletionIds` persistence.

---

### Task 1: Define Canonical Annotation Invariants and Markdown Validation

**Files:**

- Create: `lib/annotations/invariants.ts`
- Modify: `lib/annotations/markdown.ts`
- Modify: `lib/annotations/policy.ts`
- Create: `tests/annotation-invariants.test.ts`

**Interfaces:**

- Produces `scanCanonicalAnnotationAnchors(markdown): CanonicalAnnotationAnchor[]`.
- Produces `validateCanonicalAnnotationDocument(markdown, knownIds): AnnotationDocumentValidation`.
- Produces stable issue codes `DUPLICATE`, `EMPTY`, `MULTI_BLOCK`, `OVERLAP`, `NESTED`, `UNKNOWN_ID`, and `MISSING_ACTIVE_ID`.
- Uses the existing Annotation directive/Mark parser rather than a second Markdown grammar.

- [x] **Step 1: Write failing canonical-invariant tests**

Add table-driven cases for one anchor, adjacent anchors, duplicate ID, empty content, cross-block content, overlap/nesting input, unknown IDs, and missing active IDs. Include this exact success/failure contract:

```ts
test("validates one active continuous anchor", () => {
  const result = validateCanonicalAnnotationDocument(
    "正文 :annotation[我喜欢你]{#ann-a}",
    new Set(["ann-a"]),
  );
  assert.deepEqual(result, {
    ok: true,
    anchors: [{ annotationId: "ann-a", text: "我喜欢你", blockIndex: 0 }],
    issues: [],
  });
});

test("rejects one annotation ID at two anchors", () => {
  const result = validateCanonicalAnnotationDocument(
    ":annotation[A]{#ann-a} 和 :annotation[B]{#ann-a}",
    new Set(["ann-a"]),
  );
  assert.equal(result.ok, false);
  assert.equal(result.issues[0]?.code, "DUPLICATE");
});
```

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/annotation-invariants.test.ts`

Expected: FAIL because `lib/annotations/invariants.ts` does not exist.

- [x] **Step 3: Implement the minimum canonical scanner and validator**

Reuse the existing remark extension to walk block children in source order. Return one immutable descriptor per Annotation and one deterministic issue list sorted by block and source position. Keep parsing and validation pure; do not access D1 or React.

- [x] **Step 4: Run GREEN and focused regression**

Run:

```bash
npm run test:unit -- tests/annotation-invariants.test.ts tests/annotation-roundtrip.test.ts tests/annotation-selection.test.ts tests/markdown.test.ts tests/docx-import-comments.test.ts
```

Expected: all pass; DOCX-generated adjacent annotations remain valid.

- [x] **Step 5: Commit and push**

Run `git diff --check`, commit as `feat: validate annotation document invariants`, and push the V6 branch.

---

### Task 2: Add Anchor-Retirement Lifecycle and Restore Planning

**Files:**

- Modify: `db/schema.ts`
- Create: `drizzle/0006_mushy_smasher.sql`
- Modify: `drizzle/meta/_journal.json`
- Create: `drizzle/meta/0006_snapshot.json`
- Create: `lib/annotations/save-plan.ts`
- Modify: `lib/annotations/queries.ts`
- Modify: `lib/revisions/save-plan.ts`
- Modify: `lib/revisions/service.ts`
- Create: `tests/annotation-guard-migration.test.ts`
- Create: `tests/annotation-save-plan.test.ts`
- Modify: `tests/annotation-revision.test.ts`

**Interfaces:**

- Adds nullable `anchorRetiredAt`, `anchorRetiredByUserId`, and `anchorRetiredReason` (`POST_EDIT` or `REVISION_RESTORE`) to `annotations`.
- Produces `computeAnnotationDelta(baseIds, submittedIds)` returning sorted `retained`, `removed`, and `unexpected` arrays.
- Produces `planAnnotationRetirement(...)` and `planAnnotationRestore(...)` without database access.
- Current thread queries exclude retired roots because `post_annotation_anchors` remains the current-membership relation; admin/history queries continue to see durable threads.

- [x] **Step 1: Write failing migration and lifecycle tests**

Assert migration SQL has all three columns, a reason check, and no destructive table replacement. Test exact delta behavior:

```ts
test("computes retained, removed, and unexpected annotation IDs", () => {
  assert.deepEqual(computeAnnotationDelta(["a", "b"], ["b", "c"]), {
    retained: ["b"],
    removed: ["a"],
    unexpected: ["c"],
  });
});
```

Test that post-edit retirement does not populate `deletedAt`, and revision restore clears retirement for restored anchors while retiring anchors leaving the current revision with `REVISION_RESTORE`.

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/annotation-guard-migration.test.ts tests/annotation-save-plan.test.ts tests/annotation-revision.test.ts`

Expected: FAIL on missing retirement fields and save-plan exports.

- [x] **Step 3: Generate and inspect the migration**

Modify `db/schema.ts`, run `npm run db:generate`, then inspect the generated SQL and Drizzle snapshot. The migration must add only the approved lifecycle fields/check/index support and preserve existing rows.

- [x] **Step 4: Implement pure lifecycle planning and controlled restore**

Update restore batching so source anchors clear retirement fields, exiting anchors receive retirement fields, source annotation/reply snapshot state is restored, and `post_annotation_anchors` exactly matches the restored revision. Restore bypasses the editor guard but still runs canonical server validation.

- [x] **Step 5: Run GREEN and focused regression**

Run:

```bash
npm run test:unit -- tests/annotation-guard-migration.test.ts tests/annotation-save-plan.test.ts tests/annotation-revision.test.ts tests/revision-policy.test.ts tests/revision-save-plan.test.ts tests/revision-migration.test.ts tests/annotation-lifecycle.test.ts
```

Expected: all pass; annotation-author deletion semantics and imported-thread lifecycle remain unchanged.

- [x] **Step 6: Commit and push**

Run `git diff --check`, commit as `feat: model annotation anchor retirement`, and push the V6 branch.

---

### Task 3: Make Annotated Post Save Atomic and Server-Authoritative

**Files:**

- Modify: `lib/posts/service.ts`
- Modify: `lib/posts/save-transaction.ts`
- Modify: `lib/annotations/save-plan.ts`
- Modify: `lib/annotations/queries.ts`
- Modify: `app/(site)/posts/[id]/actions.ts`
- Modify: `lib/editor/conflict.ts`
- Create: `tests/annotation-save-transaction.test.ts`
- Modify: `tests/post-save-transaction.test.ts`
- Modify: `tests/editor-conflict.test.ts`
- Modify: `tests/annotation-edit-lock.test.ts`

**Interfaces:**

- Extends update input with `confirmedAnnotationDeletionIds?: string[]`.
- Produces `AnnotationIntegrityError` with public code `ANNOTATION_INTEGRITY_ERROR`.
- Extends `EditConflictSnapshot` with `annotationStateChanged: boolean` and `forceOverwriteAllowed: boolean`.
- Preserves the service-level V5 lock behind a temporary internal feature gate until Task 10.

- [x] **Step 1: Write failing save-delta and transaction tests**

Cover retained internal edits, confirmed removal, unconfirmed removal, unknown submitted IDs, stale base revision, annotation-state transition during the conflict interval, metadata-only save, D1 batch failure, and unchanged `lastActivityAt`/`originalSelectedText`.

```ts
test("rejects an anchor loss the client did not confirm", () => {
  assert.throws(
    () => assertConfirmedAnnotationRemovals(["ann-a"], []),
    (error: unknown) =>
      error instanceof AnnotationIntegrityError && error.code === "ANNOTATION_INTEGRITY_ERROR",
  );
});
```

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/annotation-save-transaction.test.ts tests/post-save-transaction.test.ts tests/editor-conflict.test.ts`

Expected: FAIL on missing annotated-save API and conflict fields.

- [x] **Step 3: Implement the authoritative save planner**

Before creating batch operations:

1. Resolve and verify the submitted base revision.
2. Parse submitted Markdown and validate canonical invariants.
3. Query current anchor IDs and verify all submitted IDs belong to this post.
4. Compute the delta and reject `unexpected` IDs.
5. Require `actualRemoved` to be a subset of normalized confirmed IDs and reject confirmed IDs outside the current base.
6. Detect annotation transitions since the base revision and set force-overwrite policy.
7. Preserve `original_selected_text` for retained anchors.

- [x] **Step 4: Build one guarded D1 batch**

The batch order must be: CAS sentinel → new post revision → post Markdown/title/search/current revision/edited timestamp → current anchor deletes/inserts → retirement patches → revision Annotation/imported-reply snapshots → asset refs → tags. Use the existing save-transaction abstraction. Any guarded row miss or post-batch revision mismatch returns conflict without claiming success.

- [x] **Step 5: Wire action input and safe conflict UI data**

Parse `confirmedAnnotationDeletionIds` as a JSON string array, normalize/dedupe it, and return typed integrity/conflict states. Never expose stack traces. When `forceOverwriteAllowed` is false, omit the overwrite action and explain that annotation state changed while preserving the local draft.

- [x] **Step 6: Run GREEN and focused regression**

Run:

```bash
npm run test:unit -- tests/annotation-save-transaction.test.ts tests/post-save-transaction.test.ts tests/editor-conflict.test.ts tests/annotation-edit-lock.test.ts tests/revision-save-plan.test.ts tests/asset-lifecycle.test.ts tests/domain-rules.test.ts
```

Expected: all pass while the public edit page remains locked for annotated posts.

- [x] **Step 7: Commit and push**

Run `git diff --check`, commit as `feat: save annotated posts atomically`, and push the V6 branch.

---

### Task 4: Build the Pure ProseMirror AnnotationGuard Inspector

**Files:**

- Create: `lib/editor/annotation-ranges.ts`
- Create: `lib/editor/annotation-guard.ts`
- Create: `tests/annotation-guard-inspector.test.ts`

**Interfaces:**

- Produces `scanAnnotationRanges(doc): EditorAnnotationRange[]` with `annotationId`, `from`, `to`, `blockFrom`, `blockTo`, `blockType`, `text`, `firstEndpoint`, and `lastEndpoint`.
- Produces `inspectAnnotationTransaction(beforeDoc, transaction): AnnotationGuardResult`.
- Returns `{ kind: "SAFE" }` or `{ kind: "ANNOTATION_IMPACT", affectedAnnotationIds, reasons, destructive: true }`.
- Uses `Intl.Segmenter("zh-CN", { granularity: "grapheme" })` with a code-point fallback.

- [x] **Step 1: Add a real ProseMirror test builder**

Use the existing Milkdown schema/Annotation Mark to construct documents and transactions, not hand-authored fake position objects. Add helpers that place a cursor or selection by marker syntax only in tests.

- [x] **Step 2: Write the failing core matrix**

Cover:

- internal insert and delete;
- internal selection deletion/replacement;
- left external Delete and first-character Backspace;
- right external Backspace and last-character Delete;
- one-character anchor deletion;
- whole-anchor and multi-anchor selection replacement;
- Enter/split, block join, paragraph deletion, list wrap, indent/outdent;
- paragraph/heading conversion that preserves one legal block;
- bold/italic/strike/link/remove-link across boundaries;
- adjacent non-overlapping annotations;
- duplicate, overlap, nested, zero-length, unsupported block, and multi-block final documents.

```ts
test("aggregates two destroyed annotations into one impact", () => {
  const { state, tr } = replaceMarkedSelection(
    ":annotation[AAA]{#a} xxxx :annotation[BBB]{#b}",
    "replacement",
  );
  assert.deepEqual(inspectAnnotationTransaction(state.doc, tr), {
    kind: "ANNOTATION_IMPACT",
    affectedAnnotationIds: ["a", "b"],
    destructive: true,
    reasons: [
      { annotationId: "a", code: "REMOVED" },
      { annotationId: "b", code: "REMOVED" },
    ],
  });
});
```

- [x] **Step 3: Run RED**

Run: `npm run test:unit -- tests/annotation-guard-inspector.test.ts`

Expected: FAIL because the range scanner and inspector do not exist.

- [x] **Step 4: Implement range comparison, not input-key branching**

For every `docChanged` transaction, scan before/after descriptors and classify by final structure plus protected-endpoint survival. Match retained anchors by ID and mapped endpoint content/positions. Report stable issue codes: `LEFT_ENDPOINT_REMOVED`, `RIGHT_ENDPOINT_REMOVED`, `EMPTY`, `REMOVED`, `MULTI_BLOCK`, `DUPLICATE`, `OVERLAP`, `NESTED`, and `INVALID_BLOCK`. Return SAFE for non-document changes and mark-only formatting transactions.

- [x] **Step 5: Run GREEN and focused performance checks**

Run:

```bash
npm run test:unit -- tests/annotation-guard-inspector.test.ts tests/annotation-roundtrip.test.ts
```

Expected: the matrix passes. A 50,000-character synthetic document with 200 legal anchors inspects one local text transaction without an O(N²) pairwise connector/layout loop.

- [x] **Step 6: Commit and push**

Run `git diff --check`, commit as `feat: inspect annotation editor transactions`, and push the V6 branch.

---

### Task 5: Integrate Guard Confirmation, History, Clipboard, Drag/Drop, and IME

**Files:**

- Create: `lib/editor/annotation-session.ts`
- Create: `lib/editor/annotation-clipboard.ts`
- Create: `lib/editor/annotation-guard-plugin.ts`
- Create: `components/editor/annotation-guard-dialog.tsx`
- Modify: `components/editor/markdown-editor.tsx`
- Modify: `components/editor/post-editor-form.tsx`
- Modify: `lib/drafts/indexed-db.ts`
- Create: `tests/annotation-guard-session.test.ts`
- Create: `tests/annotation-clipboard.test.ts`
- Create: `tests/annotation-ime.test.ts`
- Modify: `tests/draft-indexed-db.test.ts`
- Modify: `app/globals.css`

**Interfaces:**

- `annotationGuardPlugin(options)` emits one pending impact and blocks unsafe transactions.
- `confirmPendingAnnotationImpact(token)` revalidates document hash, epoch, selection, step signature, and affected IDs before composite execution.
- `stripAnnotationMarksFromSlice(slice, annotationMarkType)` recursively removes only Annotation Marks.
- `confirmedAnnotationDeletionIds` is derived from the current editor document and confirmed history state, persisted in IndexedDB, and submitted as JSON.

- [x] **Step 1: Write failing session/history tests**

Test confirm/cancel, stale confirmation, multiple IDs, Undo restoring text/Mark/ID, Redo removing them without a second prompt, Undo before Save removing pending IDs, Redo re-adding them, and discard clearing all local pending state.

- [x] **Step 2: Write failing clipboard and drag/drop tests**

Assert rich formatting remains but Annotation Marks disappear on copied and pasted Slices. Test two copied adjacent anchors pasted into plain text produce no duplicate IDs. Test paste inside an existing anchor inherits the destination mark through ProseMirror stored-mark semantics. Test move-drop source deletion goes through the same impact confirmation.

- [x] **Step 3: Write failing IME state-machine tests**

Model `compositionstart`, internal composition, destructive boundary composition, cancel, fresh authorized re-entry, state change before re-entry, and Undo. Assert no dialog appears during intermediate composition updates and no operating-system candidate text is replayed.

- [x] **Step 4: Run RED**

Run:

```bash
npm run test:unit -- tests/annotation-guard-session.test.ts tests/annotation-clipboard.test.ts tests/annotation-ime.test.ts tests/draft-indexed-db.test.ts
```

Expected: FAIL on missing plugin/session/clipboard interfaces and draft field.

- [x] **Step 5: Implement one composite history operation**

When confirmed, start from the original transaction's current compatible state, remove all affected Annotation Marks, map and append the original steps, set one `addToHistory` event, and attach guard metadata. Recompute confirmed IDs from the resulting current anchor set instead of mutating D1. Store a bounded confirmed transition signature so ProseMirror Redo is accepted without a dialog only for the exact known before/after pair.

- [x] **Step 6: Integrate clipboard and drag/drop props**

Use ProseMirror `transformCopied`, `transformPasted`, and controlled drop/cut handling. Preserve text, bold, italic, strike, and link marks. Sanitize internal editor Slices and DOM clipboard HTML. Copy remains non-destructive; Cut writes the sanitized clipboard only after the destructive edit is allowed.

- [x] **Step 7: Integrate safe IME and the accessible dialog**

During composition, allow legal internal changes. For a destructive selection, prevent the first replacement, end/cancel the pending browser composition safely, open one dialog with root author/excerpt/reply counts, default focus the Cancel button, make Escape cancel, and require a fresh composition after exact-state authorization. Do not bind Enter to the destructive action.

- [x] **Step 8: Persist local pending state and run GREEN**

Extend `LocalDraft` with optional normalized `confirmedAnnotationDeletionIds`. Preserve it across autosave, recovery, conflict, and server failure; clear it on successful Save or explicit discard.

Run:

```bash
npm run test:unit -- tests/annotation-guard-session.test.ts tests/annotation-clipboard.test.ts tests/annotation-ime.test.ts tests/draft-indexed-db.test.ts tests/modal-stack.test.ts tests/editor-lifecycle.test.ts
```

Expected: all deterministic tests pass. Record browser automation coverage separately from true Windows/macOS IME hardware acceptance.

- [x] **Step 9: Commit and push**

Run `git diff --check`, commit as `feat: protect annotation editing interactions`, and push the V6 branch.

---

### Task 6: Add the Read-Only Live Annotation Sidebar to the Editor

**Files:**

- Create: `components/editor/annotated-editor-layout.tsx`
- Create: `components/annotations/annotation-readonly-thread.tsx`
- Modify: `components/annotations/annotation-reading-layout.tsx`
- Modify: `components/annotations/annotation-sheet.tsx`
- Modify: `components/annotations/annotation-thread.tsx`
- Modify: `components/editor/post-editor-form.tsx`
- Modify: `components/editor/markdown-editor.tsx`
- Modify: `app/(site)/posts/[id]/edit/page.tsx`
- Modify: `lib/annotations/layout.ts`
- Create: `tests/annotation-editor-sidebar.test.ts`
- Modify: `tests/annotation-layout.test.ts`
- Modify: `tests/annotation-sheet.test.ts`
- Modify: `app/globals.css`

**Interfaces:**

- Editor exposes current anchor rectangles and active Annotation ID from the live ProseMirror document.
- `AnnotationReadonlyThread` renders root/replies without mutation controls.
- Confirmed local retirement hides the current card/connector; Undo restores both.
- Mobile uses the existing bottom-sheet mechanism in read-only mode.

- [x] **Step 1: Write failing read-only and live-layout tests**

Assert edit mode contains no Reply/Delete/Remove/Admin controls, still supports activation/location, hides pending-retired threads, restores them after Undo, and schedules connector measurement through one animation frame/observer pass rather than reparsing Markdown or refetching threads per keystroke.

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/annotation-editor-sidebar.test.ts tests/annotation-layout.test.ts tests/annotation-sheet.test.ts`

Expected: FAIL because no annotated editor layout exists.

- [x] **Step 3: Reuse reader thread data and rendering**

Load current threads once on the edit route. Pass immutable discussion data to the client editor layout. Read anchor positions from the editor document and existing `data-annotation-id` DOM mapping. Keep the current active-card behavior and use requestAnimationFrame, ResizeObserver, and the existing connector planner for layout updates.

- [x] **Step 4: Add desktop Sidebar and mobile sheet**

Desktop keeps the editor as the main column and a read-only Annotation rail as the secondary column. Mobile exposes the existing sheet with read-only thread cards. Show a compact pending-removal count in the edit UI and preserve current context while typing.

- [x] **Step 5: Run GREEN and focused regression**

Run:

```bash
npm run test:unit -- tests/annotation-editor-sidebar.test.ts tests/annotation-layout.test.ts tests/annotation-sheet.test.ts tests/annotation-replies.test.ts tests/annotation-roundtrip.test.ts
```

Expected: all pass; no editor test observes a network request or Markdown reparse for every local keystroke.

- [x] **Step 6: Commit and push**

Run `git diff --check`, commit as `feat: show read-only annotations while editing`, and push the V6 branch.

---

### Task 7: Preserve Annotation Selection Preview and Move the Shared Reply Composer

**Files:**

- Create: `lib/annotations/selection-preview.ts`
- Modify: `components/annotations/annotation-reading-layout.tsx`
- Modify: `components/annotations/annotation-thread.tsx`
- Modify: `components/annotations/annotation-reply-form.tsx`
- Modify: `lib/annotations/dom-selection.ts`
- Create: `tests/annotation-selection-preview.test.ts`
- Modify: `tests/annotation-dom-selection.test.ts`
- Modify: `tests/annotation-replies.test.ts`
- Modify: `app/globals.css`

**Interfaces:**

- Saved selection contains post ID, base revision ID, selected text, canonical block/path descriptor, serialized DOM Range endpoints, and a validity epoch.
- CSS Custom Highlight API is preferred; an overlay made from `Range.getClientRects()` is the fallback.
- One root reply composer sits immediately after root content and before the replies list; reply-to-reply actions retarget that same composer.

- [x] **Step 1: Write failing preview-lifecycle tests**

Cover Bubble open, composer focus, pending, failure/retry, success, cancel, body click, invalidation, revision change, and unmount. Assert the saved selection—not a newly read DOM Selection—is authoritative for create submission.

- [x] **Step 2: Write failing reply-structure tests**

Assert rendered order is root metadata → root body → Reply CTA/shared composer → reply count/list. With 100 replies, the root CTA is still before reply 1. Clicking reply 37 changes the single composer label to `回复 林柚子`; success clears only after the action succeeds, while failure preserves text.

- [x] **Step 3: Run RED**

Run:

```bash
npm run test:unit -- tests/annotation-selection-preview.test.ts tests/annotation-dom-selection.test.ts tests/annotation-replies.test.ts
```

Expected: FAIL on missing selection preview and current nested/bottom composers.

- [x] **Step 4: Implement stable preview decoration**

Capture and validate the range before showing the Bubble. Paint it independently of native focus. Keep it through composer and pending/failure. On cancel, remove the preview then restore the selection/focus only if the document/revision/range still validates. On success, remove the preview after the new Annotation range and Sidebar state are present.

- [x] **Step 5: Refactor to one thread composer**

Move root Reply CTA and composer above the list. Store one reply target in thread state. Per-reply buttons set that target and focus the shared composer; they never instantiate nested composers. Keep input until successful action resolution and prevent duplicate submission while pending.

- [x] **Step 6: Run GREEN and focused regression**

Run:

```bash
npm run test:unit -- tests/annotation-selection-preview.test.ts tests/annotation-dom-selection.test.ts tests/annotation-replies.test.ts tests/annotation-create.test.ts tests/modal-stack.test.ts
```

Expected: all pass; failed Annotation create preserves both composer text and visible selection preview.

- [x] **Step 7: Commit and push**

Run `git diff --check`, commit as `fix: preserve annotation context while composing`, and push the V6 branch.

---

### Task 8: Add Global Route Loading, Segment Skeletons, and Error Boundaries

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `components/loading/route-progress.tsx`
- Create: `components/loading/skeletons.tsx`
- Modify: `app/layout.tsx`
- Create: `app/error.tsx`
- Create: `app/global-error.tsx`
- Create: `app/not-found.tsx`
- Create: `app/(site)/error.tsx`
- Create: `app/(site)/loading.tsx`
- Create: `app/(site)/posts/[id]/loading.tsx`
- Create: `app/(site)/users/[id]/loading.tsx`
- Create: `app/(site)/notifications/loading.tsx`
- Create: `app/(site)/search/loading.tsx`
- Create: `app/(site)/admin/loading.tsx`
- Create: `app/(site)/admin/revisions/[postId]/loading.tsx`
- Create: `app/(site)/tags/[name]/loading.tsx`
- Modify: `app/(site)/posts/[id]/page.tsx`
- Modify: `app/(site)/notifications/page.tsx`
- Modify: `app/(site)/users/[id]/page.tsx`
- Modify: `app/(site)/admin/page.tsx`
- Modify: `app/globals.css`
- Create: `tests/loading-ui.test.ts`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**

- Uses Vinext's instrumentation hook and navigation promise bridge; no third-party trickle loader.
- Top bar is 2px, uses the existing accent token, never blocks interaction, follows real navigation
  response/settle phases, and respects reduced motion.
- Shared skeletons approximate post list, post detail, profile/activity, notifications, search, admin list, tags, revisions, and Annotation Sidebar structures.

- [x] **Step 1: Write failing static/loading tests**

Assert every approved route segment exports a skeleton layout, all error boundaries expose Retry and Home where valid, errors contain no stack renderer, progress is non-blocking, and reduced-motion CSS disables shimmer/highlight/scroll animation.

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/loading-ui.test.ts`

Expected: FAIL because loading/error files and shared components do not exist.

- [x] **Step 3: Run the Vinext navigation progress compatibility gate**

Add `RouteProgress` to the root layout through Vinext's `onRouterTransitionStart` and
`__VINEXT_RSC_NAVIGATE__` promise bridge, then run `npm run build` and verify normal, query,
router.push, and hash-only navigation. The bridge must never rely on a fixed trickle timer or
history monkey patch; failed, cancelled, repeated, and unloaded navigations must reset through
their promise, error, and watchdog paths.

- [x] **Step 4: Add segment skeletons and targeted Suspense**

Keep shared layout/header interactive. Add Suspense boundaries only around independent data regions: post body/Annotation rail, reply list, notification list, user activity, admin lists, and revision preview. Use stable dimensions and delayed shimmer so very fast loads do not flash.

- [x] **Step 5: Add global and site error states**

Provide Retry, Home, and dedicated access/session copy. `global-error.tsx` renders its own `<html>`/`<body>`. Do not include raw error messages, stack traces, D1 details, or request internals.

- [x] **Step 6: Run GREEN and compatibility regression**

Run:

```bash
npm run test:unit -- tests/loading-ui.test.ts
npm run build
node --test tests/rendered-html.test.mjs
```

Expected: all pass; page navigation and hash navigation finish without a persistent progress bar.

Compatibility note: the native bridge passed TypeScript and the full Vinext production build. It uses
Vinext's `onRouterTransitionStart`, RSC response headers, and navigation promise; hash-only navigation
is excluded before a progress token is created. The local preview service was healthy, but the
cloud-browser channel rejected the preview address, so browser navigation could not be exercised in
that earlier environment.

- [x] **Step 7: Commit and push**

Run `git diff --check`, commit as `feat: add route loading and error feedback`, and push the V6 branch.

---

### Task 9: Complete Immediate Mutation Pending States

**Files:**

- Create: `components/pending/pending-submit-button.tsx`
- Modify: `components/editor/post-editor-form.tsx`
- Modify: `components/annotations/annotation-reading-layout.tsx`
- Modify: `components/annotations/annotation-reply-form.tsx`
- Modify: `components/reply-form.tsx`
- Modify: `components/lifecycle/delete-content-control.tsx`
- Modify: `components/admin/content-lifecycle-control.tsx`
- Modify: `components/admin/restore-revision-form.tsx`
- Modify: `components/notification-list.tsx`
- Modify: `app/(site)/settings/profile/page.tsx`
- Create: `components/profile/profile-form.tsx`
- Modify: `components/editor/markdown-editor.tsx`
- Modify: `components/docx-import/docx-import-workspace.tsx`
- Modify: `app/globals.css`
- Create: `tests/mutation-pending.test.ts`

**Interfaces:**

- Every named mutation changes visible state in the same event turn, disables duplicate submission, preserves composer content until success, and exposes `aria-busy`/status text.
- Image/attachment upload reports real byte progress where the endpoint supports it; DOCX retains Parsing/Extracting images/Building preview/Uploading assets/Ready stages and only adopts shared visual tokens.

- [x] **Step 1: Write failing pending-state coverage tests**

Cover Publish, Save, Annotation create, Post Reply, Annotation Reply, delete, admin hide/restore, revision restore, mark-all-notifications-read, Profile save, image upload, attachment upload, and DOCX import. Assert mutation content is cleared only on success and preserved on failure.

- [x] **Step 2: Run RED**

Run: `npm run test:unit -- tests/mutation-pending.test.ts`

Expected: FAIL for Profile, mark-all-read, and upload feedback gaps.

- [x] **Step 3: Add the shared pending primitive and fill gaps**

Reuse existing `useActionState` pending implementations where already correct. Add the shared button only where it removes duplication. Convert Profile and mark-all-read to client wrappers with immediate labels. Add upload progress without replacing the existing server endpoint or DOCX pipeline. Keep ordinary mutations inline; do not add a full-screen spinner.

- [x] **Step 4: Run GREEN and focused regression**

Run:

```bash
npm run test:unit -- tests/mutation-pending.test.ts tests/annotation-create.test.ts tests/annotation-replies.test.ts tests/editor-lifecycle.test.ts tests/docx-import-e2e.test.ts tests/docx-worker.test.ts
```

Expected: all pass; failure retains typed post/annotation reply and Annotation composer content.

- [x] **Step 5: Commit and push**

Run `git diff --check`, commit as `feat: finish immediate mutation feedback`, and push the V6 branch.

---

### Task 10: Unlock Annotated Editing, Run the Full Matrix, and Save the V6 Sites Version

**Files:**

- Modify: `app/(site)/posts/[id]/edit/page.tsx`
- Modify: `lib/posts/service.ts`
- Modify: `lib/annotations/policy.ts`
- Modify: `tests/annotation-edit-lock.test.ts`
- Create: `tests/annotation-guard-integration.test.ts`
- Create: `docs/v6-annotation-guard-report.md`
- Modify: `README.md`

**Interfaces:**

- Removes the V5 UI and service edit lock only after all earlier tests pass.
- Annotated edit route loads current threads, base revision identity, and the read-only edit Sidebar.
- Final report records automated evidence and explicitly labels unavailable true-device IME checks as pending manual acceptance.

- [x] **Step 1: Prove the pre-unlock gate**

Run all focused V6 tests from Tasks 1–9 plus:

```bash
npm run lint
npm run build
```

Expected: all pass with the edit lock still present. If any test fails, do not remove the lock.

- [x] **Step 2: Replace lock tests with annotated-edit integration tests**

Require the route/service to accept an annotated author's valid internal edit, reject unconfirmed endpoint loss, accept confirmed loss atomically, preserve draft state on conflict/failure, forbid force overwrite after annotation-state change, and retain ordinary unannotated edit behavior.

- [x] **Step 3: Run RED for the final unlock**

Run:

```bash
npm run test:unit -- tests/annotation-edit-lock.test.ts tests/annotation-guard-integration.test.ts
```

Expected: FAIL because the V5 UI/service guard still blocks annotated editing.

- [x] **Step 4: Remove only the temporary V5 restrictions**

Delete the annotated-post early return in the edit page and the matching service rejection. Keep all AnnotationGuard, server invariant, confirmation, conflict, ownership, and base-revision checks. Do not weaken `assertOrdinaryPostMarkdown` for new unannotated posts; use the new annotated-save validator only on the controlled update path.

- [x] **Step 5: Run the complete automated regression**

Run:

```bash
npm run test:unit -- \
  tests/annotation-invariants.test.ts \
  tests/annotation-save-plan.test.ts \
  tests/annotation-save-transaction.test.ts \
  tests/annotation-guard-inspector.test.ts \
  tests/annotation-guard-session.test.ts \
  tests/annotation-clipboard.test.ts \
  tests/annotation-ime.test.ts \
  tests/annotation-editor-sidebar.test.ts \
  tests/annotation-selection-preview.test.ts \
  tests/annotation-guard-integration.test.ts \
  tests/loading-ui.test.ts \
  tests/mutation-pending.test.ts
npm test
npm run lint
```

Expected: unit tests, production build, and rendered HTML tests pass. The existing explicit unsupported Word Online fixture may remain skipped only with its documented provenance and reason.

- [x] **Step 6: Run browser acceptance with development latency**

Start the Sites preview and verify desktop plus mobile widths for:

- internal insert/delete and formatting without dialogs;
- protected left/right/whole/multiple-anchor confirmation;
- Enter and structural invalidation;
- Copy/Paste/Cut/drag/drop mark stripping;
- Undo/Redo and Save/Reload;
- cancel/abandon draft;
- concurrent new Annotation conflict with no overwrite;
- visible selection preview through create pending/failure;
- read-only edit Sidebar/sheet and 100-reply root CTA position;
- route progress, segment skeletons, Save/create/reply/admin/profile/notification pending states;
- Retry/Home error screens, focus trap, keyboard order, reduced motion, and no persistent hash-navigation loader.

Expected: no 1–2 second silent interaction, no duplicated Annotation ID, no orphan current thread, no stale replay, and no destructive dialog for ordinary edits.

Execution note (2026-09-01): `sites-preview` reached healthy state, but the cloud browser rejected the exact internal preview address with `net::ERR_BLOCKED_BY_CLIENT`. Per the Sites preview troubleshooting contract, no alternate host/port was substituted. Browser acceptance therefore remains an explicitly reported environment limitation rather than a claimed pass; deterministic interaction contracts and the production build passed.

- [x] **Step 7: Record true-device IME limitation honestly**

Run browser-level composition-event automation and document results. If Windows Microsoft Pinyin and macOS native IME are unavailable in the execution environment, mark both as `待真机验收`; do not claim they passed. The edit lock may be removed only because deterministic transaction/composition safety tests pass and the approved safe mode prevents unconfirmed destructive composition.

- [x] **Step 8: Write the completion report**

`docs/v6-annotation-guard-report.md` must answer all 20 requested report items: architecture, inspector, non-keydown design, internal mark inheritance, endpoint and structural detection, multi-ID confirmation, clipboard, history, IME, local pending state, delta, server integrity, conflict, selection preview, reply placement, route progress, loading/Suspense coverage, mutation coverage, and known limitations. Include exact commands and observed counts.

- [ ] **Step 9: Commit, push, deploy, and verify**

Run `git diff --check`, commit as `feat: complete AnnotationGuard V6`, and push the V6 branch. Deploy one new owner-only Sites version from the verified commit, then verify build readiness, the existing Site URL, and access policy. Do not overwrite or delete the last stable deployed version.

## Plan Self-Review Gate

Before execution begins:

- [x] Every requirement in Spec sections 1–74 maps to at least one task or Global Constraint.
- [x] Every new interface has an owning file and a focused test.
- [x] The edit lock is removed only in Task 10 after explicit pre-unlock evidence.
- [x] No task mutates server Annotation lifecycle during local editing.
- [x] No clipboard or drag/drop path can create a second anchor for an existing ID.
- [x] Restore is controlled server work and bypasses the interactive guard without bypassing validation.
- [x] Force overwrite is disabled only when an Annotation transition occurred; V3 content-only conflict behavior remains available.
- [x] Edit Sidebar remains read-only on desktop and mobile.
- [x] Safe-mode IME never replays captured OS candidate text.
- [x] Route progress uses Vinext lifecycle hooks and has no click/history monkey-patch fallback.
- [x] True-device IME results are never inferred from synthetic tests.
- [x] The plan contains no placeholder implementation steps or unresolved product choices.
