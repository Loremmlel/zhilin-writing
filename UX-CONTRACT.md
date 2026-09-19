# UX Contract

版本：2.1 · 2026-09-05。现行交互合同；视觉值以 [DESIGN.md](DESIGN.md) 为唯一规范入口。用户已接受公开版本的整体效果，本合同固定其交互语义，不把所有历史技术细节视为必须永久保留的实现方式。

## Cross-flow invariants

以下规则适用于新页面和现有页面。允许替换实现，但不得改变这些可观察行为；领域权限与数据安全继续以 Business-context sources 为依据。

| 规则                | 必须保持的交互                                                             | 评审时观察什么                                                                           |
| ------------------- | -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| U1 操作诚实         | 导航用链接、动作用按钮；可点击反馈与实际点击区域一致；图标有可访问名称     | PostCard 整行主链接可打开帖子，作者/标签/回复链接仍各自可用；不以 div click 模拟所有操作 |
| U2 提交唯一         | 同一操作只有一个提交所有者；pending禁止重复提交，文案保宽；失败保留输入    | 双击/慢响应不产生重复写入；错误出现后可继续编辑或重试                                    |
| U3 危险动作有边界   | 普通页面使用安静入口，最终确认说明对象、范围与后果，先聚焦安全选项         | 弹窗位于全局层；批量范围仅当前页，0选中不可提交，部分失败给准确结果                      |
| U4 草稿与服务端分离 | 自动本地草稿不宣称发布/同步完成；成功后才清空输入；冲突不静默覆盖          | 失败、离线、过期登录时保留可恢复工作；批注相关冲突禁止强覆盖                             |
| U5 导航可恢复       | 已提交查询/筛选/排序/页码由URL表达；修改筛选重置页码，数据变化后校准边界   | 刷新/返回恢复相同筛选；删除或未读数变化不落到虚假空页；不承诺结果快照                    |
| U6 输入不抢操作     | 中文组合输入期间Enter不触发提交或搜索；搜索显式提交，非空有即时清除        | 清除后返回未查询态和输入焦点；不自行改成逐字远程搜索                                     |
| U7 关联由稳定ID决定 | 批注范围、卡片、连线、Sheet、通知共享annotation_id；hover仅局部反馈        | 点击/键盘/深链才定位；默认无连线，激活/焦点最多一条，焦点优先；禁止文本搜索重定位        |
| U8 选区与讨论可持续 | 合法选区在创建、pending与失败期间可见；一个线程只有一个回复输入区          | 输入在根批注后、回复列表前；desktop/Sheet不双挂载可写线程；失败保留草稿                  |
| U9 响应式不改变语义 | 模式切换只重排表面，不改变权限、数据、提交次数或选中线程；滚动有明确所有者 | 焦点不被sticky遮挡；Sheet可关闭并恢复焦点；普通阅读不被hover自动滚走                     |
| U10 状态明确        | 加载、无内容、无结果、错误、不可用分开表达；危险/不可用信息不能只靠颜色    | 空态给真实下一步；错误给安全原因/恢复路径，必要时事件编号；无假成功或敏感原文泄漏        |

## State and recovery contract

| 状态           | 用户必须能知道                               | 恢复/退出                                                   |
| -------------- | -------------------------------------------- | ----------------------------------------------------------- |
| 路由或区域加载 | 哪个内容仍在载入；共享壳与已完成区域继续可用 | 几何匹配骨架与非阻塞进度，失败转可重试状态                  |
| 首次为空       | 这里尚无内容                                 | 根据权限提供写帖、返回浏览等已有动作；不为凑CTA新增功能     |
| 查询无结果     | 当前查询/筛选没有匹配项，而非系统失败        | 修改/清除查询或切换筛选，保留有用上下文                     |
| 提交中/失败    | 操作是否仍在进行、输入是否保留               | 操作就近pending；失败保留草稿和可修正错误；成功后才确认完成 |
| 删除/隐藏/失效 | 内容不可访问的具体类别                       | 中性占位，保留仍可见的讨论；不泄露历史正文                  |
| 冲突/权限变化  | 为什么无法继续提交，本地内容是否仍在         | 按既定冲突/重新登录流程恢复；不自动重试高风险写入           |

## Product context

- Audience: 少数受邀、彼此认识的中文用户；唯一管理员负责成员与内容保险。
- Primary jobs: 写作、阅读、回复、正文批注、恢复本地未提交修改；管理员检查和恢复历史版本。
- Target market(s): 私密中文社区。
- Active locales: `zh-CN`。
- Language/content register: 直白、安静、非营销式中文；管理员界面可保留少量准确英文术语。
- Timezone/calendar policy: 时间经项目 `formatDateTime()` / `formatListDateTime()` 按 `Asia/Shanghai` 统一展示；管理员日期筛选使用北京时间（UTC+8）公历自然日，起止日均包含。
- Accessibility target: WCAG 2.2 AA。

