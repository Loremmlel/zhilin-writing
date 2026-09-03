# 知临中学 V7 发布收尾、可靠性与响应式设计

## 文档状态

- 日期：2026-09-03
- 基线：V6 完成提交 `488ab91`
- 工作分支：`feature/v7-hardening`
- 基线验证：317 项单元测试中 316 通过、1 项 Word Online fixture 有明确理由跳过
- 浏览器审查：本地 Site preview 已启动，但本次 Work cloud browser 对预览地址返回 `ERR_BLOCKED_BY_CLIENT`；交互、慢网和多 viewport 验收仍是发布硬门，不能以静态审查代替
- 状态：设计定稿，可开始分阶段实现；尚不具备发布条件

## 结论

V7 没有整体技术不可行项，但原始说明书中有几处不能按字面直接实现，必须先收紧语义：

1. 不可用内容状态与认证状态不是同一层状态。内容目标使用 target resolution；登录过期与白名单移除使用 access result，不能共用一个数据库枚举。
2. 未提交 DOCX Preview 只存在于浏览器 IndexedDB，服务端 GC 无法直接查询“active import preview ref”。现有 Preview 最长 24 小时、temporary asset 至少保留 7 天，因此由时间窗不变量保护，不新增服务端 heartbeat 或 preview lease。
3. D1 与 R2 不能组成真正的跨存储事务。实现只能通过 D1 claim、删除前复查、失败记录和可重试 maintenance job 把竞态窗口收窄，不能宣称绝对原子。
4. 当前 Milkdown/Crepe 多图片上传内部使用 fail-fast `Promise.all`。逐文件成功、失败、重试技术上可行，但必须先替换这一小段上传编排；仅给现有回调套错误提示无法满足 V7。
5. `EXPLAIN QUERY PLAN` 能确认索引是否被查询采用，不能凭空证明生产数据分布。V7 使用代表性 fixture、query plan 和查询次数测试共同验收，不虚构生产延迟结论。
6. owner-only Sites 发布会在托管层阻止其他白名单成员进入，应用内 allowlist 对他们暂时不会生效。这与“多成员私人站”存在产品语义张力；本次按明确要求保留 owner-only 首发，但扩大到白名单成员前必须单独调整托管可见范围。

除此之外，卡片碰撞、connector、深链、错误恢复、幂等、索引、GC、响应式与 accessibility 均可在现有架构内完成，不需要新平台或大型重写。

## 产品审查基线

### 已实际确认

- Site 项目、D1 `DB` binding 与 R2 `BUCKET` binding 已存在。
- 当前分支工作区干净，V1–V6 代码和迁移完整。
- 完整单元测试基线通过。
- 当前实现已经具备 route top loader、route skeleton、局部 pending、错误页、Annotation Sidebar、Bottom Sheet、连接线和确定性卡片排布。
- Preview server 可启动且状态健康。

### 静态审查发现的真实问题

- Annotation 深链只能定位 root card；Annotation Reply notification 没有 reply 自身的稳定 URL target。
- 深链 active 状态会一直保留，没有独立的 1.5–2.5 秒 transient highlight。
- 多行 anchor 使用整体 bounding box，connector 起点可能仍在正文区域；没有显式 font-ready/image-load 重算。
- annotation breakpoint 在 TS 与 CSS 中分别硬编码为 900px，存在漂移风险。
- `listPosts`、`listReplies`、`listUserActivity`、`listNotifications` 与 `listTags` 存在明显逐行查询。
- lifecycle notice 把作者删除、管理员隐藏、退出当前 revision 和帖子不可达混成少数文案。
- server action 内部使用 redirect 型认证并在外层捕获异常，不能稳定返回 `AUTH_EXPIRED` / `ACCESS_REVOKED`。
- Asset API 也使用 page redirect 型认证；XHR 有机会收到 HTML/redirect，而不是可恢复的 JSON 错误。
- 上传错误被压成一个全局错误；编辑器某个图片失败会中止整批。
- 创建 Post 只有客户端 pending，没有服务端创建幂等键。
- GC 没有 dry-run、bytes/reason 报告、逐项失败记录或 R2-only orphan scan；单个 R2 delete 失败会中断整个批次。
- R2 put 成功、D1 metadata insert 失败时可能遗留只有 object、没有 metadata 的 orphan。
- 通知未读计数失败可能让整个受保护 Site shell 失败。
- 多个小型文字按钮的 touch target 小于移动端主要操作所需尺寸。

