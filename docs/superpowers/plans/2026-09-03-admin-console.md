# Admin Console Implementation Plan

**Goal:** 把当前纵向堆叠的窄版 `/admin` 页面改造成真正可长期使用的管理后台：保留站点顶部导航，在后台主体中提供左侧模块导航、中间主工作区，以及仅在有实际信息时出现的右侧管理员辅助区；所有功能严格建立在现有权限、内容生命周期、白名单与审计数据上。

**Branch:** `feature/admin-console`

**Architecture:** 保留现有 Next.js App Router、Server Component、Server Action、D1 查询和 `ModalDialog`。继续以单个 `/admin` 路由及 URL 查询参数承载后台各视图，避免为低频小型后台新增客户端状态框架或大量路由。内容类型由左侧导航选择；主表只保留状态、搜索和排序，不再重复一套内容类型 segment。现有 `/admin/revisions/[postId]` 继续作为管理员专用详情路由。

**Tech Stack:** TypeScript 5.9、React 19、Next.js 16 App Router（Vinext）、Drizzle ORM、Cloudflare D1、现有 CSS token 与共享 `ModalDialog`。

## 1. 已确认的仓库基线

- 当前 `/admin` 是宽度 840px 的单页，依次纵向堆叠内容管理、操作日志、邀请邮箱和已注册成员。
- 内容管理已经覆盖 Posts、Replies、Annotations、Annotation replies，但每类查询固定最多返回 100 条；没有搜索、排序、总数和分页。
- 管理员能力已经存在：
  - 帖子：查看、查看历史版本、恢复作者删除、隐藏、取消隐藏。
  - 普通回复：查看原文、定位所属帖子、恢复作者删除、隐藏、取消隐藏。
  - 批注：查看原文、定位所属帖子、隐藏、取消隐藏。
  - 批注回复：查看原文、定位所属帖子、隐藏、取消隐藏。
- 批注及批注回复没有“管理员恢复作者删除”的领域操作；新界面不得伪造该按钮。
- `deleted_at` 与 `hidden_at` 是两个独立状态，可以同时存在。管理员界面必须同时显示两个标记；取消隐藏不能重新公开作者已经删除的内容。
- 子内容还需要显示所属帖子的删除/隐藏状态；批注需要额外区分是否仍属于当前正文 revision。
- 白名单支持添加、移除非管理员邮箱；唯一管理员不可移除。移除白名单会撤销后续访问，但不会删除该成员已经创建的内容。
- 审计日志当前记录内容隐藏、取消隐藏、恢复及 revision 恢复，不记录普通用户操作，也不记录白名单变更。
- 当前设计合同已经指定：简体中文、校刊纸张与校园绿、克制的产品界面、WCAG 2.2 AA、共享 Loading/Error/ModalDialog；本次不重新设计品牌。

## 2. 对参考图的取舍

### 采用

- 顶部继续使用普通站点 Header，使管理员仍处于“知临中学”站点上下文中。
- 后台主体采用左侧导航 + 主工作区；宽屏下主工作区可再带一个窄的管理员辅助栏。
- 左侧直接列出帖子、回复、批注、批注回复，使管理对象始终明确。
- 内容主区使用紧凑工具栏、语义化数据表、状态徽标和分页。
- 右侧只放现有真实数据能够支撑的白名单快捷入口、最近操作和最近加入成员。

### 不采用

- 不实现“待审核”“举报 / 审核”，因为当前没有举报、审核队列或审核状态模型。
- 不实现“系统设置”，因为当前没有可配置的系统设置模型。
- 不实现硬删除、批量选择、批量处理和表格复选框；现有生命周期明确禁止普通内容 hard delete，也没有批量 mutation。
- 不实现截图中的“较昨日变化”、虚构趋势或无业务意义的“今日新增”指标。
- 不实现版块筛选和日期区间筛选；站点没有版块模型，当前社区规模也不足以证明日期筛选的必要性。
- 不复制通用 SaaS 仪表盘的巨型数字、渐变或重阴影；统计只作为安静的信息摘要。

## 3. 信息架构与 URL 合同

| 左侧入口     | URL                                            | 主区内容                                 |
| ------------ | ---------------------------------------------- | ---------------------------------------- |
| 总览         | `/admin` 或 `/admin?section=overview`          | 四类内容数量与状态分布、最近管理动作摘要 |
| 帖子         | `/admin?type=posts&status=normal`              | 帖子管理表                               |
| 回复         | `/admin?type=replies&status=normal`            | 回复管理表                               |
| 批注         | `/admin?type=annotations&status=normal`        | 批注管理表                               |
| 批注回复     | `/admin?type=annotation-replies&status=normal` | 批注回复管理表                           |
| 用户与白名单 | `/admin?section=members`                       | 白名单和注册成员管理                     |
| 操作日志     | `/admin?section=audit`                         | 完整管理员审计列表                       |