## Business-context sources

| Domain / scope                         | Authoritative source                                                                                         | Source type                  | Reviewed date |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------- | ------------- |
| V1 产品、权限与数据基础                | `docs/superpowers/specs/2026-08-25-private-markdown-community-design.md`                                     | Product/design spec          | 2026-08-25    |
| V2 Activity 与通知                     | `docs/superpowers/specs/2026-08-25-activity-notifications-v2-design.md`                                      | Product/design spec          | 2026-08-25    |
| V3 revision、冲突与恢复                | `docs/superpowers/specs/2026-08-25-post-revisions-v3-design.md`                                              | Product/design spec          | 2026-08-25    |
| V4 内容生命周期与资源回收              | `docs/superpowers/specs/2026-08-26-content-lifecycle-v4-design.md`                                           | Product/design spec          | 2026-08-26    |
| V5 Annotation AST、正文批注与讨论      | `docs/superpowers/specs/2026-08-27-annotation-v5-design.md`                                                  | Product/design spec          | 2026-08-27    |
| V6 AnnotationGuard、批注编辑与 Loading | `docs/superpowers/specs/2026-08-31-annotation-guard-v6-design.md`                                            | Product/design spec          | 2026-08-31    |
| V8 跨段批注                            | `docs/superpowers/specs/2026-09-03-cross-block-annotation-v8-design.md`                                      | Product/design spec          | 2026-09-03    |
| 管理员筛选、批量管理与永久删除         | `docs/superpowers/specs/2026-09-04-admin-content-management-design.md`                                       | Product/design spec          | 2026-09-04    |
| 服务器权限边界                         | `lib/auth/access.ts`                                                                                         | Verified domain invariant    | 2026-08-25    |
| 保存、删除、隐藏与恢复状态机           | `lib/posts/service.ts`, `lib/lifecycle/service.ts`, `lib/revisions/service.ts`, `lib/annotations/service.ts` | Verified API/domain contract | 2026-08-27    |

## Visual contract

- Project `DESIGN.md`: `DESIGN.md`。
- Token ownership model: DESIGN.md 记录规范，运行时 CSS 为实现源。
- Runtime design-system/token source: `app/globals.css :root` 与共享组件。
- Mapping/export/adapters: 手工一对一映射；审计检查漂移。
- Token drift gate: strict premium UI audit、构建与代码评审。
- Supported themes: 浅色与 forced-colors；不声明暗色主题。
- Design-context owner/review policy: 新增持久视觉/行为决策时同一变更更新本合同。

只在 DESIGN.md 维护尺寸、颜色、字体、圆角与层级数值；本合同仅引用其命名布局与状态。通用“最佳实践”不能覆盖已批准的项目交互，例如显式搜索、本地草稿、两层普通回复和单列帖子浏览。

## Canonical UI Map