### 发布前仍须实际运行的审查

浏览器恢复可用后，必须实际走完首页、Latest/Active、创建/编辑/批注编辑、Post Reply、Annotation/Reply、Notifications、Profile、Search、Tags、Admin、Revision Restore、Soft Delete、DOCX Import，以及 320/375/390/430/768/820/1024px。记录 layout shift、空白等待、滚动、深链、重复请求、空状态、错误恢复、overflow 和慢查询。浏览器门未完成时不得发布。

## 范围纪律

V7 只修正现有能力的可靠性、布局、反馈、可访问性与运维安全。继续明确排除 cross-block、overlap、image/table Annotation、自由 mention、社交关系、私信、协作编辑、WebSocket、push/email、导出、PDF 导入、公开注册与匿名访问。

如审查发现现有功能的正确性缺陷，可以修复；不得借机替换编辑器、引入第二套 Annotation 模型、建立通用任务框架或重做视觉系统。

## 1. Annotation 布局与 connector

现有 `layoutAnnotationCards` 保留为唯一碰撞算法：先按 `(anchorTop, annotationId)` 稳定排序，每张卡的 `actualTop = max(desiredTop, previousBottom + gap)`，只向下推。Sidebar 高度取正文高度与最后一张卡底部的较大值，长 thread 自然延长页面。

V7 只做以下强化：

- 从 anchor 的非空 `getClientRects()` 选择稳定代表行，以该行垂直中心作为 `anchorY`。
- connector 从代表行右侧先进入专用 gutter，再用克制的单调曲线到 card 左边缘；路径不进入 card 内部。
- 相同 document order 加相同 card order 保持 endpoint 单调，避免 connector 交叉。
- `ResizeObserver` 观察正文、sidebar 与 cards；`document.fonts.ready`、正文 image load、breakpoint/mode 变化显式触发重算。
- 全部重算由一个 `requestAnimationFrame` scheduler 合并；geometry 未变化时不更新 React state。
- scroll 不触发全量测量或 React rerender。
- active 仍只由 `annotation_id` 决定；deep-link highlight 是独立、短暂、可结束的状态。

Breakpoint 不再在 CSS 与 JS 各自决定。组件按实际容器宽度计算一个 `desktop | compact` layout mode，并写入稳定 data attribute；CSS、connector 和 sheet 都消费同一 mode。静态几何证明 desktop 至少需要 1060px（720px 正文 + 70px gutter + 270px rail），因此以此作为容器阈值；实际 768/820/1024px 审查仍负责验证结果，而不是再引入 viewport 断点。

## 2. 稳定深链与 transient highlight

所有通知先进入 owned notification resolver，由服务端用 ID 判断目标状态，再跳转到 canonical URL。禁止按文本、数组 index 或第 N 条回复定位。

Canonical targets：

- Post Reply：`/posts/:postId?target=post-reply&reply=:replyId#reply-:replyId`
- Annotation Root：`/posts/:postId?target=annotation&annotation=:annotationId#annotation-card-:annotationId`
- Annotation Reply：`/posts/:postId?target=annotation-reply&annotation=:annotationId&annotationReply=:replyId#annotation-reply-:replyId`

页面 hydration/layout 完成后执行一次定位：

