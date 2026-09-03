# Release Hardening V7 Implementation Plan

**Goal:** Finish the existing private writing Site for stable long-term use by fixing observed reliability, deep-link, upload, query, asset lifecycle, responsive, and accessibility gaps without adding a new product surface.

**Architecture:** Preserve the V6 annotation, editor, lifecycle, activity, notification, revision, DOCX, D1, and R2 models. Add small typed boundaries at the points that are currently ambiguous: one container-derived annotation layout mode, one notification target resolver, one action/API access result, one per-file upload task, one create-Post idempotency key, query-local D1 batching, and one claim/recheck/dry-run GC service. Use existing components and tokens; do not add generic frameworks.

**Tech Stack:** TypeScript 5.9, React 19, Next.js 16 App Router through Vinext, Milkdown/Crepe 7.22.1, Drizzle ORM, Cloudflare D1/R2, IndexedDB, Node test runner, happy-dom, Sites preview and deployment tooling.

**Spec:** `docs/superpowers/specs/2026-09-03-release-hardening-v7-design.md`

## Working Rules

- Work on `feature/v7-hardening`; preserve unrelated user changes.
- Keep `origin` as the authoritative Sites source remote; do not push the GitHub mirror unless explicitly requested.
- Follow RED → minimum GREEN → focused regression → `git diff --check` for each task.
- Use existing primitives before adding code. Any new abstraction must serve at least two concrete V7 call sites or protect a cross-cutting invariant.
- Keep the annotation threshold derived from the documented 1060px minimum geometry; do not add a competing viewport breakpoint.
- Do not deploy while the cloud browser preview gate is blocked.
- Do not expose private body text, email, raw DOCX, auth headers, SQL, or stack traces in UI or logs.
- No new V8 product feature is admitted through a V7 bug fix.

## Task 1: Freeze the V7 baseline and executable audit gates

**Files:**

- Modify: `README.md`
- Create: `docs/v7-release-hardening-report.md`
- Create: `docs/testing/v7-regression-matrix.md`
- Test: `tests/v7-contract.test.ts`

**Steps:**

- [ ] Record the V6 baseline commit, unit/build result, preview/browser blocker and unresolved owner-only/allowlist semantic in the report.
- [ ] Turn the Auth, Post, Reply, Annotation, DOCX and Assets matrix into checkboxes with expected result, evidence field and status.
- [ ] Add static contract tests that assert every required route has its intended loading/error boundary and every required lifecycle copy has one canonical source.
- [ ] Keep every browser-only row `BLOCKED`, not `PASS`, until the Site is exercised in the real browser.
- [ ] Run `npm run test:unit` and `git diff --check`.

## Task 2: Make annotation geometry deterministic and single-source responsive

**Files:**

- Modify: `lib/annotations/layout.ts`
- Modify: `lib/annotations/responsive.ts`
- Modify: `components/annotations/annotation-reading-layout.tsx`
- Modify: `components/editor/annotated-editor-layout.tsx`
- Modify: `app/globals.css`
- Test: `tests/annotation-layout.test.ts`
- Test: `tests/annotation-guard-integration.test.ts`

**Steps:**

- [ ] Add failing tests for stable multi-line representative rects, downward-only collision, unchanged-geometry state suppression and container-mode switching.
- [ ] Preserve `(anchorY, annotationId)` ordering and current `max(desiredTop, previousBottom + gap)` placement.
- [x] Replace separate CSS/JS breakpoint decisions with one container-derived `desktop | compact` state exposed through a data attribute.
- [ ] Route connectors through the body/sidebar gutter, with a short anchor stem and a stable card-left attachment.
- [ ] Schedule measurement on font ready, image load, resize, card/body ResizeObserver and editor/readonly mode changes through one rAF coalescer.
- [ ] Do not remeasure on scroll; skip React geometry updates when values are equal.
- [ ] Verify long-card and long-thread layout without fixed sidebar scrolling.
- [ ] Run focused tests and `git diff --check`.

## Task 3: Implement stable notification target resolution and highlight

**Files:**