内容列表继续使用既有 `type` / `status` 合同，并增加：

- `q`：当前内容类型内的关键词；上限和空白归一化在服务端处理。
- `sort=newest|oldest`：单一时间排序，默认 `newest`。
- `page`：从 1 开始的服务端分页；筛选或搜索变化时回到第 1 页。

`status` 保留 `normal|deleted|hidden`。`deleted` 和 `hidden` 都可以命中同时具有两个标记的记录；行内同时展示实际标记。未知参数回退到安全默认值，不传入 SQL。

`/admin?type=...` 仍可直接打开，避免破坏当前 URL 和 `UX-CONTRACT.md` 已记录的深链。主表顶部不再出现 Posts / Replies / Annotations / Annotation replies segment；类型只由左侧导航表达。

## 4. 页面结构

### 4.1 后台壳

- 站点 Header 下方建立宽版后台容器，桌面目标最大宽度约 1480px。
- 左侧导航按“总览 / 内容管理 / 成员与安全 / 系统记录”分组，当前项使用 `aria-current="page"` 和既有绿色选中表面。
- 右侧辅助栏只在总览和内容页显示，避免在成员页、日志页重复同一主任务。
- `/admin/revisions/[postId]` 复用左侧后台导航和页面身份，但保留当前历史版本的宽内容布局。
- `requireAdministrator()` 继续在每个页面服务端执行；Server Action 继续使用 `getActionAdministratorAccess()`，不把导航隐藏当成权限边界。

### 4.2 总览

- 四张小型摘要卡分别显示帖子、回复、批注、批注回复总数，并在卡内显示正常 / 作者已删除 / 管理员已隐藏数量。
- 最近操作使用已有审计日志；最近成员使用已有用户加入时间。
- 不把任何数量命名为“待处理”或“异常”，因为当前没有审核队列。

### 4.3 内容列表

- 标题区直接显示当前类型和结果总数。
- 状态 segment：正常、用户已删除、管理员已隐藏。它是同一数据集的状态切换，应保留。
- 工具栏：关键词搜索、时间排序、搜索按钮、清除搜索。使用 GET 表单和原生 `<select>`；明确接受系统原生下拉弹层，避免自造 ARIA listbox。
- 不显示内容类型 badge，因为整张表已经由左侧当前类型确定。
- 使用语义化 `<table>`，不是 ARIA grid；不启用多列排序、列显示设置或密度切换。
- 固定每页 20 条，显示当前范围、总数、上一页 / 下一页；删除或筛选后页码要 clamp 到有效范围。
- 宽屏表格列：

| 类型     | 内容列             | 关系列            | 作者列               | 状态列                                          | 时间列              | 操作列                                |
| -------- | ------------------ | ----------------- | -------------------- | ----------------------------------------------- | ------------------- | ------------------------------------- |
| 帖子     | 标题               | —                 | 作者                 | 自身两个生命周期标记                            | 发布时间 / 编辑时间 | 查看、历史版本、恢复、隐藏 / 取消隐藏 |
| 回复     | 两行 Markdown 摘要 | 所属帖子          | 作者                 | 自身状态 + 所属帖子状态                         | 发布时间            | 定位、查看原文、恢复、隐藏 / 取消隐藏 |
| 批注     | 批注摘要 + 原选文  | 所属帖子          | 站内作者或 Word 来源 | 自身状态 + 所属帖子状态 + 是否仍在当前 revision | 创建时间            | 定位、查看原文、隐藏 / 取消隐藏       |
| 批注回复 | 回复摘要           | 所属帖子 / 根批注 | 站内作者或 Word 来源 | 自身状态 + 所属帖子状态                         | 创建时间            | 定位、查看原文、隐藏 / 取消隐藏       |

- 原始 Markdown 继续通过可访问的 disclosure 展开，不把整段正文直接撑高每一行。
- 行操作复用 `ContentLifecycleControl` 和 `ModalDialog`；pending 时保持按钮尺寸、阻止重复提交，错误留在弹窗内。

### 4.4 用户与白名单

- 将白名单和注册成员关联展示：邮箱、是否唯一管理员、是否已完成 Profile、显示名、加入时间。
- 添加邮箱继续使用现有 Server Action，并补齐显式 label、字段级错误关联和成功状态。
- 移除非管理员白名单改用共享确认弹窗，明确“撤销访问但不删除既有内容”；唯一管理员只显示不可移除说明。
- 不增加成员封禁、角色编辑、用户删除或公开邮箱展示。

### 4.5 操作日志