- 桌面 Annotation：正文 anchor 进入 viewport、card active、必要时调整 card 可见位置。
- compact Annotation：正文 anchor 进入 viewport、打开对应 sheet、定位 reply。
- Post Reply：定位 active reply 或其 placeholder。
- 成功定位后增加约 2 秒 highlight，再自动清除；reduced motion 下无位移动画和闪烁，只保留静态颜色渐退或立即清除。

Back/Forward 恢复 URL 对应目标，但不得重新执行 mutation。重复处理同一 history entry 只重新定位，不创建数据。

## 3. 状态模型

不新增一个混杂所有含义的数据库 enum。使用两层 discriminated result：

### Access result

| code             | 含义                                                     | UI                                 | 编辑内容                             |
| ---------------- | -------------------------------------------------------- | ---------------------------------- | ------------------------------------ |
| `AUTH_EXPIRED`   | 请求已到达应用，但当前 ChatGPT identity/session 不再有效 | 登录状态已失效，请重新登录后继续。 | IndexedDB 与当前输入保留             |
| `ACCESS_REVOKED` | identity 仍有效，但 email 已不在 allowlist               | 你的站点访问权限已被移除。         | 本地内容保留，禁止提交与私人数据请求 |

顶层 navigation 若被 SIWC dispatcher 接管，仍按平台登录流程跳转；应用只能保证到达 Worker 的 action/API 返回上述 typed result。

### Target resolution

| state                     | 判断                                             | 普通用户文案/行为                                  |
| ------------------------- | ------------------------------------------------ | -------------------------------------------------- |
| `AVAILABLE`               | 当前目标可见且属于当前 revision                  | 精确定位并 highlight                               |
| `DELETED_BY_AUTHOR`       | `deleted_at` 生效且目标 placeholder 仍可达       | “该帖子/回复/批注已被作者删除。”                   |
| `HIDDEN_BY_ADMIN`         | `hidden_at` 生效                                 | “该帖子/回复/批注已被管理员隐藏。”；不含原文       |
| `NOT_IN_CURRENT_REVISION` | 历史 snapshot 中存在但 current membership 不存在 | “该内容存在于历史版本中，但当前版本已不再包含它。” |
| `POST_UNAVAILABLE`        | 目标所属帖子当前不可访问，且无可达保留讨论       | 说明帖子不可用，不伪装为目标删除                   |
| `NOT_FOUND`               | notification/target 数据从未存在或不属于该用户   | 通用 not found，不泄露存在性                       |

管理员管理页仍可查看受权限保护的原内容和精确 lifecycle；普通页面只得到经过 redaction 的 target resolution。

## 4. Loading、错误与 retry

Route navigation 继续使用即时轻量 TopLoader。现有页面 shell 不重写，异步反馈按区域处理：

| 区域                          | 初始状态                 | 失败恢复                            |
| ----------------------------- | ------------------------ | ----------------------------------- |
| 首页 Latest / Active          | list skeleton            | 保留 tabs，区域错误 + Retry         |
| Post 正文                     | article skeleton         | Post 错误 + Retry                   |
| Post discussions / Annotation | local skeleton           | 保留正文，讨论错误 + Retry          |
| Notifications                 | list skeleton            | 保留筛选，列表错误 + Retry          |
| Profile Posts / Activity      | list skeleton            | 保留 profile/tabs，区域错误 + Retry |
| Search                        | result skeleton          | 保留 query，结果错误 + Retry        |
| Tag                           | list skeleton            | 保留 tag heading，列表错误 + Retry  |
| Admin / Revision list         | table/list skeleton      | 保留 section/tab，区域错误 + Retry  |
| DOCX Preview                  | staged progress/skeleton | 保留 source/preview，明确 Retry     |
| Upload                        | 每文件真实进度           | 单项 Retry/Remove                   |

局部 skeleton 延迟约 120–180ms 才显色，几何占位从首帧存在，避免快请求闪烁又避免 layout shift。Mutation 使用按钮/inline pending，不使用全屏 spinner。