- Create: `lib/notifications/target-resolution.ts`
- Modify: `lib/activity/policy.ts`
- Modify: `db/queries.ts`
- Modify: `app/(site)/notifications/[id]/page.tsx`
- Modify: `app/(site)/posts/[id]/page.tsx`
- Modify: `components/annotations/annotation-reading-layout.tsx`
- Modify: `components/annotations/annotation-thread.tsx`
- Modify: `components/reply-list.tsx`
- Modify: `app/globals.css`
- Test: `tests/activity-notifications.test.ts`
- Test: `tests/annotation-replies.test.ts`
- Test: `tests/lifecycle-integration.test.ts`

**Steps:**

- [ ] Define `AVAILABLE | DELETED_BY_AUTHOR | HIDDEN_BY_ADMIN | NOT_IN_CURRENT_REVISION | POST_UNAVAILABLE | NOT_FOUND` as a redacted resolver result, not a database column.
- [ ] Resolve post reply, annotation root and annotation reply by owned notification ID and stable entity IDs.
- [ ] Give annotation replies stable DOM IDs and canonical query parameters.
- [ ] Desktop deep links activate anchor/card and reveal the exact reply; compact deep links activate anchor, open the sheet and reveal the reply.
- [ ] Target deleted placeholders, distinguish admin-hidden and historical-revision notices, and never expose hidden body text.
- [ ] Add an independent one-shot two-second highlight state; remove it after completion and respect reduced motion.
- [ ] Ensure Back/Forward repeats navigation only and cannot repeat mark-read or another mutation.
- [ ] Run focused tests and `git diff --check`.

## Task 4: Type access expiry and mutation failures without losing drafts

**Files:**

- Modify: `lib/auth/access.ts`
- Create: `lib/actions/result.ts`
- Modify: `app/(site)/posts/[id]/actions.ts`
- Modify: `app/(site)/posts/new/actions.ts`
- Modify: `app/(site)/posts/[id]/edit/actions.ts`
- Modify: `app/(site)/profile/actions.ts`
- Modify: `app/(site)/admin/actions.ts`
- Modify: `app/api/assets/route.ts`
- Modify: `app/api/assets/[id]/route.ts`
- Modify: `app/api/docx-import/commit/route.ts`
- Modify: affected editor/reply/annotation/profile/admin forms
- Test: `tests/auth-access.test.ts`
- Test: `tests/mutation-pending.test.ts`
- Test: `tests/drafts.test.ts`

**Steps:**

- [ ] Add a non-redirecting action/API access resolver that distinguishes missing identity as `AUTH_EXPIRED` from valid identity without allowlist membership as `ACCESS_REVOKED`.
- [ ] Keep page navigation on the existing SIWC redirect path.
- [ ] Map domain/platform failures to safe action result codes; log raw exceptions server-side only.
- [ ] Ensure action `try/catch` never swallows a framework redirect.
- [ ] Keep all controlled form content and IndexedDB drafts after either access failure; disable submission only for access revoked.
- [ ] Make retry use the same form values and idempotency key.
- [ ] Isolate unread-notification count failure so it cannot take down the entire Site shell.
- [ ] Run focused tests and `git diff --check`.

## Task 5: Make image and attachment upload recover per file

**Risk gate:** Prove the Milkdown integration can settle multiple uploads independently before changing visible editor behavior. If the installed Crepe API cannot support it without forking a large subsystem, stop and document the smallest compatible override; do not fake partial success.

**Files:**

- Create: `lib/assets/upload-task.ts`
- Modify: `lib/assets/browser-upload.ts`
- Modify: `lib/assets/service.ts`
- Modify: `components/post-editor-form.tsx`
- Modify: `components/editor/markdown-editor.tsx`
- Create or modify: small upload-status component under `components/assets/`
- Modify: `app/api/assets/route.ts`
- Test: `tests/assets.test.ts`
- Test: `tests/loading-and-mutations.test.ts`
- Test: new upload task test

**Steps:**

- [ ] Add pure state-transition tests for five files with success/failure/pending, single-item retry and remove.
- [ ] Return typed `UNSUPPORTED_TYPE`, `SIZE_LIMIT`, `NETWORK`, `SERVER`, `AUTH_EXPIRED`, `ACCESS_REVOKED` outcomes.
- [ ] Let every file keep its own progress, abort controller, asset result and error state.
- [ ] Retain successful items when a sibling fails; retry never reuploads a success.
- [ ] Replace Crepe's fail-fast batch path with the smallest supported upload configuration that inserts successful images independently.
- [ ] On R2 put + D1 insert failure, best-effort delete the new object and emit a GC-safe failure log.
- [ ] Verify editor discard aborts only pending tasks and leaves already-bound content consistent.
- [ ] Run focused tests and `git diff --check`.

