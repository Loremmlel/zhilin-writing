# 知临中学 V1 Design

## Product boundary

Build a private, invitation-only Markdown writing community for a handful of known users. V1 includes ChatGPT sign-in, an email allowlist, local profiles, durable posts/replies/tags/assets, search, user pages, local drafts, and a small admin area. It deliberately excludes annotations, revisions, notifications, activity events, restoration workflows, mentions, collaboration, and public access.

## Runtime and persistence

Use the Sites Vinext runtime. D1 is the source of truth for allowlist entries, users, profiles, posts, replies, tags, joins, and asset metadata. R2 stores avatar bytes, inline images, and attachments. IndexedDB stores unpublished Markdown draft text and references to already-uploaded temporary R2 assets.

The first authenticated visitor may bootstrap the empty installation as the sole administrator. After that bootstrap, every request must pass a server-side email allowlist check. Emails remain private identity keys and never appear in normal UI.

## Editor and Markdown

Use Milkdown Crepe, built on ProseMirror and Remark, for the post editor. Markdown is loaded into the editor and every editor update serializes back to Markdown; HTML is never persisted as the content source. The post editor enables CommonMark/GFM features, tables, tasks, images, and links. Replies use the same Markdown pipeline with a reduced feature surface.

Rendering uses a server-side Remark/Rehype pipeline with GFM support and a restrictive sanitization schema. This gives the application a common Markdown AST boundary and safe HTML output.

Future annotations will be implemented as a Milkdown plugin that adds a ProseMirror mark with an immutable annotation ID, a matching Remark node/token extension, parser and serializer handlers, selection-aware commands, and transaction validation. No DOM-offset or string-offset compatibility layer is introduced in V1.

## Server boundaries

Authentication/authorization, database queries, asset storage, Markdown conversion, and validation remain in separate modules. UI code calls server actions; it does not issue direct database updates.

Posts are written only through `createPost` and `updatePost`. The latter is the extension point for later base-revision checks, annotation validation, revision snapshots, asset snapshots, and transactional updates. Editing a post updates `edited_at` but not `last_activity_at`; publishing and replying update activity.

## Data model

- `allowed_users`: normalized email, administrator flag, added timestamp.
- `users`: immutable ID, current unique display name, avatar asset ID, bio, joined timestamp.
- `posts`: author ID, title, canonical Markdown, publication/edit/activity timestamps, deletion/hidden foundations.
- `replies`: post, author, root reply, actual target user, canonical Markdown, publication/deletion timestamps.
- `tags` and `post_tags`: unique normalized names and up to five joins per post.
- `assets`: owner, R2 key, kind, filename, MIME type, size, temporary/bound lifecycle fields, deletion foundation.

## Routes and experience

The protected shell contains a restrained header, search, write action, and account menu. The home route shows Latest/Active post lists and supporting cards inspired by the supplied warm white, ink, and muted green reference. Routes cover onboarding, post creation/editing/detail, tags, search, profiles, profile settings, and administration. Responsive layouts collapse to one column without turning into a dashboard.

## Error and empty states

Server actions return field-level errors for invalid input and authorization failures. Pages show useful empty states for no posts, no replies, no search results, and no tags. Upload failures preserve the local draft and show retryable feedback. A missing D1/R2 binding is reported as an installation error rather than silently falling back to browser persistence.

## Acceptance strategy

Pure validation, reply-depth normalization, permissions, draft keys, and Markdown rendering/round-trip expectations receive automated tests. The production build is the runtime compatibility gate. The saved version remains undeployed for owner review.