可恢复错误统一为安全用户文案、稳定 error code 和 retry intent；原始异常只进入脱敏 server log。失败 mutation 必须结束 pending、保留输入、移除 ghost optimistic state，并允许使用同一 idempotency key 重试。

## 5. 上传恢复

建立一个小型、共享的 upload task 状态，不创建通用 job framework：

```ts
type UploadTask = {
  localId: string;
  file: File;
  kind: "image" | "attachment";
  status: "pending" | "uploading" | "succeeded" | "failed";
  progress: number;
  asset?: UploadedAsset;
  errorCode?:
    "UNSUPPORTED_TYPE" | "SIZE_LIMIT" | "NETWORK" | "SERVER" | "AUTH_EXPIRED" | "ACCESS_REVOKED";
};
```

每个文件独立上传、成功即保留、失败仅影响自身。Retry 复用该项，不重传成功项；Remove 只移除本地失败项或执行现有未绑定 temporary asset 流程。Milkdown 先做一个最小集成 spike，确认可以绕开 Crepe 的 fail-fast `Promise.all`，再接入同一 task model。

Asset API 返回 JSON error code 与正确 HTTP status；客户端分别显示类型、大小、网络、服务端、认证和权限错误。R2 put 后若 metadata insert 失败，立即 best-effort 删除 object；删除也失败则由 R2-only orphan scan 兜底。

## 6. Mutation 与重复提交

继续使用现有 `PendingSubmitButton` 作为客户端第一层。创建实体使用服务端幂等：

- Reply、Annotation、Annotation Reply、DOCX commit：保留现有 submission/batch key 与 unique constraint。
- Admin lifecycle、Revision Restore：保留 operation ID / dedupe key。
- notification mark-read：保留条件 update，天然幂等。
- create Post：新增 nullable creation submission key 与 `(author_id, creation_submission_key)` unique index；重复/并发请求返回同一 Post。
- allowlist add：依赖 normalized email unique constraint，并把 unique-race 映射成成功/已有，不暴露数据库异常。

复杂保存、restore、DOCX commit、delete 不做假成功 optimistic UI。仅 mark-read 等可安全 rollback 的轻量状态可 optimistic。

## 7. D1 查询与索引

先对真实 SQL 和代表性 fixture 执行 `EXPLAIN QUERY PLAN`，再添加索引。现有 schema 已覆盖 posts publish/activity、notifications recipient/read、annotation/reply thread、revision sequence 等多项要求，不重复创建。

当前明确候选：

| 索引                                  | 对应查询                      | 处理原则                                                                |
| ------------------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `posts(author_id, published_at)`      | Profile Posts 按作者倒序分页  | 若 plan 采用则替换冗余 `posts(author_id)`                               |
| `post_replies(post_id, published_at)` | Post Detail 回复稳定排序/分页 | 若 plan 采用则替换冗余 `post_replies(post_id)`                          |
| `post_tags(tag_id, post_id)`          | Tag Posts 与 tags 聚合        | 新增 reverse lookup                                                     |
| lifecycle partial/composite           | admin deleted/hidden lists    | 仅在实际 plan 证明全扫且值得优化时添加；一次性小型 admin query 默认不加 |

`LIKE '%query%'` 不能使用普通 B-tree。私人小站继续使用有上限的全文扫描；V7 不为此引入 FTS 子系统。

消除的 N+1 采用 query-local batching，不引入 DataLoader：

- Post list：一次批量 tags + 一次 grouped reply counts。
- Reply list：join 或一次 `IN` 取得 reply-to users。
- Activity / Notifications：按涉及 post IDs 批量取得 discussion reachability 与 current annotation membership。
- Tags：一次 grouped count，不逐 tag 查询。
- Annotation roots/replies/authors：保留现有已批量实现。

## 8. R2 lifecycle 与 GC

Asset 分类仍为 temporary、current post ref、revision ref、avatar ref、orphan candidate。任何业务路径不得直接物理删除仍被合法引用的 object。

### Temporary GC