| Capability                 | Canonical owner                              | Source of truth                                                                                                   | Allowed variants                                         | Verification                                |
| -------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------- |
| Page heading / post list   | `PageHeader` / `PostCard`                    | `components/page-header.tsx`, `components/post-card.tsx`                                                          | title/count/actions；published/active                    | sibling visual comparison + semantic links  |
| Community search           | `SearchForm` / `HeaderSearch`                | `components/search-form.tsx`                                                                                      | compact/page                                             | clear + IME + URL restoration               |
| Community pagination       | `Pagination` + query helpers                 | `components/pagination.tsx`, `lib/pagination.ts`, `lib/page-navigation.ts`, `db/queries.ts`                       | six community list types                                 | real query pagination tests + navigation    |
| Submit feedback            | `PendingSubmitButton`                        | `components/pending/pending-submit-button.tsx`                                                                    | pending/upload/conflict labels                           | duplicate prevention + stable dimensions    |
| Sticky offset              | `HeaderHeight`                               | `components/header-height.tsx`, `app/globals.css`                                                                 | measured Header with responsive search                   | expanded Header + focus visibility          |
| Form                       | `PostEditorForm` 与现有 server actions       | `components/editor/post-editor-form.tsx`                                                                          | new / edit / conflict                                    | unit + build                                |
| Scrollbar                  | global baseline + admin table scroll owner   | `app/globals.css`                                                                                                 | document / bounded admin panel / dual-axis table         | static audit                                |
| Dialog                     | `ModalDialog`                                | `components/modal-dialog.tsx`                                                                                     | dialog / alertdialog                                     | keyboard policy + build                     |
| CRUD                       | post/revision + admin purge services         | `lib/posts/service.ts`, `lib/revisions/service.ts`, `lib/admin/purge-service.ts`                                  | create / edit / restore / administrator purge            | unit + transaction review + build           |
| Upload                     | Markdown editor and attachment upload        | `/api/assets`, `lib/assets/storage.ts`                                                                            | inline image / attachment                                | service + build                             |
| Account popover            | `AccountMenu`                                | `components/account-menu.tsx`                                                                                     | member / administrator links                             | dismissal unit test                         |
| Lifecycle                  | lifecycle policy/service                     | `lib/lifecycle/*`                                                                                                 | normal / user deleted / admin hidden                     | unit + migration + build                    |
| Admin shell                | `AdminShell`                                 | `components/admin/admin-shell.tsx`, `lib/admin/query.ts`                                                          | overview / content / members / audit                     | parser unit + build                         |
| Moderation                 | administrator content management             | `app/(site)/admin`, `components/admin/content-lifecycle-control.tsx`, `components/admin/admin-bulk-selection.tsx` | hide / unhide / restore / purge / current-page bulk      | server permission + build                   |
| Admin table/search         | shared native semantic table                 | `components/admin/admin-content-table.tsx`, `components/admin/admin-search-form.tsx`                              | status / date / query / newest-oldest / page / selection | parser + policy unit + build                |
| Asset access and GC        | reference-aware asset services               | `lib/assets/access-service.ts`, `lib/assets/gc.ts`                                                                | active / historical / temporary / orphan                 | unit + service review                       |
| Annotation AST/selection   | annotation Markdown and structural selection | `lib/annotations/markdown.ts`, `lib/annotations/span.ts`, `lib/annotations/selection.ts`                          | single-block / consecutive cross-block                   | round-trip + selection unit                 |
| Annotation reading         | `AnnotationReadingLayout`                    | `components/annotations/annotation-reading-layout.tsx`                                                            | desktop sidebar / mobile sheet                           | unit + build + browser                      |
| Annotation lifecycle       | annotation service and shared moderation     | `lib/annotations/service.ts`, `components/admin/content-lifecycle-control.tsx`                                    | create / reply / delete / hide / unhide / restore        | unit + transaction review                   |
| Annotated editing          | `AnnotationGuard` + authoritative post save  | `lib/editor/annotation-guard.ts`, `lib/editor/annotation-session.ts`, `lib/posts/service.ts`                      | safe edit / confirmed retirement / conflict              | inspector + integration + transaction tests |
| Route loading and recovery | shared loading/error surfaces                | `components/loading/*`, `components/error-state.tsx`, App Router `loading.tsx` / `error.tsx`                      | route / independent region / global recovery / not-found | static contract + build + rendered smoke    |

## Component behavior

| Component             | Default                                               | Hover                      | Focus                       | Active                           | Disabled                             | Busy                                 | Error                            |
| --------------------- | ----------------------------------------------------- | -------------------------- | --------------------------- | -------------------------------- | ------------------------------------ | ------------------------------------ | -------------------------------- |
| Button                | labelled action                                       | tone strengthens           | visible native/project ring | tone/selected state; no movement | non-interactive, reduced opacity     | fixed width, progress copy           | inline actionable copy           |
| Input                 | white paper field                                     | border visible             | green ring                  | n/a                              | non-interactive                      | submit owns pending                  | text + `aria-invalid`            |
| Search                | explicit submit                                       | border visible             | green ring                  | n/a                              | n/a                                  | route transition                     | results/empty state              |
| Admin table           | sticky header/select/action columns; fixed previews   | row tone                   | native checkbox/action ring | current-page selection count     | bulk actions disabled at zero        | bounded pessimistic mutation         | exact counts + incident ID       |
| Textarea/editor       | fixed authored surface                                | n/a                        | green boundary/editor focus | n/a                              | read-only when required              | local draft status                   | retained content + inline error  |
| List/timeline         | readable rows                                         | border/tone change         | link focus                  | selected green surface           | n/a                                  | stable footprint                     | empty explanatory copy           |
| Annotation range      | one or more linked pale red marks + dotted underline  | local visual emphasis only | visible ring                | click/keyboard links card/ranges | creation menu withheld on overlap    | composer submit disabled             | explicit conflict/selection copy |
| Annotation card/sheet | author, time, content, replies; no selected-text copy | linked range highlight     | visible card focus          | stable ID selected               | unavailable content uses placeholder | fixed-size publish action            | input retained with inline error |
| Skeleton              | final-layout geometry                                 | n/a                        | n/a                         | static paper-tone surface        | n/a                                  | delayed subtle shimmer + `aria-busy` | replaced by safe recovery card   |

## Dataset navigation