## Task 6: Close duplicate-submit gaps

**Files:**

- Modify: `db/schema.ts`
- Create: next Drizzle migration
- Modify: `lib/posts/service.ts`
- Modify: `app/(site)/posts/new/actions.ts`
- Modify: `components/post-editor-form.tsx`
- Modify: admin allowlist form/action
- Test: `tests/posts.test.ts`
- Test: migration test
- Test: concurrent idempotency test

**Steps:**

- [ ] Add a nullable create submission key and unique `(author_id, creation_submission_key)` constraint.
- [ ] Generate the key once per new-post editor session and keep it across failure/retry.
- [ ] Return the original post for exact repeat and unique-race repeat; reject a reused key with a different payload.
- [ ] Verify two simultaneous create requests create one post, one revision, one activity event and one notification set.
- [ ] Normalize allowlist unique-race into “already exists” without duplicate rows or raw errors.
- [ ] Audit every V7 mutation against client pending + server idempotency/conditional update and document why no additional key is needed.
- [ ] Apply the migration to empty and V6 fixture databases, then run focused tests and `git diff --check`.

## Task 7: Remove D1 N+1 queries and add only proven indexes

**Files:**

- Modify: `db/queries.ts`
- Modify: `db/schema.ts`
- Create: next Drizzle migration if Task 6 migration is already fixed; otherwise combine safely
- Create: `tests/query-plans.test.ts`
- Modify: query integration tests

**Steps:**

- [ ] Add query-count tests for 50 post cards, replies, activity items, notifications and tags.
- [ ] Batch post tags and grouped reply counts; do not query once per post.
- [ ] Join/batch reply-to users.
- [ ] Batch post discussion reachability and current annotation membership for Activity/Notifications.
- [ ] Aggregate tag counts in one query.
- [ ] Run `EXPLAIN QUERY PLAN` against representative fixtures for Latest, Active, Profile Posts, Post Detail, Notifications, Tag, Search, Admin, Revision and Annotation threads.
- [ ] Add only plan-proven `posts(author_id,published_at)`, `post_replies(post_id,published_at)` and `post_tags(tag_id,post_id)` as needed; remove strictly redundant left-prefix indexes in the same safe migration.
- [ ] Document every index → query mapping and the intentionally unindexed bounded `%LIKE%` search.
- [ ] Run focused tests, full unit tests and `git diff --check`.

## Task 8: Add safe R2 GC dry-run, claim and failure retry

**Files:**

- Modify: `db/schema.ts`
- Create: next Drizzle migration
- Modify: `lib/assets/gc.ts`
- Modify: `lib/assets/service.ts`
- Add: minimal admin/maintenance invocation and report UI if needed
- Test: `tests/assets.test.ts`
- Test: new GC integration test

**Steps:**

- [ ] Define candidate reasons for expired temporary, metadata orphan and R2-only orphan.
- [ ] Add dry-run output with count, bytes, asset IDs/safe keys and reasons; assert it performs no mutation.
- [ ] Add a bounded D1 claim/attempt/error record and require a final reference recheck before physical delete.
- [ ] Update metadata only after R2 deletion succeeds.
- [ ] Catch per candidate; one R2 failure records a safe code and does not stop later candidates.
- [ ] Retry eligible failures in later maintenance runs with a bounded backoff/attempt policy.
- [ ] Add paginated, prefix-bounded R2 listing to find old objects absent from D1; require dry-run evidence before enabling execute mode.
- [ ] Prove current/revision/avatar refs block deletion and the 7-day temporary window protects every 24-hour IndexedDB Preview.
- [ ] Run focused tests and `git diff --check`.

## Task 9: Finish loading, retry, empty, responsive and accessibility polish

**Files:**

