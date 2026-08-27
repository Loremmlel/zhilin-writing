# UX Contract

## Product context

- Audience: 少数受邀、彼此认识的中文用户；唯一管理员负责成员与内容保险。
- Primary jobs: 写作、阅读、回复、正文批注、恢复本地未提交修改；管理员检查和恢复历史版本。
- Target market(s): 私密中文社区。
- Active locales: `zh-CN`。
- Language/content register: 直白、安静、非营销式中文；管理员界面可保留少量准确英文术语。
- Timezone/calendar policy: 使用平台时间并经项目 `formatDateTime()` 统一展示；公历。
- Accessibility target: WCAG 2.2 AA。

## Business-context sources

| Domain / scope | Authoritative source | Source type | Reviewed date |
|---|---|---|---|
| V1 产品、权限与数据基础 | `docs/superpowers/specs/2026-08-25-private-markdown-community-design.md` | Product/design spec | 2026-08-25 |
| V2 Activity 与通知 | `docs/superpowers/specs/2026-08-25-activity-notifications-v2-design.md` | Product/design spec | 2026-08-25 |
| V3 revision、冲突与恢复 | `docs/superpowers/specs/2026-08-25-post-revisions-v3-design.md` | Product/design spec | 2026-08-25 |
| V4 内容生命周期与资源回收 | `docs/superpowers/specs/2026-08-26-content-lifecycle-v4-design.md` | Product/design spec | 2026-08-26 |
| V5 Annotation AST、正文批注与讨论 | `docs/superpowers/specs/2026-08-27-annotation-v5-design.md` | Product/design spec | 2026-08-27 |
| 服务器权限边界 | `lib/auth/access.ts` | Verified domain invariant | 2026-08-25 |
| 保存、删除、隐藏与恢复状态机 | `lib/posts/service.ts`, `lib/lifecycle/service.ts`, `lib/revisions/service.ts`, `lib/annotations/service.ts` | Verified API/domain contract | 2026-08-27 |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`。
- Token ownership model: DESIGN.md 记录规范，运行时 CSS 为实现源。
- Runtime design-system/token source: `app/globals.css :root` 与共享组件。
- Mapping/export/adapters: 手工一对一映射；审计检查漂移。
- Token drift gate: strict premium UI audit、构建与代码评审。
- Supported themes: 浅色与 forced-colors；不声明暗色主题。
- Design-context owner/review policy: 新增持久视觉/行为决策时同一变更更新本合同。

## Canonical UI Map

| Capability | Canonical owner | Source of truth | Allowed variants | Verification |
|---|---|---|---|---|
| Form | `PostEditorForm` 与现有 server actions | `components/editor/post-editor-form.tsx` | new / edit / conflict | unit + build |
| Scrollbar | global document baseline | `app/globals.css` | stable-gutter geometry only | static audit |
| Dialog | `ModalDialog` | `components/modal-dialog.tsx` | dialog / alertdialog | keyboard policy + build |
| CRUD | post/revision services | `lib/posts/service.ts`, `lib/revisions/service.ts` | create / edit / restore | unit + migration + build |
| Upload | Markdown editor and attachment upload | `/api/assets`, `lib/assets/storage.ts` | inline image / attachment | service + build |
| Account popover | `AccountMenu` | `components/account-menu.tsx` | member / administrator links | dismissal unit test |
| Lifecycle | lifecycle policy/service | `lib/lifecycle/*` | normal / user deleted / admin hidden | unit + migration + build |
| Moderation | administrator content management | `app/(site)/admin`, `components/admin/content-lifecycle-control.tsx` | posts / replies / audit | server permission + build |
| Asset access and GC | reference-aware asset services | `lib/assets/access-service.ts`, `lib/assets/gc.ts` | active / historical / temporary / orphan | unit + service review |
| Annotation AST/selection | annotation Markdown and structural selection | `lib/annotations/markdown.ts`, `lib/annotations/selection.ts` | parse / wrap / unwrap / validate | round-trip + selection unit |
| Annotation reading | `AnnotationReadingLayout` | `components/annotations/annotation-reading-layout.tsx` | desktop sidebar / mobile sheet | unit + build + browser |
| Annotation lifecycle | annotation service and shared moderation | `lib/annotations/service.ts`, `components/admin/content-lifecycle-control.tsx` | create / reply / delete / hide / unhide / restore | unit + transaction review |

## Component behavior

| Component | Default | Hover | Focus | Active | Disabled | Busy | Error |
|---|---|---|---|---|---|---|---|
| Button | labelled action | tone strengthens | visible native/project ring | slight press/selected state | non-interactive, reduced opacity | fixed width, progress copy | inline actionable copy |
| Input | white paper field | border visible | green ring | n/a | non-interactive | submit owns pending | text + `aria-invalid` |
| Search | explicit submit | border visible | green ring | n/a | n/a | route transition | results/empty state |
| Textarea/editor | fixed authored surface | n/a | green boundary/editor focus | n/a | read-only when required | local draft status | retained content + inline error |
| List/timeline | readable rows | border/tone change | link focus | selected green surface | n/a | stable footprint | empty explanatory copy |
| Annotation range | pale red mark + dotted underline | stronger tint | visible ring | linked card/range highlight | creation menu withheld on overlap | composer submit disabled | explicit conflict/selection copy |
| Annotation card/sheet | author, time, content, replies | linked range highlight | visible card focus | stable ID selected | unavailable content uses placeholder | fixed-size publish action | input retained with inline error |

## Dataset navigation

- Admin revision list: per-post bounded timeline; community size is intentionally only a few users/posts, so V3 does not add pagination.
- Exploratory lists: existing latest/recent-active routes and fixed limits remain canonical.
- URL state: selected revision lives in `?revision=`; search query remains `?q=`.
- Admin content filters live in `?type=posts|replies|annotations|annotation-replies&status=normal|deleted|hidden`; deleted and hidden filters may each include an item when both flags are present.
- Annotation notification/deep-link state lives in `?annotation=<opaque-id>`; unavailable historical targets use `?notice=annotation-unavailable` and never text search.
- Empty/no-results/error/loading: stable card or inline notice; no skeletons.
- Back/scroll restoration: browser history and URL-selected revision.

## Flow ledger

| Operation | Trigger | Pending | Success destination | Success feedback | Failure recovery | Focus outcome | Source ref |
|---|---|---|---|---|---|---|---|
| Publish | 发布帖子 | disabled submit | new post | post page | editor retains draft/error | route heading | V1 spec |
| Edit | 保存修改 | disabled submit | post page | edited time | IndexedDB + conflict UI | post heading | V3 spec |
| Use online | conflict choice + confirm | local state replacement | editor | conflict clears | confirmation can cancel | editor | V3 spec |
| Overwrite | conflict choice + confirm | disabled submit | post page | new revision | refreshed conflict if race repeats | post heading | V3 spec |
| Restore | 恢复此版本 + confirm | form pending | new revision preview | status notice | history remains unchanged | page heading | V3 spec |
| Delete post | 删除帖子 + confirm | disabled confirm | same URL with controlled placeholder | body removed; surviving discussion retained | retry is a no-op | refreshed article | V4 spec |
| Delete reply | 删除这条回复 + confirm | disabled confirm | same discussion | reply disappears or becomes a placeholder | retry is a no-op | refreshed thread | V4 spec |
| Hide/unhide | administrator action + confirm | disabled confirm | current admin filter | status badges and audit update | retry is a no-op | refreshed row | V4 spec |
| Restore deleted | administrator action + confirm | disabled confirm | current admin filter | current content becomes active unless still hidden | retry is a no-op | refreshed row | V4 spec |
| Upload | file input | local pending | editor | attachment row/inline image | inline upload error | file input/editor | V1 spec |
| Account menu | avatar button | n/a | selected route | menu closes | outside/Escape close | trigger restored on Escape | V3 addendum |
| Create annotation | select same-block text → 添加批注 | disabled duplicate publish | same post | range, card/sheet, Activity and author notification | selection conflict keeps正文 unchanged; choose again | active thread/card | V5 spec |
| Reply annotation | 回复批注 / 回复成员 | disabled duplicate publish | same thread | one-layer reply + direct-target notification | editor retains content/error | refreshed thread | V5 spec |
| Delete annotation | 删除批注 + confirm | disabled confirm | same post | no-thread anchor exits; dependent thread becomes placeholder | retry is a no-op | refreshed article/thread | V5 spec |
| Hide annotation | administrator action + confirm | disabled confirm | current admin filter | placeholder/audit; root creates annotation-state revision | retry is a no-op | refreshed row | V5 spec |
| Restore annotated revision | 恢复此版本 + annotation impact confirm | disabled confirm | new revision preview |正文、assets、anchors、states一起恢复 | transaction rollback and stale-version error | page heading | V5 spec |

## Navigation and responsive behavior

- Route document titles inherit site metadata; item-specific metadata is not expanded in V3.
- Forbidden administrator navigation is enforced server-side and returns to the community root under the current auth contract.
- Revision selection is URL-addressable; the route itself remains administrator-only.
- At 900px the revision timeline stacks above preview; at 640px dialogs and actions become one column.
- At 900px annotated reading removes sidebar/connectors and opens the selected thread in a bottom Sheet; native text selection and page scrolling remain available.
- Focus must remain visible below the sticky header; modal focus is trapped and restored.

## Overlays and feedback

- Dialog primitive: `ModalDialog` with modal semantics, focus cycle, Escape, backdrop dismissal, and trigger-focus restoration.
- Destructive confirmation: discard draft, overwrite latest, restore historical content, author delete, and administrator hide each require an app-owned confirmation with explicit discussion-retention copy.
- Alert/banner: local draft recovery and conflict blocking are persistent until resolved.
- Unsaved changes: device-local IndexedDB autosave; server post changes only after explicit save.
- Layer contract: header 400 < popover 450 < backdrop 500 < dialog 600.
- Annotation floating selection action uses popover 450; mobile Sheet reuses backdrop/dialog layers and focus contract.

## Async and resilience

- Mutation default: pessimistic UI with disabled duplicate submit.
- Annotation create/reply mutations use per-submit UUID keys; server-generated annotation IDs, revision CAS and one D1 batch prevent partial anchors/events/notifications.
- Idempotency: replies use submission keys; lifecycle retries are no-ops; audit transitions use dedupe keys; revision restore uses a per-confirmation operation ID in addition to revision uniqueness.
- Auto-save/draft recovery: 700ms IndexedDB debounce, explicit continue/discard prompt for published posts.
- Offline behavior: drafts may continue locally; server writes require connection.
- Version conflict: exact base revision check; no automatic merge; online/manual/explicit overwrite choices.
- Stale-request handling: component effects use live flags/cleanup; file upload errors remain local.
- Mutation failure: editor state and draft remain intact.
- Lifecycle mutations never use operation time as `last_activity_at`; reply removal/hide recalculates from remaining public reply publication times.
- Creating annotation or annotation reply updates `last_activity_at`; annotation structural revisions never update `edited_at`, never create post-edit notifications, and never bump activity by themselves.
- Asset deletion is never performed in content handlers. A bounded GC service rechecks current-post, revision, avatar, and temporary-expiry references immediately before deleting an R2 object.

## Validation

- Schema/validation layer: `lib/domain/rules.ts` plus server-side ownership/revision checks and structural AST validation in `lib/annotations/*`.
- Server errors: inline text; `EDIT_CONFLICT` maps to the comparison dialog.
- Sensitive values: opaque IDs remain hidden except in internal form values/URLs.
- Forms prevent duplicate submit; editor fields retain input after errors.
- Ordinary post create/update rejects annotation directives. Annotation creation re-parses current canonical Markdown, verifies exact base revision, one eligible text block, exact selected text and zero overlap before inserting a server-controlled ID.

## Permission and clipboard

- Revision list, preview, and restore are absent from ordinary UI and protected by `requireAdministrator()` on every page/action.
- No revision API is exposed to ordinary users.
- Deleted/hidden Markdown and historical-only assets are returned only through administrator-checked paths; public detail queries return placeholders with nullable content fields.
- Ordinary server actions enforce ownership for delete. Hide, unhide, restore, raw lifecycle lists, and audit history require `requireAdministrator()`.
- Current annotation membership is the `post_annotation_anchors` relation, not a nullable row heuristic. Notification/activity readers redact root or reply Markdown unless the target is visible and its root anchor belongs to the current revision.
- V5 temporarily blocks ordinary正文 editing whenever current anchors exist; V6 may lift the lock only by adding AnnotationGuard at the ProseMirror transaction boundary.
- Clipboard copy is not part of V3.

## Verification

- Required static commands: `npx tsc --noEmit`, `npm run lint`, `npm test`, strict premium audit, Sites checkpoint build.
- Accessibility: native semantics, keyboard dismissal, focus trap/restoration, forced-colors fallback.
- Canonical sibling flow: existing post edit flow and administrator allowlist sections.
- CRUD evidence: migration test, annotation round-trip/selection/lifecycle/revision tests, production artifact test, and Sites checkpoint build.
- Failure evidence: stale base, repeated race, draft discard confirmation, upload error, unauthorized route boundary.