仅当 temporary、创建时间早于 7 天、没有 current/revision/avatar ref 时进入 candidate。未提交 DOCX Preview 最长 24 小时，因此必然在 7 天保护窗内；不增加服务端 preview 表。

### Orphan GC

- metadata orphan：非 temporary 或历史异常产生、且所有合法引用均为 0。
- R2-only orphan：分页列举受管 prefix，与 D1 `r2_key` 对账；只处理超过安全窗口的 object。
- 每个 candidate 删除前重新检查引用并取得短期 D1 claim。

### Dry-run 与失败

`dryRun=true` 返回 candidate count、总 bytes、asset IDs、keys 的安全标识和 reasons，不修改 D1/R2。实际执行使用有界 batch，单项失败不终止其他项。R2 delete 成功后才 tombstone metadata；失败写入 error code、attempt count 和 retry time，不存 stack/raw content。GC 只由 maintenance/admin 调用，绝不阻塞普通读取与保存。

## 9. Responsive、overflow 与 accessibility

- 320/375/390/430px：单列阅读、Annotation sheet、页面无横向滚动。
- 768/820px：以实测决定是否 compact；不按设备名判断。
- 1024px：只有正文仍满足阅读宽度、rail 与 gutter 都容纳时才用 desktop。
- 普通文本/URL/filename wrap；code block 局部横向滚动；Markdown table 包入局部 overflow container。
- 主要触摸操作使用至少 44px 可点区域；相邻回复/删除保留明确间距。
- Annotation range 保留 `tabIndex=0`、可用 Enter/Space 激活，且由边框/下划线表达，不只依赖颜色。
- card 提供明确的“定位正文”键盘操作；deep-link focus 不改变正常 tab 顺序。
- dialog/sheet 使用现有 focus trap；关闭返回触发元素。composer 打开后聚焦编辑区，关闭返回 CTA。
- transient highlight、smooth scroll、skeleton motion 尊重 `prefers-reduced-motion`。
- Search、tabs、menus、upload input、admin actions 与 AnnotationGuard 全部验证 visible focus、label 与 live status。

## 10. 日志、安全与性能

结构化 server log 只记录 operation、entity ID、内部 user ID、error code、request correlation ID。不得记录 email、Markdown、Annotation body、raw DOCX、auth header。用户 UI 永不显示 stack、SQL 或原始平台异常。

性能检查聚焦重复 Markdown parser、重复 Annotation fetch、scroll rerender、connector layout thrashing、N+1 与明显重依赖。没有证据时不为几十 KB 风险性重构。

## 11. 发布门

发布必须同时满足：

1. unit、build、rendered HTML 与新增 query-plan/query-count tests 全通过。
2. 320/375/390/430/768/820/1024px 真实浏览器矩阵通过。
3. slow-network 下 navigation、pending、draft preservation、retry、no double-submit 通过。
4. D1 mutation、R2 upload/delete、notification query、asset bind、auth expiry 和 revision conflict failure injection 通过。
5. migrations 在空库与 V6 fixture 升级均通过，索引 migration 可安全重复部署。
6. production bindings、allowlist、admin identity、fixture/debug backdoor 检查通过。
7. 记录当前稳定 Sites version 作为 rollback target。
8. 最后执行 owner-only/private deployment；部署后 smoke test 通过才宣布 V7 完成。

## 已知限制

- 当前 Work cloud browser 阻止预览地址，尚不能完成交互验收；这不是应用缺陷，但会阻止本轮发布。
- SIWC dispatcher 自己处理的顶层 session 失效不一定经过应用 typed error；本地草稿仍由 IndexedDB 保留。
- R2/D1 没有跨存储事务，GC 采用 claim/recheck/retry 达到工程安全，不宣称线性一致。
- `%LIKE%` 搜索仍为有界扫描；以当前私人站规模是明确接受的取舍。
- owner-only 托管意味着其他 allowlist 成员暂时无法进入；扩大访问范围需另行确认。