- Modify: route `loading.tsx` / `error.tsx` only where the Task 1 matrix shows a gap
- Modify: `components/loading/skeletons.tsx`
- Add: smallest reusable local retry boundary if Vinext behavior is verified
- Modify: Notifications/Profile/Search/Tag/Admin/Post region components
- Modify: `app/globals.css`
- Modify: `DESIGN.md` and `UX-CONTRACT.md` only for accepted V7 deltas
- Test: `tests/loading-and-mutations.test.ts`
- Test: accessibility/static rendered contract tests

**Steps:**

- [ ] Keep geometry-stable placeholders but delay local skeleton color by 120–180ms to avoid fast-request flicker.
- [ ] Add local error + Retry while preserving page shell, current query/tab and typed input.
- [ ] Verify every required empty state has concise explanatory copy and no blank region.
- [ ] Wrap Markdown tables in a local overflow container; keep code blocks local-scroll and long text/filenames wrapping.
- [ ] Raise important touch targets to at least 44px and separate dangerous actions.
- [ ] Verify annotation range/card, notification item, composers, menus, upload, dialogs and admin controls have labels, visible focus and correct keyboard activation.
- [ ] Return focus to the opener after sheet/dialog/composer closes.
- [ ] Localize ordinary Profile tab labels and repair any DESIGN/UX contract drift found in the visual audit.
- [ ] Verify forced-colors and reduced-motion CSS.
- [ ] Run focused tests and `git diff --check`.

## Task 10: Add production-safe logging and performance assertions

**Files:**

- Create: `lib/observability/log.ts`
- Modify: server actions, asset/DOCX routes, query/GC error sites
- Modify: `next.config.*` / Vinext config only if bundle inspection proves a concrete issue
- Test: new observability tests

**Steps:**

- [ ] Emit operation, entity ID, internal user ID, error code and request correlation ID.
- [ ] Prove logs redact email, Markdown, annotation body, DOCX content and auth headers.
- [ ] Ensure client messages never contain stack trace or raw database/platform text.
- [ ] Inspect client bundle, Markdown parser imports and annotation fetch paths; remove only proven duplicate/oversized work.
- [ ] Add a connector measurement test that repeated pointer/scroll activity does not schedule full layout work.
- [ ] Run focused tests, full tests, build and `git diff --check`.

## Task 11: Run the complete release regression

**Files:**

- Update: `docs/testing/v7-regression-matrix.md`
- Update: `docs/v7-release-hardening-report.md`

**Automated gate:**

- [ ] `npm run test:unit`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] migration upgrade tests
- [ ] query-plan/query-count tests
- [ ] no unexpected warnings or skipped tests beyond the approved Word Online fixture

**Browser gate:**

- [ ] Run the complete product journey in the Site preview.
- [ ] Test 320, 375, 390, 430, 768, 820 and 1024px plus a common desktop width.
- [ ] Verify Tab, Enter/Space, Escape, focus trap, focus return, forced colors and reduced motion.
- [ ] Verify Search/Tag/Notification/Profile tabs/Post Back/Forward restore correct target and scroll behavior.
- [ ] Capture evidence for no page-level horizontal overflow and no overlapping cards.

**Slow/failure gate:**

- [ ] Throttle annotated save, Annotation create/reply, DOCX Import and Revision Restore.
- [ ] Inject D1 mutation, R2 upload/delete, notification query, asset bind, auth expiry and optimistic conflict failures.
- [ ] Record consistency, user message, retained content, retry behavior and absence of duplicates/ghost UI.

## Task 12: Owner-only private production deployment and rollback proof

**Required skill:** Use the Sites hosting workflow only after Task 11 is completely green.

**Steps:**

- [ ] Confirm production D1/R2 bindings, migrations, allowlist, owner/admin identity, no dev fixture, no debug backdoor and no test/mock data.
- [ ] Record the previous stable Sites version/deployment as the rollback target.
- [ ] Commit and push the validated source to the authoritative Sites branch using a short-lived credential.
- [ ] Deploy owner-only/private without changing the existing URL or social preview assets.
- [ ] Run post-deploy smoke checks for auth, home, Post, Annotation, Notifications, assets and admin.
- [ ] Verify rollback procedure can select/redeploy the recorded stable version.
- [ ] Complete all 16 required report sections, including exact indexes, eliminated N+1s, GC behavior, viewport result, failure injection and known limitations.
- [ ] Stop feature expansion after V7; future work enters bugfix, maintenance, migration or small UX polish mode.