- Admin revision list: per-post bounded timeline; community size is intentionally only a few users/posts, so V3 does not add pagination.
- Community post/search/tag/profile-post/activity/notification lists use real 20-row pages, returning items/total/page/pageSize. COUNT and rows share filters; current-page tags, ordinary reply counts, and current-revision annotation counts are fetched in batches. D1 projections stay below 100 columns.
- Positive safe integers only for page; malformed input→1, overflow→last page, empty→1. Canonical redirects retain valid query/sort/tab. Sort/query/tab changes reset page. Deletion, visibility and unread changes recompute bounds. Stable timestamp DESC + id DESC ordering; offset pagination does not promise snapshots.
- URL state: home `sort=active&page=2`, search `q=词&page=2`, tag `page=2`, user `tab=activity&page=2`, notifications `tab=unread&page=2`. First page/default filters may be omitted. Browser back preserves source URL; an all-posts link must not claim to restore the previous search.
- Search explicitly submits title/body terms, suppresses Enter during IME composition, labels inputs and exposes clear immediately for nonempty text. Clear resets page and returns search to its unqueried prompt; no new author/reply search scope.
- Lists use absolute short dates (omit current year) with semantic datetime and accessible full time; details/admin use full year. No timer or persisted timestamp changes.
- URL state: selected revision lives in `?revision=`; search query remains `?q=`.
- Admin root is the overview. Content types live only in the left navigation; members use `?section=members` and logs use `?section=audit`.
- Admin content filters live in `?type=posts|replies|annotations|annotation-replies&status=all|normal|deleted|hidden&q=<term>&sort=newest|oldest&from=YYYY-MM-DD&to=YYYY-MM-DD&page=<n>`. Lists use server pagination with 20 rows; invalid values fall back safely, reversed valid dates normalize to chronological order, and out-of-range pages clamp to the last page. Deleted and hidden filters may each include an item when both flags are present.
- 帖子/普通回复按发布时间筛选；批注/批注回复按 `source_created_at ?? created_at` 筛选、排序和显示。日期输入使用原生 `type=date`，浏览器拥有日期选择弹层。
- Admin sorting deliberately uses a native `<select>`; the operating-system-owned option popup and geometry are accepted because it contains only the two ordinary newest/oldest choices.
- Annotation notification/deep-link state lives in `?annotation=<opaque-id>`; unavailable historical targets use `?notice=annotation-unavailable` and never text search.
- Empty/no-results: stable explanatory card or inline notice. Route and independently streamed data loading: geometry-matched shared Skeleton; error: safe recovery card with retry and home action.
- Back/scroll restoration: browser history and URL-selected revision.

## Flow ledger

