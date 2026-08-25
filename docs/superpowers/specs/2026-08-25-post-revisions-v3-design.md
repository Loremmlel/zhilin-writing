# Post Revisions V3 Design

## Scope

V3 adds durable post content history, asset snapshots, optimistic edit locking, administrator-only history/restore, and recovery of unpublished local edits. It also makes the account popover close on outside interaction and Escape. Annotation, AnnotationGuard, DOCX import, automatic merging, collaborative editing, public version history, and full soft-delete restoration remain out of scope.

## Data model

- `posts.current_revision_id` points to the immutable revision that supplies the current title and Markdown.
- `post_revisions` stores `post_id`, per-post `revision_number`, title, canonical Markdown, creator, creation time, and optional `restore_source_revision_id`.
- `post_asset_refs` represents the current post's resource set.
- `revision_asset_refs` snapshots the resource set for each revision. Each reference has usage `inline` or `attachment`; the same asset may have both usages.
- R2 bytes are never copied per revision. D1 references preserve each historical resource. Physical deletion is allowed only when neither current-post nor revision references exist and the asset otherwise qualifies for cleanup.

The revision tables are deliberately independent of annotations. A future annotation snapshot can be added beside `revision_asset_refs` without changing the save/restore orchestration.

## Save orchestration

`createPost()` and `updatePost()` remain the only persistence boundary. Publishing creates the post, its v1 revision, current asset refs, `current_revision_id`, tags, and the existing `POST_CREATED` activity in one D1 batch.

Editing loads `base_revision_id`. `updatePost()` validates that it equals `posts.current_revision_id`. A content change (title, Markdown, inline references, or attachment set) creates one new revision and atomically updates the post mirror fields, current pointer, current asset refs, asset permanence, search text, and `edited_at`. A tags-only change replaces tags without creating a revision or changing `edited_at`.

`last_activity_at`, activity events, and notifications are untouched by editing and restore.

## Conflict behavior

If the submitted base is stale, the service returns `EDIT_CONFLICT` with the latest server snapshot. The IndexedDB draft is retained. The conflict surface compares the latest server version and the local draft.

- Use online version: requires confirmation, replaces the editor state with the latest snapshot, updates the base revision, and clears the old local draft.
- Return to edit: retains local content and the conflict warning; ordinary save remains blocked while the base is stale.
- Use my version: requires confirmation and resubmits against the conflict's latest revision. If that latest revision is still current, a new revision is created; if another save won the race, a fresh conflict is returned.

No automatic three-way merge is attempted.

## Administrator history and restore

Only `requireAdministrator()`-protected pages/actions can list, read, preview, or restore revisions. Authors receive no history route or API. The administrator history page renders historical Markdown, inline assets, and attachment lists.

Restore copies the chosen historical title, Markdown, and asset snapshot into a new current revision, sets `restore_source_revision_id`, updates `edited_at`, and preserves all intervening revisions. It does not create public activity, notify users, or change `last_activity_at`.

## Migration

The migration adds nullable `posts.current_revision_id`, creates revision/ref tables, and backfills every existing post with deterministic v1 data from the current post. Existing assets bound through `assets.post_id` seed current and v1 asset references. The migration then points each post at its v1 revision. Existing URLs, posts, replies, tags, activity, notifications, and R2 objects are preserved.

## Verification

Unit tests cover content-change classification, optimistic locking, revision sequencing, Markdown asset extraction, restore semantics, and draft recovery policy. Build-level tests cover administrator-only history surfaces and the account menu's outside-click/Escape behavior. The generated migration is inspected, the complete test/build suite runs, and the deployed D1 schema and backfill are checked after checkpoint deployment.

## Known limits

- V3 presents whole-document comparisons, not diffs or merges.
- Local drafts remain device/browser specific.
- R2 cleanup is conservative; no background scheduler is introduced in V3.
- Revision history is an administrator safety mechanism, not an end-user audit log.
