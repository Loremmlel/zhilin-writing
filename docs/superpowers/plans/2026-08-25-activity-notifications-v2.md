# Activity Events and Notifications V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a durable, extensible public activity log, per-user notification delivery, Activity profile tab, and notification center to the existing private writing community.

**Architecture:** Keep the existing Vinext, D1, SIWC, and server-action architecture. Add normalized `activity_events` and `notifications` tables, create events and notifications in the same D1 batch as the public write, and keep recipient/target/display decisions in small pure helpers so policy is testable without D1.

**Tech Stack:** Next.js/Vinext, React 19, Cloudflare D1, Drizzle ORM, Node test runner, TypeScript.

**Spec:** `docs/superpowers/specs/2026-08-25-activity-notifications-v2-design.md`

## Global Constraints

- Preserve existing authentication, allowlist, editor, post, reply, draft, upload, layout, and naming patterns.
- Implement only `POST_CREATED` and `POST_REPLY_CREATED`; do not add Annotation or Revision tables.
- Never notify the actor, and always notify the directly replied-to user for nested replies.
- Never expose deleted or hidden content through activity or notification previews.
- All notification reads and writes are scoped to the authenticated recipient.
- Use D1-backed persistence and atomic batch writes; do not add queues, sockets, push, email, or notification preferences.

---

### Task 1: Testable event and notification policy

**Files:**

- Create: `lib/activity/policy.ts`
- Test: `tests/activity-policy.test.ts`

**Interfaces:**

- Produces: `activityEventId`, `notificationId`, `resolveReplyRecipient`, `truncateActivityPreview`, and `replyTargetHref`.

- [ ] Write failing tests proving deterministic IDs, direct-target recipient selection, self-notification suppression, Unicode-safe preview truncation, and stable `#reply-<id>` URLs.
- [ ] Run `npm run test:unit -- tests/activity-policy.test.ts` and confirm the missing module/API failure.
- [ ] Implement the minimal pure helpers with literal event/notification types and no database dependency.
- [ ] Rerun the focused unit test and then `npm run test:unit`.

### Task 2: Durable schema, indexes, and atomic write path

**Files:**

- Modify: `db/schema.ts`
- Modify: `db/queries.ts`
- Modify: `lib/posts/service.ts`
- Modify: `components/reply-form.tsx`
- Modify: `app/(site)/posts/[id]/actions.ts`
- Create: generated `drizzle/0001_*.sql` and matching metadata
- Test: `tests/activity-policy.test.ts`

**Interfaces:**

- Consumes: deterministic IDs and recipient policy from Task 1.
- Produces: `activity_events`, `notifications`, author-scoped reply idempotency, `listUserActivity`, `listNotifications`, `countUnreadNotifications`, `findOwnedNotification`, `markNotificationRead`, and `markAllNotificationsRead`.

- [ ] Add schema definitions and indexes for actor/time, post/time, recipient/read/time, event linkage, and unique idempotency constraints.
- [ ] Update the reply form to submit a stable per-attempt UUID and rotate it only after success.
- [ ] Change post creation to batch the post and `POST_CREATED` event; change reply creation to resolve the direct recipient and batch reply, last activity update, event, and optional notification.
- [ ] Add left-join read queries that return current actor profile and sanitized availability states.
- [ ] Run `npm run db:generate`, inspect the migration, and run unit tests.

### Task 3: Activity tab and notification center

**Files:**

- Create: `components/activity-list.tsx`
- Create: `components/notification-list.tsx`
- Create: `app/(site)/notifications/page.tsx`
- Create: `app/(site)/notifications/actions.ts`
- Create: `app/(site)/notifications/[id]/page.tsx`
- Modify: `app/(site)/users/[id]/page.tsx`
- Modify: `app/(site)/layout.tsx`
- Modify: `components/site-header.tsx`
- Modify: `app/(site)/posts/[id]/page.tsx`
- Modify: `app/globals.css`
- Test: `tests/rendered-html.test.mjs`

**Interfaces:**

- Consumes: activity and notification queries from Task 2.
- Produces: `/users/:id?tab=activity`, `/notifications?tab=unread`, owned notification open/mark-read flow, mark-all-read server action, deletion notices, and animated reply anchors.

- [ ] Add a failing rendered-output check for the notification navigation label and Activity/notification surface markers.
- [ ] Run the rendered check and confirm it fails because V2 UI is absent.
- [ ] Add profile tabs and availability-safe Activity cards.
- [ ] Add header unread badge, all/unread notification tabs, concise previews, unread styling, and one-call mark-all-read.
- [ ] Add the owned notification opener that marks read then redirects to a stable reply anchor or renders a clear unavailable state.
- [ ] Add deleted-reply messaging and a short CSS target animation with `scroll-margin-top`.
- [ ] Run unit tests and a production build.

### Task 4: Verification and private checkpoint deployment

**Files:**

- Verify all modified and generated files.

**Interfaces:**

- Consumes: complete V2 implementation.
- Produces: a new immutable private Sites version and verified production URL.

- [ ] Run `npm run lint`, `npm run test:unit`, and `npm run build` with zero failures.
- [ ] Start one authorized agent preview and exercise the primary authenticated Activity/notification flow within the Sites QA budget; record any environment limitation without weakening server-side tests.
- [ ] Re-read the 20-point acceptance list and map each item to code, automated evidence, or the bounded preview result.
- [ ] Run the Sites checkpoint command, preserve the existing custom owner-only access policy, and directly verify terminal deployment status before reporting the URL.