| Operation                    | Trigger                                               | Pending                            | Success destination                  | Success feedback                                                | Failure recovery                                     | Focus outcome               | Source ref   |
| ---------------------------- | ----------------------------------------------------- | ---------------------------------- | ------------------------------------ | --------------------------------------------------------------- | ---------------------------------------------------- | --------------------------- | ------------ |
| Publish                      | 发布帖子                                              | disabled submit                    | new post                             | post page                                                       | editor retains draft/error                           | route heading               | V1 spec      |
| Edit                         | 保存修改                                              | disabled submit                    | post page                            | edited time                                                     | IndexedDB + conflict UI                              | post heading                | V3 + V6 spec |
| Retire annotation by editing | 破坏受保护端点 → 确认 → 保存修改                      | 本地待撤下，保存时 disabled submit | post page                            | anchor/thread 退出当前版本，revision 保留历史                   | Undo/放弃草稿恢复；失败保留 IndexedDB                | 安全取消按钮 / post heading | V6 spec      |
| Use online                   | conflict choice + confirm                             | local state replacement            | editor                               | conflict clears                                                 | confirmation can cancel                              | editor                      | V3 spec      |
| Overwrite                    | conflict choice + confirm；仅基础区间无批注变化时提供 | disabled submit                    | post page                            | new revision                                                    | refreshed conflict if race repeats                   | post heading                | V3 + V6 spec |
| Annotation-change conflict   | conflict dialog                                       | local draft remains available      | current editor                       | explains why overwrite is unavailable                           | load latest and manually reapply                     | safe/manual choice          | V6 spec      |
| Restore                      | 恢复此版本 + confirm                                  | form pending                       | new revision preview                 | status notice                                                   | history remains unchanged                            | page heading                | V3 spec      |
| Delete post                  | 删除帖子 + confirm                                    | disabled confirm                   | same URL with controlled placeholder | body removed; surviving discussion retained                     | retry is a no-op                                     | refreshed article           | V4 spec      |
| Delete reply                 | 删除 + confirm                                        | disabled confirm                   | same discussion                      | reply disappears or becomes a placeholder                       | retry is a no-op                                     | refreshed thread            | V4 spec      |
| Hide/unhide                  | administrator action + confirm                        | disabled confirm                   | current admin filter                 | status badges and audit update                                  | retry is a no-op                                     | refreshed row               | V4 spec      |
| Restore deleted              | administrator action + confirm                        | disabled confirm                   | current admin filter                 | current content becomes active unless still hidden              | retry is a no-op                                     | refreshed row               | V4 spec      |
| Bulk hide                    | select current-page rows + confirm                    | disabled confirm                   | current admin filter                 | exact processed/skipped/failed counts                           | failed rows remain retryable with incident ID        | refreshed table             | Admin spec   |
| Permanent delete             | single or current-page rows + irreversible confirm    | disabled confirm                   | current admin filter                 | target graph removed; audit retained; exact counts              | completed targets become safe no-ops on retry        | refreshed table             | Admin spec   |
| Remove allowlist access      | 移除 + confirm                                        | disabled confirm                   | current administrator view           | access revoked; existing content and profile retained           | inline error; access unchanged                       | refreshed member row        | Admin plan   |
| Upload                       | file input                                            | local pending；失败项阻止正式提交  | editor                               | attachment row/inline image                                     | inline upload error；重试或移除后解除阻止            | file input/editor           | V1 spec      |
| Account menu                 | avatar button                                         | n/a                                | selected route                       | menu closes                                                     | outside/Escape close                                 | trigger restored on Escape  | V3 addendum  |
| Create annotation            | select consecutive supported body text → 添加批注     | disabled duplicate publish         | same post                            | linked ranges, one card/sheet, Activity and author notification | selection conflict keeps正文 unchanged; choose again | active thread/card          | V5 + V8 spec |
| Reply annotation             | 回复；当前线程明确根批注或目标成员                    | disabled duplicate publish         | same thread                          | one-layer reply + direct-target notification                    | editor retains content/error；可明确取消回复         | refreshed thread            | V5 spec      |
| Delete annotation            | 删除 + confirm                                        | disabled confirm                   | same post                            | no-thread anchor exits; dependent thread becomes placeholder    | retry is a no-op                                     | refreshed article/thread    | V5 spec      |
| Hide annotation              | administrator action + confirm                        | disabled confirm                   | current admin filter                 | placeholder/audit; root creates annotation-state revision       | retry is a no-op                                     | refreshed row               | V5 spec      |
| Restore annotated revision   | 恢复此版本 + annotation impact confirm                | disabled confirm                   | new revision preview                 | 正文、assets、anchors、states一起恢复                           | transaction rollback and stale-version error         | page heading                | V5 spec      |
| Parse DOCX                   | 选择 `.docx`                                          | staged Worker progress + cancel    | import Preview                       | canonical rendering, annotations and warnings                   | typed error; original file remains local             | Preview heading             | V5.5 spec    |
| Resume DOCX Preview          | 打开导入页并选择 24h 内草稿                           | local IndexedDB load               | import Preview                       | same batch/UUIDs/assets restored                                | discard stale/invalid Preview                        | Preview heading             | V5.5 spec    |
| Confirm DOCX import          | 确认导入                                              | disabled duplicate submit          | new post                             | one initial revision + POST_CREATED                             | Preview retained; R2 objects stay temporary          | post heading                | V5.5 spec    |
| Map Word author              | 关联站内用户                                          | local validation                   | same Preview                         | source identity remains visible                                 | mapping retained with inline error                   | mapping control             | V5.5 spec    |
| Read DOCX attribution notice | 通知列表或详情                                        | 标记已读                           | imported post                        | 汇总显示关联批注数量与导入者                                    | 帖子不可访问时保留历史通知占位                       | 通知详情标题                | V5.5 spec    |

## Navigation and responsive behavior