- 使用当前 `admin_audit_log` 事件集，展示管理员、动作、对象类型、时间和安全元数据。
- 改为服务端分页，按最新优先；本次不增加导出、全文搜索或白名单操作审计。
- 右侧“最近操作”只是前 5 条摘要，点击“查看全部”进入该视图。

### 4.6 右侧辅助栏

- “邀请成员 / 白名单”：邮箱输入、添加按钮、当前白名单数量、进入完整成员页。
- “最近操作”：最多 5 条已有审计记录。
- “最近加入成员”：最多 5 位，按 `joined_at` 倒序。
- 三块独立 Suspense / Error 边界；任何一块失败都不能带走内容主表。

## 5. 响应式与可访问性

- 宽屏：左导航固定宽度，主表自适应，右侧辅助栏约 280–300px；文档滚动是唯一纵向滚动所有者。
- 中等宽度：右侧辅助栏移到主区下方；左侧导航仍保留，不压缩表格到不可读。
- 手机：后台导航变成可展开的“管理导航”，表格保留横向滚动和明确溢出提示；不静默隐藏状态或行操作。
- 不为表格给共享页面壳添加 `100vh`、固定高度或 `overflow: hidden`，避免重现无意义滚动条和内容裁切。
- 所有导航、搜索、分页、disclosure、弹窗和操作按钮具有真实语义、可见焦点、键盘路径和不依赖颜色的状态文本。
- Loading skeleton 与最终导航、工具栏、表格、辅助栏几何匹配；区分空数据与“搜索无结果”，后者提供清除筛选入口。
- 继续使用全局 scrollbar token、forced-colors 和 `prefers-reduced-motion` 规则。

## 6. 数据查询与索引策略

- 新增一个小型管理员查询参数解析模块，负责白名单解析、页码 clamp、URL 构造和类型收窄；不引入通用 data-grid 框架。
- `db/queries.ts` 扩展帖子、普通回复、白名单、成员、审计日志的 count + page 查询。
- `lib/annotations/queries.ts` 扩展批注和批注回复的 count + page 查询，并返回 Word 来源、父帖状态和 current-anchor 信息。
- 所有列表查询在 SQL 中完成筛选、排序和分页；不先取 100 条再在浏览器过滤。
- 关键词匹配沿用当前 D1 `LIKE` 搜索策略。站点规模很小，本次不引入 FTS。
- 实施时对四类内容分页、审计分页和总览计数运行 `EXPLAIN QUERY PLAN`。只有查询计划证明需要时才增加复合或 partial index；默认不创建数据库迁移。
- 行数据通过 join / batch 一次取齐，禁止逐行查询父帖、作者或 anchor 状态。

## 7. 实施任务

### Task 1：冻结后台合同与测试基线

**Files:**

- Modify: `DESIGN.md`
- Modify: `UX-CONTRACT.md`
- Create: `lib/admin/query.ts`
- Create: `tests/admin-query.test.ts`
- Modify: `tests/v7-contract.test.ts`

**Steps:**

- [ ] 在设计合同中记录后台宽版壳、左侧模块导航、可选右栏和“校刊式管理工具而非 SaaS 大屏”的边界。
- [ ] 在 UX 合同中记录后台 URL、分页、原生 select 所有权、权限、空态和响应式表格策略。
- [ ] 为合法 / 非法 `section`、`type`、`status`、`sort`、`page`、`q` 编写解析测试。
- [ ] 添加静态合同测试，要求内容类型只存在于左侧导航，主表没有重复 segment。

### Task 2：建立分页查询和真实总览数据

**Files:**

- Modify: `db/queries.ts`
- Modify: `lib/annotations/queries.ts`
- Create or modify: focused admin query tests under `tests/`
- Modify only if proven: `db/schema.ts` and a generated Drizzle migration

**Steps:**

- [ ] 为四类内容实现统一输入语义的筛选、count、排序、offset/page 查询。
- [ ] 加入父帖状态、批注 current-anchor 和 Word 来源字段，避免界面误报“正常”。
- [ ] 实现总览四类内容的三状态计数、最近 5 条审计和最近 5 位成员。
- [ ] 为白名单 / 成员关联、完整审计列表和分页边界补查询。
- [ ] 验证 deleted + hidden 双状态、空页 clamp、非法页码和相同时间排序稳定性。
- [ ] 用查询计划决定是否需要索引；没有证据则不改 schema。

### Task 3：重建后台壳与导航

**Files:**

- Create: `components/admin/admin-shell.tsx`
- Modify: `app/(site)/admin/page.tsx`
- Modify: `app/(site)/admin/revisions/[postId]/page.tsx`
- Modify: `app/globals.css`

**Steps:**

