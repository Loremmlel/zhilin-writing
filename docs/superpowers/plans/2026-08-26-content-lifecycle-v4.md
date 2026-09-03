# Content Lifecycle V4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reversible post/reply deletion, independent administrator hiding/restoration, safe placeholders, lifecycle-aware activity/notifications, and reference-safe asset cleanup.

**Architecture:** Extend the existing V3 tables and services rather than creating a parallel content system. A pure lifecycle policy module defines visibility, dependency, last-activity, audit-deduplication, and GC rules; server services apply those rules atomically, while ordinary and administrator read models expose different safe views.

**Tech Stack:** TypeScript, Next.js/Vinext server actions, Drizzle ORM, Cloudflare D1/R2, React 19, Node test runner.

**Spec:** `docs/superpowers/specs/2026-08-26-content-lifecycle-v4-design.md`

## Global Constraints

- Preserve V1–V3 routes, revisions, events, notifications, tags, profiles, and R2 objects.
- No Annotation, AnnotationGuard, DOCX import, free mentions, ordinary-user recycle bin, hard-delete UI, bulk moderation, email, or push work.
- Never expose deleted/hidden Markdown or withdrawn titles to ordinary users.
- Keep user delete and administrator hide as independent, simultaneously representable states.
- Every new server mutation is permission checked and idempotent.
- Lifecycle actions create no public Activity and never use the action timestamp for `last_activity_at`.

---

### Task 1: Lifecycle policy and migration contract

**Files:**

- Create: `lib/lifecycle/policy.ts`
- Create: `tests/lifecycle-policy.test.ts`
- Modify: `db/schema.ts`
- Create: `tests/lifecycle-migration.test.ts`
- Create: `drizzle/0003_*.sql` and matching Drizzle metadata

**Interfaces:**

- Produces: `contentState()`, `shouldRenderReplyPlaceholder()`, `isPostDiscussionReachable()`, `deriveLastActivityAt()`, `assetGcEligibility()`, and `adminAuditDedupeKey()`.
- Produces schema fields `deletedByUserId`, `hiddenByUserId`, `hiddenReason`, `replyToReplyId`, and table `adminAuditLog`.

- [ ] Write literal, table-driven failing tests for state priority, dependent placeholder retention, other-member discussion reachability, derived activity time, GC reference rules, and audit transition keys.
- [ ] Run `npm run test:unit -- tests/lifecycle-policy.test.ts` and confirm failures are caused by the missing lifecycle module.
- [ ] Implement the minimal pure policy module and rerun the targeted test to green.
- [ ] Write a migration test that applies V1–V4 migrations, verifies existing content survives, verifies new lifecycle fields/audit table, and checks deterministic legacy direct-target backfill.
- [ ] Run the migration test and confirm it fails before the migration exists.
- [ ] Extend the Drizzle schema, generate migration 0003, inspect every statement, add bounded backfill SQL, and rerun the migration test.

### Task 2: Lifecycle service, permissions, and last activity

**Files:**

- Create: `lib/lifecycle/service.ts`
- Modify: `lib/posts/service.ts`
- Modify: `lib/revisions/service.ts`
- Modify: `app/(site)/posts/[id]/actions.ts`
- Modify: `app/(site)/admin/actions.ts`
- Create: `tests/lifecycle-service-plan.test.ts`

**Interfaces:**

- Produces: `deletePostByAuthor`, `deleteReplyByAuthor`, `restorePostByAdmin`, `restoreReplyByAdmin`, `hidePostByAdmin`, `unhidePostByAdmin`, `hideReplyByAdmin`, and `unhideReplyByAdmin`.
- Consumes: pure policy functions from Task 1.

- [ ] Write failing service-plan tests for owner-only delete, independent restore/unhide state, no-op retries, direct reply target preservation, recomputed public activity time, and deterministic audit keys.
- [ ] Run the targeted tests and verify expected failures.
- [ ] Implement one guarded lifecycle service with conditional D1 updates and audit inserts using `onConflictDoNothing()`.
- [ ] Update reply creation to store `replyToReplyId` and reject new replies to unavailable posts/targets.
- [ ] Update revision restore to accept deleted posts, create the next revision, clear user-delete fields, preserve admin-hidden state, and write one administrator audit event.
- [ ] Rerun targeted and existing revision tests.

### Task 3: Safe ordinary/admin read models

**Files:**

- Modify: `db/queries.ts`
- Create: `lib/lifecycle/views.ts`
- Create: `tests/lifecycle-views.test.ts`
- Modify: `components/activity-list.tsx`
- Modify: `components/notification-list.tsx`
- Modify: `app/(site)/notifications/[id]/page.tsx`

**Interfaces:**

- Produces ordinary `PostDetailView`/`ReplyLifecycleView` values that never carry rendered unavailable Markdown.
- Produces admin content rows and bounded audit rows.