- 管理总览、内容类型、成员、日志和历史版本都提供诚实的页面标题；普通页面也使用本地化任务标题；受保护详情使用不暴露正文的通用标题。
- Forbidden administrator navigation is enforced server-side and returns to the community root under the current auth contract.
- Revision selection is URL-addressable; the route itself remains administrator-only.
- The admin shell keeps one left navigation for overview, four content types, members, and audit. Content screens do not repeat an administrator/title/description masthead; their status tabs and compact, consistently labelled filters begin at the top of the work area. The optional summary rail yields space according to DESIGN.md Layout.
- Administrator routes omit the community footer and occupy the remaining viewport below the sticky Header. The document does not scroll: content tables own both axes; overview, member, audit and summary panels own their local vertical overflow. At 640px and below, the administrator main region becomes the vertical owner so stacked filters cannot collapse the table viewport; the table keeps its own bounded dual-axis scroll area.
- Admin tables preserve status, committed query, inclusive Beijing date range, sort and page in the URL. The header, left selection column and right operation column stay visible while the table scrolls. Preview body and quote each use a fixed two-line region; other cells grow naturally instead of clipping status, time or reason. Operations remain reachable and never wrap vertically; dimensions follow DESIGN.md Layout. On narrow screens, bulk guidance occupies its own row and the two bulk actions share the following row without changing their scope or semantics.
- Revision timeline and dialog/action stacking follow DESIGN.md Layout; narrowing the viewport must not remove version selection, confirmation or cancellation.
- Annotation reading derives one layout mode from its actual container, using DESIGN.md Layout and `lib/annotations/responsive.ts`. Below the defined threshold it removes sidebar/connectors and opens the selected thread in a bottom Sheet. Hover never changes scroll position; click, keyboard activation and deep links may locate the linked card/range. CSS, connector logic and sheet behavior consume this same mode; native text selection and page scrolling remain available.
- DOCX Preview follows the actual-container stacking rule in DESIGN.md Layout, not the old 900px viewport rule. Parsing/validation/mapping state and import batch IDs survive layout changes; blocking checks appear before thread discussion, with the relevant correction action accessible from the error.
- Focus must remain visible below the sticky header; modal focus is trapped and restored.

## Overlays and feedback

- Dialog primitive: `ModalDialog` portals to `document.body` and owns the global backdrop/dialog layers, with modal semantics, focus cycle, Escape, backdrop dismissal, and trigger-focus restoration.
- Destructive confirmation: discard draft, overwrite latest, restore historical content, author delete, administrator hide, and administrator purge each require an app-owned confirmation. Purge copy states irreversibility and the target-specific cascade; it has no Undo.
- Alert/banner: local draft recovery and conflict blocking are persistent until resolved.
- Unsaved changes: device-local IndexedDB autosave; server post changes only after explicit save.
- Reading/editor papers occupy the same first column with or without annotations. Below the measured threshold only the Sheet thread mounts; desktop and Sheet never mount two writable thread inputs simultaneously. Default connector count is zero; selected/focused thread produces at most one, thread focus takes priority and leaving it restores the selected ID. Hover stays local.
- Header and inner-column alignment follow DESIGN.md Layout. Editor actions remain sticky below measured Header, toolbar flows normally, title/tags precede body, attachments follow it, and the original draft/conflict/submit ownership remains unchanged.
- Plain replies retain root + one nested level, no new collapsing/paging, composer before reply list. Root and nested reply actions use the same “回复 → 删除” order; an opened composer has an explicit cancel action. Deleted roots keep neutral placeholders and surviving discussion.
- Layer values follow DESIGN.md Elevation & Depth. Annotation floating selection action uses the popover layer; mobile Sheet reuses backdrop/dialog layers and focus contract.
- DOCX parsing progress is inline and cancellable; unsafe or over-limit files use a persistent typed error, never a partial Preview.

## Async and resilience

- Route navigation starts a non-blocking 2px accent progress bridge immediately; it follows Vinext's
  RSC response and navigation promise, resets on failure/cancel/unload/timeout, and ignores hash-only
  navigation. App Router segment `loading.tsx` remains the authoritative route fallback.
