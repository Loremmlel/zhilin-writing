# 知临中学 V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reviewable, undeployed V1 of a private Markdown writing community with real authentication, D1/R2 persistence, Markdown-first WYSIWYG editing, local drafts, replies, tags, search, profiles, and administration.

**Architecture:** Vinext server components and server actions enforce identity and authorization. D1/R2 modules sit behind repository and asset boundaries, while Milkdown/Crepe owns Markdown ↔ Remark AST ↔ ProseMirror round-tripping in the browser. The UI consumes service functions rather than database bindings directly.

**Tech Stack:** Sites Vinext, React 19, Cloudflare D1/R2, Drizzle ORM, Milkdown Crepe/ProseMirror/Remark, IndexedDB, Tailwind/CSS.

**Spec:** `docs/superpowers/specs/2026-08-25-private-markdown-community-design.md`

## Global Constraints

- All browser routes require Sign in with ChatGPT and a server-side allowlist check.
- D1 is authoritative for structured data; R2 is authoritative for uploaded bytes.
- Canonical post and reply content is Markdown, never rendered HTML.
- Post edits do not change `last_activity_at`; publishing and replying do.
- Replies have no edit action and never exceed two visual levels.
- Do not implement annotations, revisions, notifications, activity events, or restoration workflows.
- Save a Sites version without deploying it.

---

### Task 1: Domain rules and test harness

**Files:**

- Modify: `package.json`
- Create: `lib/domain/rules.ts`
- Create: `tests/domain-rules.test.ts`

**Interfaces:**

- Produces: `normalizeEmail`, `validateDisplayName`, `validatePostInput`, `validateReplyMarkdown`, `normalizeReplyTarget`, and `canEditPost`.

- [ ] Write tests for email normalization, unique-name validation inputs, tag limits, post ownership, reply size/emptiness, and two-level reply normalization.
- [ ] Run `npm run test:unit` and confirm missing-module/behavior failures.
- [ ] Implement the minimal pure rules and rerun the tests to green.

### Task 2: D1 schema and repositories

**Files:**

- Modify: `.openai/hosting.json`
- Replace: `db/schema.ts`
- Create: `db/queries.ts`
- Create: `lib/auth/access.ts`
- Create: `lib/posts/service.ts`
- Create: `drizzle/*.sql`

**Interfaces:**

- Consumes: domain validation functions from Task 1.
- Produces: `requireSiteAccess`, `getCurrentMember`, `createPost`, `updatePost`, post/reply/tag/profile/admin query functions.

- [ ] Add failing tests for service input and authorization decisions using injected repository functions.
- [ ] Set logical bindings to `DB` and `BUCKET`, define relational tables/indexes, and generate migrations.
- [ ] Implement server-side bootstrap/allowlist/profile access and repository boundaries.
- [ ] Implement the post save boundary and confirm tests pass.

### Task 3: Safe Markdown pipeline

**Files:**

- Create: `lib/markdown/render.ts`
- Create: `lib/markdown/plain-text.ts`
- Create: `tests/markdown.test.ts`

**Interfaces:**

- Produces: `renderMarkdown(markdown): Promise<string>` and `markdownToPlainText(markdown): string`.

- [ ] Write failing tests for GFM tables/tasks, links, code, stripping script/iframe content, and searchable plain text.
- [ ] Implement Remark/Rehype parsing, GFM, sanitization, and serialization.
- [ ] Run unit tests to green.

### Task 4: Authenticated shell and onboarding

**Files:**

- Modify: `app/layout.tsx`, `app/globals.css`, `app/page.tsx`
- Create: `app/(site)/layout.tsx`, `components/site-header.tsx`, `components/site-footer.tsx`
- Create: `app/onboarding/page.tsx`, `app/onboarding/actions.ts`

**Interfaces:**

- Consumes: `requireSiteAccess` and profile query/update functions.
- Produces: protected navigation and first-login profile creation.

- [ ] Add rendered-output tests for site title, private community copy, navigation, and onboarding form.
- [ ] Implement the protected shell and reference-driven warm white/muted green visual system.
- [ ] Implement onboarding with a unique current display name and optional avatar/bio.

### Task 5: Markdown-first editor and local drafts

**Files:**

- Create: `components/editor/markdown-editor.tsx`
- Create: `components/editor/editor-shell.tsx`
- Create: `lib/drafts/indexed-db.ts`
- Create: `app/posts/new/page.tsx`, `app/posts/new/actions.ts`

**Interfaces:**

- Produces: an uncontrolled Milkdown editor whose `onMarkdownChange` callback emits canonical Markdown, and draft helpers keyed by user/post.

- [ ] Write failing unit tests for stable draft keys and post form validation.
- [ ] Install and configure Milkdown Crepe with only requested GFM functionality.
- [ ] Debounce draft text/references to IndexedDB and expose Saving/Saved/Failed states.
- [ ] Publish through `createPost`, bind temporary assets, then remove the local draft.

### Task 6: R2 uploads and attachment semantics

**Files:**

- Create: `lib/assets/storage.ts`
- Create: `app/api/assets/route.ts`
- Create: `app/api/assets/[id]/route.ts`
- Create: `components/editor/asset-panel.tsx`

**Interfaces:**

- Produces: authenticated upload/download endpoints and Markdown insertion strings for image and attachment assets.

- [ ] Write failing tests for file kind/size validation and generated Markdown semantics.
- [ ] Upload once to R2, write D1 metadata as temporary/unbound, and return a stable application URL.
- [ ] Add Insert into post actions and bind assets after publication.

### Task 7: Post list, detail, edit, replies, tags, and search

**Files:**

- Create: `components/post-card.tsx`, `components/reply-list.tsx`, `components/reply-form.tsx`
- Create: `app/posts/[id]/page.tsx`, `app/posts/[id]/edit/page.tsx`, route actions
- Create: `app/tags/page.tsx`, `app/tags/[name]/page.tsx`, `app/search/page.tsx`

**Interfaces:**

- Consumes: post/reply/tag/search queries, renderer, editor, and post persistence boundary.

- [ ] Add rendered-output and domain tests for Latest/Active ordering, edit timestamps, and flattened reply depth.
- [ ] Build the reference-inspired home list with Latest/Active switching.
- [ ] Build readable post details, attachments, uneditable Markdown replies, tags, and title/body search.
- [ ] Build author-only editing without activity bumping.

### Task 8: Profiles and administration

**Files:**

- Create: `app/users/[id]/page.tsx`, `app/settings/profile/page.tsx`, related actions
- Create: `app/admin/page.tsx`, `app/admin/actions.ts`

**Interfaces:**

- Consumes: profile/admin queries and server-side admin authorization.

- [ ] Add tests for unique display names and sole-admin protection.
- [ ] Build profile pages and profile editing.
- [ ] Build the minimal allowlist/registered-user admin area without exposing emails elsewhere.

### Task 9: Migration, build, and undeployed save

**Files:**

- Modify: `tests/rendered-html.test.mjs`
- Verify: all application and migration files.

**Interfaces:**

- Produces: a validated Sites source version with no deployment.

- [ ] Run `npm run db:generate` and inspect generated SQL.
- [ ] Run unit tests, lint, the full test suite, and the production build.
- [ ] Review every V1 acceptance item against source/test evidence and list any runtime-only limitations honestly.
- [ ] Save the Sites version without starting a deployment.
