# Content Lifecycle V4 Design

## Scope

V4 completes the lifecycle of posts, replies, revisions, activity, notifications, and assets before annotations are introduced. Ordinary deletion is always reversible soft delete. Administrator hiding is an independent moderation state. Neither state may erase another member's still-public discussion, revision history, event history, notification history, or referenced R2 object.

Annotation, AnnotationGuard, DOCX import, free mentions, user trash/restore, hard-delete UI, bulk moderation, retention policy, and push/email notifications remain out of scope.

## Lifecycle state and schema

`posts` and `replies` retain their current `deleted_at` and `hidden_at` fields and gain `deleted_by_user_id`, `hidden_by_user_id`, and optional `hidden_reason`. A record may be both user-deleted and administrator-hidden; ordinary rendering gives administrator-hidden the stricter presentation while the admin surface shows both states.

Replies also gain `reply_to_reply_id`. New replies persist the exact direct target while keeping the existing two-level `root_reply_id` layout and `reply_to_user_id` attribution. The migration deterministically backfills legacy rows where a direct target can be inferred from the latest preceding reply by the recorded target user in the same thread.

`admin_audit_log` stores administrator lifecycle operations with a unique transition key so retried actions do not duplicate audit entries. It does not receive ordinary user activity.

## Rendering and query policy

Ordinary feeds, search, tags, and profile Posts continue to query only active posts. A direct post URL is resolved separately:

- active post: title, Markdown, tags, attachments, editing, and reply creation are available;
- unavailable post without other-member public replies: a controlled unavailable card is shown and content is not leaked;
- unavailable post with other-member public replies: the detail route remains reachable, the post body becomes an author-delete or administrator-hide placeholder, and the surviving reply discussion remains readable; no new replies or edits are allowed.

Reply lists contain every active reply plus unavailable ancestors required to preserve a visible descendant. A placeholder never renders stored Markdown. Pure placeholders are excluded from counts. `reply_to_user_id` is never rewritten; the new direct target field supplies dependency checks without changing historical attribution.

Administrator queries are separate, server-authorized paths that can inspect original stored content and both lifecycle flags. They never reuse an ordinary query with a client-controlled bypass flag.

## Mutations and permissions

Lifecycle mutations live in one server-only service. Ordinary members can soft-delete only their own post or reply. Administrators can restore user-deleted records, hide/unhide any record, and inspect deleted content. All mutations are idempotent: no-op retries return a stable result and do not write a duplicate audit event.

Restoring soft-deleted current content clears only the user-delete fields. Unhiding clears only the moderation fields. This prevents unhide from republishing content the author had already withdrawn and prevents ordinary restore from bypassing an administrator hide.

Historical revision restore remains a content operation: it creates a new revision from the selected snapshot and clears the post's user-delete fields. If the post is also administrator-hidden, that stricter state remains. Soft-delete restore creates no revision because it only changes lifecycle state.

## Activity, notifications, and recent activity

Historical events and notifications remain. Read models derive availability from current target state:

- no deleted/hidden Markdown preview or withdrawn title is emitted;
- a reachable discussion keeps a safe post link;
- an unavailable target renders generic deleted/hidden/unavailable wording;
- notification clicks land on the post discussion or a controlled unavailable card, never 404/500 because of a lifecycle transition.

Delete, hide, unhide, restore, and revision restore do not create public activity. Reply lifecycle changes recompute `last_activity_at` from the post publication time and the newest currently active reply's original publication time. The mutation time is never used, so removed replies cannot permanently pin a post and restored replies do not look newly published.

## Asset authorization and garbage collection

R2 bytes remain shared across current and historical revisions. Asset delivery is authorized by current references and lifecycle state: an active current-post reference is readable by members, a revision-only or unavailable-post reference is administrator-only, an avatar reference remains readable to members, and a temporary upload is owner-only.

Garbage collection is isolated in `lib/assets/gc.ts`. Eligibility requires zero current post refs, zero revision refs, zero avatar refs, and either an expired unbound temporary asset or a permanent orphan. Lifecycle mutations never call R2 deletion synchronously. The cleanup routine rechecks references before deleting the object and marks its metadata deleted only after a successful R2 delete.

## Administrator experience

The existing compact admin page gains a content-management section with URL-addressable filters for Posts/Replies and active/user-deleted/admin-hidden states. Rows show metadata and both flags, link posts to revision history, let the administrator inspect stored Markdown, and expose only the valid restore/hide/unhide operations. The existing shared `ModalDialog` owns confirmation behavior; user delete and administrator hide remain visibly and verbally distinct.

The audit list is bounded and chronological. It shows administrator, operation, target type, time, and safe metadata without exposing raw content.

## Verification

Tests cover lifecycle priority, dependency placeholders, direct-target preservation, reachability, reply counts, derived recent activity, asset GC eligibility, transition idempotency, schema migration/backfill, authorization boundaries, degraded activity/notification copy, and the V3 deleted-post revision restore rule. The complete unit/build/rendered-artifact suite, TypeScript, lint, migration inspection, DESIGN/UX audit, and strict premium UI audit must pass before checkpointing.

## Known limits

- Legacy `reply_to_reply_id` backfill is deterministic but cannot reconstruct information that was never stored when several earlier replies by the same user are equally plausible.
- No scheduler is added; the GC service is ready for a future scheduled or maintenance caller.
- Ordinary users cannot restore their own deleted content and have no recycle-bin UI.
- Administrator content management is intentionally bounded rather than a full moderation suite.