- Post body/annotation rail, post replies, notifications, profile activity/posts, administrator lists, administrator summary panels, and revision preview use local Suspense fallbacks so the shared layout or already-resolved region stays available.
- Skeletons keep stable geometry, expose `aria-busy` plus readable status, delay shimmer, and become static under `prefers-reduced-motion`.
- Route, site, and global error boundaries never render exception messages, stack traces, database identifiers, or raw causes; recovery is retry plus return-home, with a dedicated missing/expired-login explanation at the site boundary.
- Ordinary post reading defers the Milkdown bundle until a member explicitly opens a reply or annotation composer; editor-load failure stays local and retryable. Post edit and DOCX Preview load it immediately because editing is their primary task.
- Mutation default: pessimistic UI with disabled duplicate submit.
- Annotation create/reply mutations use per-submit UUID keys; server-generated annotation IDs, revision CAS and one D1 batch prevent partial anchors/events/notifications.
- Idempotency: replies use submission keys; lifecycle retries are no-ops; audit transitions use dedupe keys; revision restore uses a per-confirmation operation ID in addition to revision uniqueness.
- 管理员批量操作只接受当前页最多 20 个去重 ID。永久删除按目标事务执行并写入不含原文的 dedupe audit；部分失败返回准确计数和安全事件编号。
- Auto-save/draft recovery: 700ms IndexedDB debounce, explicit continue/discard prompt for published posts. “退出编辑” immediately saves the current snapshot before navigation and stays on the page when that save fails.
- Offline behavior: drafts may continue locally; server writes require connection.
- Version conflict: exact base revision check; no automatic merge。普通正文冲突提供 online/manual/explicit overwrite；若基础版本到当前版本之间发生任何 Annotation membership、anchor text 或 lifecycle 变化，服务端与界面都禁用 force overwrite，IndexedDB 本地草稿继续保留。
- Stale-request handling: component effects use live flags/cleanup; file upload errors remain local and block post submission until retried or removed.
- Mutation failure: editor state and draft remain intact.
- DOCX parsing runs in a browser Worker with a 20-second hard timeout. User cancellation returns to file selection without a failure banner; unknown parser errors use actionable Chinese fallback copy and never expose raw worker messages. Import Preview persists in IndexedDB for 24 hours without the original binary; successful commit deletes the Preview record.
- DOCX image uploads use existing temporary R2 assets. D1 failure leaves them temporary for the existing seven-day GC rather than attempting a cross-storage rollback.
- `import_batch_id` and Preview-generated annotation/reply UUIDs remain stable across refresh and retry; duplicate commit returns the same post.
- Lifecycle mutations never use operation time as `last_activity_at`; reply removal/hide recalculates from remaining public reply publication times.
- Creating annotation or annotation reply updates `last_activity_at`; annotation structural revisions never update `edited_at`, never create post-edit notifications, and never bump activity by themselves.
- Asset deletion is never performed in content handlers. A bounded GC service rechecks current-post, revision, avatar, and temporary-expiry references immediately before deleting an R2 object.
- 管理员永久删除帖子只解除 D1 资源引用与 `assets.post_id`；无引用对象继续由既有 GC 异步回收。删除子内容后按剩余公开内容的原始发表时间重算帖子活动时间。

## Validation

- Schema/validation layer: `lib/domain/rules.ts` plus server-side ownership/revision checks and structural AST validation in `lib/annotations/*`.
- Server errors: inline text; `EDIT_CONFLICT` maps to the comparison dialog.
- Sensitive values: opaque IDs remain hidden except in internal form values/URLs.
- Forms prevent duplicate submit; editor fields retain input after errors.
- Ordinary post create/update rejects annotation directives. Annotation creation re-parses current canonical Markdown, verifies exact base revision, one or more consecutive eligible text blocks, exact selected text and zero overlap before inserting a server-controlled ID into every selected block.
- A logical cross-block annotation uses one stable ID, one database thread/anchor and consecutive inline Markdown segments. The first segment reaches the first block's final visible character, intermediate segments cover their full visible text, and the last begins at its block's first visible character. Code, tables, images, attachments, hard breaks and unsupported blocks are barriers.
- DOCX Commit treats browser IR as untrusted: it revalidates schema, Markdown AST, logical cross-block annotation topology and aggregate selected text, imported `author_id=NULL`, attribution membership, temporary asset ownership, safe links, counts, sizes and batch idempotency without re-uploading or re-parsing the source DOCX.

## Permission and clipboard

- Revision list, preview, and restore are absent from ordinary UI and protected by `requireAdministrator()` on every page/action.
- No revision API is exposed to ordinary users.
- Deleted/hidden Markdown and historical-only assets are returned only through administrator-checked paths; public detail queries return placeholders with nullable content fields.
- Ordinary server actions enforce ownership for delete. Hide, unhide, restore, purge, bulk operations, raw lifecycle lists, and audit history require administrator access on the server.
- Current annotation membership is the `post_annotation_anchors` relation, not a nullable row heuristic. Notification/activity readers redact root or reply Markdown unless the target is visible and its root anchor belongs to the current revision.
- 带批注正文只允许帖子作者从受控编辑页修改；客户端 AnnotationGuard 负责交互保护，服务端仍重新验证 canonical AST、ownership、confirmed delta、base revision 与 conflict interval。
- Imported Annotation/Reply is immutable and always identifies its Word source. Attribution grants no ownership or lifecycle permission; the Post author may remove an imported thread without cascading to later native replies.
- Copy/Paste/Cut/Drop 的富文本 Slice 必须剥离 Annotation Mark 与 ID；普通文本和受支持格式保留，新的 Annotation 只能由受控创建、DOCX Import 或 Revision Restore 产生。

## 正文格式合同（2026-09-08）