- [ ] Write failing read-model tests for deleted/hidden title and preview suppression, reachable discussion links, placeholder-only exclusion from counts, and status priority.
- [ ] Run tests and confirm missing view-policy failures.
- [ ] Add ordinary detail, reply-tree, activity/notification, tag-count, administrator content, and audit queries using server-owned filters.
- [ ] Update Activity and Notification copy/link behavior without deleting historical records.
- [ ] Rerun targeted tests and the V2 activity policy suite.

### Task 4: Asset access and isolated garbage collection

**Files:**

- Create: `lib/assets/access.ts`
- Create: `lib/assets/gc.ts`
- Modify: `lib/assets/storage.ts`
- Modify: `app/api/assets/[id]/route.ts`
- Create: `tests/asset-lifecycle.test.ts`

**Interfaces:**

- Produces `resolveAssetReadAccess(assetId, member)` and `collectEligibleAssetGarbage({ now, limit })`.
- Consumes current refs, revision refs, avatar refs, asset status/expiry, and post lifecycle state.

- [ ] Write failing tests for active current refs, revision-only refs, unavailable-post refs, avatar refs, expired temporary assets, and true permanent orphans.
- [ ] Run tests and verify failures precede implementation.
- [ ] Implement server-side asset access decisions; ordinary members cannot fetch revision-only or withdrawn post files.
- [ ] Implement a bounded GC candidate query and rechecked R2 deletion routine isolated from UI handlers.
- [ ] Rerun targeted tests and upload/revision asset tests.

### Task 5: Member lifecycle UI and placeholders

**Files:**

- Create: `components/lifecycle/post-delete-control.tsx`
- Create: `components/lifecycle/reply-delete-control.tsx`
- Modify: `components/reply-list.tsx`
- Modify: `app/(site)/posts/[id]/page.tsx`
- Modify: `app/globals.css`
- Modify: `UX-CONTRACT.md`
- Create: `tests/lifecycle-ui-contract.test.ts`

**Interfaces:**

- Consumes server actions and safe ordinary views.
- Produces app-owned confirmations, post/reply placeholders, and disabled discussion state for unavailable posts.

- [ ] Write failing UI-contract tests for the two required confirmation messages, author/admin placeholder copy, no unavailable Markdown rendering, and shared `ModalDialog` use.
- [ ] Run the targeted tests and confirm expected failures.
- [ ] Add post delete control and dependency-aware reply delete control with stable busy/error states.
- [ ] Render deleted/hidden posts and replies from safe lifecycle views, keeping surviving discussion and disabling new writes.
- [ ] Extend the existing校刊 visual grammar with restrained warning/hidden states; do not change global identity tokens.
- [ ] Update `UX-CONTRACT.md` with lifecycle behavior, permission outcomes, and asset access policy.

### Task 6: Administrator content management and audit

**Files:**

- Create: `components/admin/content-lifecycle-control.tsx`
- Modify: `app/(site)/admin/page.tsx`
- Modify: `app/(site)/admin/actions.ts`
- Modify: `app/(site)/admin/revisions/[postId]/page.tsx`
- Modify: `app/(site)/admin/revisions/[postId]/actions.ts`
- Modify: `app/globals.css`
- Modify: `tests/rendered-html.test.mjs`

**Interfaces:**

- Consumes administrator-only queries and lifecycle actions.
- Produces URL-addressable type/status filters, original-content inspection, restore/hide/unhide actions, and audit timeline.

- [ ] Add failing rendered-artifact checks for content filters, dual-state labels, restore/hide/unhide copy, and audit history.
- [ ] Run the rendered test against the prior build and verify it fails for missing V4 surfaces.
- [ ] Implement the compact admin content section with native links/buttons and shared modal confirmations.
- [ ] Allow revision history on unavailable posts and make revision restore reactivate only the user-delete state.
- [ ] Render bounded audit events with actor/action/target/time and safe metadata.

### Task 7: Final verification and private checkpoint

**Files:**

- Modify only files required to fix verification defects.

**Interfaces:**

- Produces a validated V4 source state and a new private Sites version.

- [ ] Run `npm run test:unit`, `npx tsc --noEmit`, `npm run lint`, and `npm test`; fix and rerun every failure.
- [ ] Run the DESIGN.md lint and `audit_project.py /workspace/sites/zhilin-writing --mode strict`; fix blocking findings.
- [ ] Search changed code for native dialogs, non-semantic click targets, unavailable-content leaks, hard-delete paths, duplicate lifecycle logic, and direct R2 deletion outside the GC service.
- [ ] Inspect the generated D1 migration and verify it is append-only, bounded, and preserves V1–V3 data.
- [ ] Re-read the V4 spec and map every acceptance requirement to code/tests; record real limits.
- [ ] Run the Sites checkpoint, keep the existing custom/owner-only access policy unchanged, verify terminal deployment status, and report the private URL.