- [ ] 建立后台宽版布局、分组左导航、当前项语义和可选右侧辅助区。
- [ ] 让 `/admin`、内容、成员、审计和 revision 页面共享同一后台身份。
- [ ] 保持站点 Header、账户菜单和普通成员页面不变。
- [ ] 删除旧 840px 窄页和纵向堆叠所需的专用样式，而不是叠加第二套 CSS。

### Task 4：实现总览与右侧辅助区

**Files:**

- Create: `components/admin/admin-overview.tsx`
- Create: `components/admin/admin-aside.tsx`
- Modify: `components/admin/allowlist-forms.tsx`
- Modify: `app/(site)/admin/page.tsx`

**Steps:**

- [ ] 渲染四类真实计数及三状态分布，不显示虚构趋势。
- [ ] 右栏分别流式加载白名单快捷入口、最近操作和最近成员。
- [ ] 补全添加邮箱表单 label、错误关联、pending 与成功刷新。
- [ ] 保证辅助区故障不影响主工作区。

### Task 5：实现四类内容管理表

**Files:**

- Create: `components/admin/admin-content-table.tsx`
- Modify: `components/admin/content-lifecycle-control.tsx`
- Modify: `app/(site)/admin/page.tsx`
- Modify: `app/globals.css`

**Steps:**

- [ ] 渲染状态 segment、GET 搜索 / 排序工具栏、结果范围、表格和分页。
- [ ] 为四种内容分别映射内容、关系、作者、状态、时间与合法操作。
- [ ] 保留双状态、父帖状态、历史 revision 状态和 Word 来源信息。
- [ ] 复用现有生命周期弹窗；不为批注 / 批注回复添加不存在的恢复动作。
- [ ] 操作后保留当前 URL 筛选；若当前页失效则回到最后有效页。

### Task 6：完成成员与日志视图

**Files:**

- Create: `components/admin/admin-members.tsx`
- Create: `components/admin/admin-audit-log.tsx`
- Modify: `components/admin/allowlist-forms.tsx`
- Modify: `app/(site)/admin/page.tsx`

**Steps:**

- [ ] 将白名单与已注册 Profile 合并为可扫描的成员列表。
- [ ] 为移除白名单增加权限变更确认、pending、失败保留和焦点恢复。
- [ ] 实现审计日志分页和人类可读动作标签。
- [ ] 保持审计记录只读；不新增未被领域模型记录的事件。

### Task 7：Loading、响应式、回归与收尾

**Files:**

- Modify: `components/loading/skeletons.tsx`
- Modify: `app/(site)/admin/loading.tsx`
- Modify: `app/globals.css`
- Modify: relevant tests under `tests/`

**Steps:**

- [ ] 让后台 Loading 与最终三段式布局、表格和辅助栏保持稳定几何。
- [ ] 覆盖总览空态、内容空态、搜索无结果、局部错误、分页边界、会话失效和权限撤销。
- [ ] 验证手机导航、横向表格、长中文 / Word 作者名、长 Markdown 摘要、forced-colors 与 reduced-motion。
- [ ] 搜索并消除重复内容类型 segment、native dialog、假链接、不可点击 disabled 控件和表格高度泄漏。
- [ ] 运行 `format:check`、TypeScript、lint、相关单测、全量 `npm test`、strict premium audit 和 Sites checkpoint build。
- [ ] 未经用户明确要求，不启动浏览器 QA，不部署，也不推送 GitHub 镜像。

## 8. 明确不在本次范围

- 举报 / 审核工作流、内容风险自动检测。
- 系统设置中心、管理员角色管理、多管理员权限矩阵。
- 用户封禁、用户删除、替用户编辑内容。
- hard delete、批量处理、导出报表、全文检索服务。
- 新 Activity / Notification 类型。
- 白名单变化写入审计日志；如未来需要，应先确定邮箱等 PII 的审计与保留策略。
- 普通用户页面重设计、编辑器或批注阅读布局改动。
- 部署与 GitHub 同步。

## 9. 完成标准

- 管理员能从左侧导航直接进入四类内容、成员与日志；主表不再重复内容类型 segment。
- 每个内容列表具备真实的服务端搜索、状态筛选、排序、总数和分页。
- 页面只提供领域层已经支持的动作，所有内容与权限 mutation 继续服务端鉴权且可安全重试。
- 作者删除、管理员隐藏、父帖不可用和批注不在当前 revision 的状态不会被混淆。
- 桌面、平板和手机都能访问全部字段与操作，没有无意义的内层纵向滚动条。
- Loading、空数据、无搜索结果、局部错误、会话失效和权限撤销均有稳定可恢复的界面。
- 设计与 UX 合同、针对性测试、全量构建和静态审计全部通过；未完成的浏览器验证明确标记，而不是虚报通过。