- 共享 MarkdownEditor 在新建、带批注编辑及 DOCX 预览的 Crepe 顶部工具栏和框选浮动工具栏提供字号、文字颜色与居中；compact 回复/批注 composer 不启用这组控件。每个选择器的“默认”只重置该属性，混合选区显示“混合”。适用既有 U1–U10 中共享所有权、草稿保留、焦点与输入恢复要求。
- 字号允许 6–72pt、0.5pt 步长；自定义颜色允许六位 HEX，原生选择器只修改输入草稿。选择预设立即应用；自定义在同一工具按钮旁的非模态面板输入，直到点击应用或输入框 Enter 才提交，非法输入保留等待修正。取消/Escape 不改文档并将焦点还给按钮；点击外部或 Tab 离开面板取消并保留外部焦点；应用后恢复正文选区和焦点。面板不锁页面、不设焦点陷阱；随滚动、缩放与可视视口变化避让边缘，所属工具栏隐藏或编辑器锁定时关闭。控件 Enter 不提交帖子，组合输入期间不应用。
- 两处入口调用同一组命令，字号、颜色与居中状态同步；框选栏沿用 Crepe 非空文字选区规则，顶部入口同时覆盖光标与矩形单元格选区。工具栏按钮支持键盘激活，按下指针后的 click 不重复应用。工具栏保留并映射正文选区；选区被删除或编辑器重建后不得使用旧坐标套用格式。焦点离开控件时释放临时装饰。文字格式只改选中文字；光标状态只更新后续输入 marks；居中更新实际选中段落/标题/单元格，结束于下一段开头时不包含下一段。选区含代码、图片等不支持内容时整体禁用，不静默部分应用。
- 每次格式应用是一项撤销操作；字号和颜色互相保留，格式修改不删除批注 ID、不触发批注删除确认。格式改变影响批注结构状态签名，继续参与已有编辑冲突保护。只读、提交禁用、上传及待处理批注影响确认期间禁用新控件。
- canonical Markdown 持久化受限 directive；服务端校验值，渲染器仅生成受控 CSS，任意 HTML/CSS 继续关闭。居中规范化到原块，不改变批注段落编号；批注跨多个文字格式仍保持一个逻辑 ID。复制/粘贴剥离批注身份，保留受支持格式。
- DOCX 未指定格式使用站点默认值，auto 颜色清除固定色继承；非法字号、主题/颜色无法解析或过浅、无法保留的对齐给合并提示。可选 IR 字段兼容旧 v1 缓存。历史记录保持 Markdown；回滚代码必须保留新格式读写能力，不能用旧版本无损解释新内容。

## Verification

- Verification is scoped to the change: documentation-only work checks contracts, source mappings, links and formatting; product-source work runs relevant typecheck/lint/tests, with build and actual-browser checks when runtime/visual behavior changes. Typical commands: `npx tsc --noEmit`, `npm run lint`, `npm test`, strict premium audit, Sites checkpoint build. Static audit never proves the runtime flow.
- Accessibility: native semantics, keyboard dismissal, focus trap/restoration, forced-colors fallback.
- Canonical sibling flow: existing post edit flow and administrator allowlist sections.
- CRUD evidence: admin purge policy tests, annotation round-trip/selection/lifecycle/revision tests, static cascade review, production artifact test, and Sites checkpoint build.
- Failure evidence: stale base, repeated race, draft discard confirmation, upload error, unauthorized route boundary.

## Contract changes and acceptance

- 新增流程先选择已有 Canonical UI Map 所有者与 U1–U10；需要新行为时，先说明可观察差异与领域依据，并在同一变更同步合同、共享实现和必要验证。不得复制一个页面组件后形成隐形变体。
- Flow ledger 记录动作和结果；不承担页面像素规格。新增页面只增加真正不同的流程，不重复登记同一搜索、分页或弹窗行为。
- 评审至少覆盖被修改规则的一次成功和一次相关失败/取消路径；共享行为同时核对一个同类调用方。仅当改动涉及对应风险时扩展到IME、Sheet切换、离线、冲突、权限等矩阵。
- 完成记录须区分工程检查、用户验收与代理浏览器证据。2026-09-05 Version 33已公开发布，用户反馈整体无问题；这不等价于全设备、全状态或性能验收。后续只为具体改动补相关证据。

## 帖子可见范围（2026-09-19）

来源：[帖子白名单需求与实施说明](docs/plans/post-visibility-allowlist.md)。新建、编辑和 DOCX 确认导入共用 `PostVisibilityField` 的原生单选/复选框，所有用户与指定用户两种模式；候选不包含管理员，作者自动勾选且不可取消。空名单清楚提示仅作者与管理员可见。设置随正式保存生效，草稿/导入恢复保留，失败不丢失。修改范围使用既有版本冲突保护；恢复历史正文保持当前可见范围。未经授权的列表、计数、通知、直达内容与附件均不返回私密内容，沿用站点不可用页面。候选只提供 ID 和昵称。适用 U2/U4/U9/U10。
