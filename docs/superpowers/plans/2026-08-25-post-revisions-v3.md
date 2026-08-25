# Post Revisions V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add stable post revisions, resource snapshots, optimistic edit conflict handling, administrator restore, and reliable account-menu dismissal to 知临中学.

**Architecture:** Extend the existing `createPost()`/`updatePost()` service boundary with immutable revision snapshots and D1-batched pointer/ref updates. Keep conflict and snapshot policy in focused modules, use IndexedDB only for local unpublished state, and protect all history queries/actions with the existing administrator authorization boundary.

**Tech Stack:** Next.js/Vinext, React 19, TypeScript, Drizzle ORM, Cloudflare D1/R2, IndexedDB, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-25-post-revisions-v3-design.md`

## Global Constraints

- Do not implement Annotation, AnnotationGuard, DOCX import, automatic merge, collaborative editing, or public version history.
- Tags-only saves create no revision and do not change `edited_at`.
- Editing and restore never change `last_activity_at`, create public activity, or send notifications.
- Only the sole administrator can list, read, preview, or restore revisions.
- R2 objects are shared; revisions store references and never duplicate bytes.
- Every production behavior starts with a failing automated test.

---

### Task 1: Revision and conflict policy

**Files:**
- Create: `tests/revision-policy.test.ts`
- Create: `lib/revisions/policy.ts`

**Interfaces:**
- Produces: `extractMarkdownAssetIds(markdown)`, `classifyPostChange(current, next)`, `resolveSaveBase(currentRevisionId, submittedBaseRevisionId, overwriteBaseRevisionId?)`, and `EditConflictError`.

- [ ] Write tests proving title/Markdown/inline/attachment changes are content changes, tags are ignored, Markdown asset IDs are stable/deduplicated, and stale bases produce `EDIT_CONFLICT`.
- [ ] Run `npm run test:unit -- tests/revision-policy.test.ts` and verify failure because the policy module is absent.
- [ ] Implement the smallest pure policy module satisfying the tests.
- [ ] Re-run the focused tests and all unit tests.

### Task 2: Revision schema and safe migration

**Files:**
- Modify: `db/schema.ts`
- Create: generated `drizzle/0002_*.sql` and snapshot metadata
- Create: `tests/revision-migration.test.ts`

**Interfaces:**
- Produces: `postRevisions`, `postAssetRefs`, `revisionAssetRefs`, and `posts.currentRevisionId`.

- [ ] Write a migration test that requires revision tables, deterministic existing-post backfill, current pointers, and asset-ref backfill.
- [ ] Run it and verify the migration is missing.
- [ ] Add the Drizzle schema, generate migration SQL, append safe `INSERT ... SELECT` backfill statements, and inspect foreign keys/indexes.
- [ ] Re-run migration and unit tests.

### Task 3: Transactional publish, edit, and restore services

**Files:**
- Create: `lib/revisions/service.ts`
- Modify: `lib/posts/service.ts`
- Modify: `db/queries.ts`
- Create: `tests/revision-service-policy.test.ts`

**Interfaces:**
- Produces: `listPostRevisions(postId)`, `getPostRevision(postId, revisionId)`, `restorePostRevision(postId, revisionId, administratorId)`, and revision-aware `createPost()`/`updatePost()`.

- [ ] Write tests for initial v1, one revision per content save, tags-only behavior, stale-base rejection, explicit overwrite as a new revision, restore as a new revision, asset retention, and unchanged activity timestamps.
- [ ] Run focused tests and verify expected failure.
- [ ] Implement snapshot assembly and D1 batch orchestration; keep `last_activity_at`, Activity, and Notification outside edit/restore mutations.
- [ ] Re-run focused and full unit tests.

### Task 4: Draft recovery and conflict UI

**Files:**
- Modify: `lib/drafts/indexed-db.ts`
- Create: `lib/editor/conflict.ts`
- Modify: `components/editor/post-editor-form.tsx`
- Modify: `app/(site)/posts/[id]/edit/page.tsx`
- Modify: `app/(site)/posts/[id]/actions.ts`
- Create: `tests/editor-conflict.test.ts`

**Interfaces:**
- Consumes: revision-aware `updatePost()` and `EditConflictError`.
- Produces: `PostActionState` conflict payload and explicit online/manual/overwrite flows.

- [ ] Write tests for draft/base persistence, stale conflict retention, online replacement, manual return, and explicit overwrite resubmission.
- [ ] Run focused tests and verify failure.
- [ ] Extend drafts with optional base revision, return structured conflicts from the server action, and build the accessible conflict/recovery surfaces without native `alert()`/`confirm()`.
- [ ] Re-run focused and full unit tests.

### Task 5: Administrator revision history and restore

**Files:**
- Modify: `app/(site)/admin/page.tsx`
- Create: `app/(site)/admin/revisions/[postId]/page.tsx`
- Create: `app/(site)/admin/revisions/[postId]/actions.ts`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**
- Consumes: administrator-only revision queries and `restorePostRevision()`.

- [ ] Add failing artifact assertions for the history list, rendered preview, restore confirmation, and administrator-only route boundary.
- [ ] Build the post history list, rendered historical Markdown/asset preview, current/restore badges, and app-owned restore confirmation.
- [ ] Run unit tests and production artifact tests.

### Task 6: Account-menu outside dismissal

**Files:**
- Create: `components/account-menu.tsx`
- Modify: `components/site-header.tsx`
- Create: `tests/account-menu.test.ts`

**Interfaces:**
- Produces: reusable `AccountMenu` client component with outside pointer/focus dismissal and Escape handling.

- [ ] Add a failing test that exercises the dismissal policy and verifies the interactive component contract.
- [ ] Implement the controlled menu while preserving existing links and styling.
- [ ] Run the focused test and all unit tests.

### Task 7: Full verification and private checkpoint deployment

**Files:**
- Modify or create: `DESIGN.md` only as required by the existing UI contract.

- [ ] Run Drizzle generation/inspection and confirm the migration preserves old rows.
- [ ] Run `npm test`, lint, the strict premium UI audit, DESIGN.md checks, and production checkpoint validation.
- [ ] Create the new Sites checkpoint using the existing custom private access policy.
- [ ] Verify terminal deployment status directly and inspect the live D1 schema/backfill with read-only Sites database tools.
- [ ] Report schema, asset references, transaction flow, optimistic lock, restore, annotation extension point, migration, and known limits.
