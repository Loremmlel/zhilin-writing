# 知临中学 V6 AnnotationGuard、批注编辑与 Loading 收尾设计

## 文档状态

- 日期：2026-08-31
- 基线：V5.5 完成提交 ab4cda9
- 基线验证：227 项单元测试中 226 通过、1 项 Word Online fixture 明确跳过；生产构建与 7 项产物断言通过
- 工作分支：feature/v6-annotation-guard
- 状态：设计定稿，尚未开始 V6 实现

## 结论

V6 是现有批注系统的完整化和稳定化，不是新的产品扩张。它必须同时改造编辑器 transaction、草稿恢复、帖子保存、批注生命周期、revision 冲突和全站异步反馈，因此按架构级变更实施。

V6 的完成体验是：

- 普通编辑、批注内部编辑、批注外部编辑和普通格式化不打扰作者。
- 只有受保护端点丢失、anchor 被清空或结构变得非法时才要求确认。
- 确认只改变本地编辑 session；Undo、Redo、放弃草稿与保存行为一致。
- 保存时 Markdown、revision、annotation membership、thread lifecycle 和 assets 在一个 D1 batch 内提交。
- 任何未经确认的 anchor 丢失、复制产生的 annotation ID 或并发批注变化都由服务端拒绝。
- 编辑页实时显示只读 Annotation Sidebar、讨论和连接线。
- 阅读页创建批注时，失焦后仍持续显示原选区。
- 批注 root reply composer 位于回复列表之前，并由整个 thread 共用。
- 所有明显等待的导航和 mutation 都立即给出可访问的视觉反馈。

## 已确认的产品决定

1. 采用集中式 AnnotationGuard，不采用分散的 keydown 条件集合。
2. Annotation 的当前首尾字符是受保护端点。删除或替换任一端点都必须确认撤下整个 thread，即使剩余文字仍可形成非空连续 range。
3. 编辑页显示现有 Annotation Sidebar、批注讨论和连接线。
4. 编辑页 Sidebar 只读：可以阅读、激活和定位，但不能回复、删除、移除或执行管理操作。
5. 中文 IME 在破坏性 selection 上采用安全模式：取消第一次 composition，确认后恢复原选区并要求用户重新输入，不尝试自动重放原生候选内容。
6. V5 的编辑锁必须保留到 Guard、服务端保存和完整测试门全部通过。

## 现有实现基线与必要修正

现有系统已经具备：

- Milkdown Crepe / ProseMirror 编辑器和 Annotation Mark。
- Annotation Mark 的 inclusive: false。
- Markdown textDirective 与 ProseMirror Mark 双向序列化。
- 只读 HTML 上的 Annotation selection、创建、Sidebar、Bottom Sheet 与 connector。
- post_annotation_anchors、revision_annotation_states 和 imported reply snapshot。
- Post Revision、asset snapshot、optimistic lock 和 IndexedDB 草稿。
- 多数 mutation 的 useActionState pending 状态。

V6 必须正视以下基线：

- 当前添加批注发生在只读 HTML，不在 ProseMirror 内。Selection Preview 不能假设存在 ProseMirror selection。
- 当前 assertAnchorInvariant 只验证 Markdown ID 与 anchor 表 ID 一致，不能证明单 block、连续、非空、无嵌套或无 overlap。
- 当前 updatePost 同时在页面和 service 层禁止 annotated Post 编辑，并调用 assertOrdinaryPostMarkdown。
- 当前 MarkdownEditor 没有向外暴露 EditorView、transaction hook、selection、root DOM 或 plugin state。
- 当前 annotations.deleted_at 表达批注作者删除或导入 thread 移除，不能表达帖子作者通过正文编辑使 anchor 退出版本。
- 当前 Conflict Snapshot 不包含 Annotation 状态变化，也总是提供 Force Overwrite。
- 当前没有 loading.tsx、error.tsx、global-error.tsx 或 not-found.tsx。
- Post Save、Annotation Create、Post Reply、Annotation Reply、Delete 和多数 Admin mutation 已有 pending；V6 应审计、统一并补缺，而不是重写这些表单。

## 范围

### 本次实现

- AnnotationGuard transaction inspector 与 editor plugin。
- 受保护端点、结构破坏、多个 Annotation 影响和确认重放。
- Copy、Cut、Paste、Drop 的 Annotation Mark strip。
- Undo、Redo、IME、stale replay 和本地 pending deletion。
- annotated Post 的原子保存、服务端不变量验证和 conflict 强化。
- 编辑页只读实时 Annotation Sidebar。
- 阅读页 selection preview。
- Annotation Reply 共用顶部 composer。
- 路由 progress bridge、route skeleton、Suspense、mutation pending、错误页和 reduced motion。
- 完整自动化测试、浏览器交互检查和真机 IME 验收清单。

### 明确不实现

- cross-block、overlapping、nested、image、table Annotation。
- Annotation source mode 或自由手写 directive。
- collaborative editing、WebSocket、自动 rebase 或多人实时光标。
- likes、favorites、follows、私信、自由 mention。
- DOCX export、PDF import、邮件或浏览器 push。
- 用户可见 revision history。
- 编辑页中的 Annotation reply、delete、remove 或 moderation。

## 术语与示例记号

为避免原提示词中方括号同时表示 anchor 和 selection，本文统一使用：

- Annotation anchor：冒号记号，例如 A:我喜欢你。
- 当前 selection：花括号，例如 我{喜欢}你。
- 光标：竖线，例如 我|喜欢你。
- A、B：不同 annotation ID。
- protected endpoints：一个 anchor 当前的第一个和最后一个用户可见 grapheme。

示例 A:我喜欢你 表示整段“我喜欢你”属于 Annotation A；A:我{喜欢}你 表示 selection 只覆盖该 anchor 的内部“喜欢”。

## Canonical Annotation 不变量

对任意当前 Post canonical Markdown：

1. 同一个 annotation ID 最多出现一次。
2. 每个 anchor 是一个连续 inline range。
3. anchor 只能存在于一个允许的文本 block。
4. anchor 至少包含一个非空白用户可见 grapheme。
5. Annotation 之间不能 overlap。
6. Annotation 之间不能 nested。
7. 当前 Markdown 中的每个 ID 必须属于该 Post，且存在 Annotation 数据。
8. post_annotation_anchors 必须与当前 Markdown ID 集合完全一致。
9. 当前 revision_annotation_states 必须与当前 Markdown ID 集合完全一致。
10. 当前 membership 之外的 Annotation row 只能是历史、作者删除后已 unwrap、导入移除或 anchor-retired 数据，不能被普通阅读查询当作当前 thread。
11. Paste、Drop 和普通 Post create 不能引入新的 Annotation ID。
12. 编辑 session 中，一个既有 anchor 的当前首尾 grapheme 是受保护端点；普通 transaction 不能静默删除、替换或跨 block 分离它们。

第 12 条是 V6 编辑语义，不是仅靠最终 Markdown 可以证明的静态不变量。因此客户端 transaction inspector 负责端点意图，服务端负责最终结构、ID、membership 和显式删除声明。

## 架构分层

| 层                        | 职责                                                          | 不负责           |
| ------------------------- | ------------------------------------------------------------- | ---------------- |
| Anchor scanner            | 从 ProseMirror Doc 或 Markdown AST 生成稳定 anchor 描述       | UI、数据库       |
| Transaction inspector     | 比较 before Doc 与 proposed transaction，输出 SAFE 或影响集合 | 弹窗、异步重放   |
| Guard plugin              | 拦截、排队确认、clipboard strip、history metadata、IME 状态   | 服务端信任       |
| Editor bridge             | 暴露 EditorView、root DOM、实时 anchors 与 Guard 状态         | 业务保存         |
| Guard dialog controller   | 展示一次确认、校验 stale state、触发受控重放                  | 修改服务器       |
| Draft adapter             | 保存 Markdown、base revision 和当前确认删除集合               | 决定服务器 delta |
| Server validator          | 重新解析 Markdown、验证 ID 与结构、计算 delta                 | 信任客户端 Guard |
| Save planner/service      | 构建一个 D1 batch 并处理 CAS conflict                         | 自动 rebase      |
| Reading selection preview | 保留只读 DOM selection 的视觉反馈                             | 写入 Markdown    |
| Loading primitives        | Route progress bridge、Skeleton、Pending 和 Error UI          | 改变业务语义     |

实现应沿用现有 lib/annotations、lib/editor、lib/posts、lib/revisions 和现有 UI primitives。不得建立第二套编辑器或第二套 Annotation 数据模型。

## Anchor 描述

ProseMirror scanner 为每个 ID 产生：

```ts
type EditorAnchorDescriptor = {
  annotationId: string;
  from: number;
  to: number;
  blockFrom: number;
  blockTo: number;
  blockType: string;
  text: string;
  firstEndpoint: { from: number; to: number; text: string };
  lastEndpoint: { from: number; to: number; text: string };
};
```

端点使用用户可见 grapheme，而不是任意 UTF-16 半字符。实现优先使用 Intl.Segmenter；不可用时至少按 Unicode code point 回退，绝不能拆开 surrogate pair。ProseMirror position 仍作为 transaction mapping 的坐标。格式 Mark 拆分 text node 不改变端点身份。

Scanner 必须拒绝：

- 同一 ID 多段出现。
- 同一 ID 跨 block。
- 空或全空白 anchor。
- nested 或 overlap。
- 不允许的 block 或 inline 结构。

允许的 block 与 V5 selection contract 一致：root heading，以及 root、listItem、blockquote 中的 paragraph。table、code、image、attachment 与其他 V5 已拒绝节点继续拒绝。

## Transaction inspector

核心 API：

```ts
type AnnotationImpactReason =
  | "PROTECTED_LEFT_ENDPOINT"
  | "PROTECTED_RIGHT_ENDPOINT"
  | "EMPTY_ANCHOR"
  | "REMOVED_ANCHOR"
  | "SPLIT_ACROSS_BLOCKS"
  | "DUPLICATE_ANCHOR"
  | "NESTED_OR_OVERLAPPING"
  | "INVALID_BLOCK";

type AnnotationTransactionInspection =
  | { kind: "SAFE" }
  | {
      kind: "ANNOTATION_IMPACT";
      affectedAnnotationIds: string[];
      reasons: AnnotationImpactReason[];
      destructive: true;
    };

inspectAnnotationTransaction(beforeDoc, transaction): AnnotationTransactionInspection;
```

Inspector 是纯函数，不读取 DOM、不弹窗、不访问 React state 或数据库。测试直接构造 ProseMirror transaction。

处理顺序：

1. 扫描 before Doc 并验证其不变量。
2. transaction 没有 docChanged 时返回 SAFE；formatting、selection 与 metadata transaction 不触发确认。
3. 将 before 端点 range 通过 transaction.mapping 映射到 proposed Doc。
4. 检查端点 range 是否被删除或替换。
5. 扫描 proposed Doc，检查最终结构不变量。
6. 汇总全部受影响 ID，排序并去重。
7. 只返回一次影响结果，不按按键或 ID 连续弹窗。

Inspector 不依赖 event 类型，因此 keyboard、toolbar command、selection replacement、paste、drop、IME commit、Undo、Redo 和未来 command 都共享最终规则。

## 允许与拦截的编辑

### 直接允许

- Annotation 外部插入、删除和替换。
- 严格位于 Annotation 内部的插入。
- 不触碰首尾端点的内部删除与 selection replacement。
- Bold、Italic、Strike、Link、Remove Link 和其他不改变正文字符的 Mark formatting。
- paragraph 与 heading 互换。
- paragraph 包入 list item、合法 indentation 与 outdent。
- 只要 anchor 仍在单个合法 text block 内的结构编辑。
- Copy。

内部插入继承 Annotation Mark；外边界插入不继承。inclusive: false 是第一层语义，Inspector 的 after Doc 检查是第二层保险。

### 要求确认

- 删除、替换左端点或右端点。
- 删除唯一字符。
- 删除整个 anchor。
- selection 同时覆盖多个 Annotation。
- Enter、block split、join 或结构 command 使 anchor 跨 block、分裂或退出合法 block。
- Cut 或 drag source 删除触碰端点。
- 任意 command 使 ID 消失、重复、nested 或 overlap。

### 结构编辑确认后的执行

确认后不是简单允许原始非法 Doc。Guard 从当前 state 创建一个复合 transaction：

1. 对全部受影响 ID 移除完整 Annotation Mark。
2. 追加原始 transaction steps。
3. 恢复原始 transaction 的合法 selection 与必要 metadata。
4. 写入 Guard confirmed metadata。
5. 作为一个 addToHistory transaction 提交。

移除 Mark 不改变 document position，因此原始 steps 可在同一 Doc 坐标上应用。若任何 step 无法重放，则安全失败，不写入 Doc。

## 确认弹窗与 stale replay

弹窗内容包括：

- “此修改将删除 N 条批注及相关讨论”。
- 最多三条当前 anchor excerpt。
- 批注作者与回复数量。
- 超出三条时显示剩余数量。
- “取消”与“继续修改并删除批注”。

交互要求：

- 使用现有 ModalDialog 的 alert 模式。
- focus trap、Escape 取消。
- 默认 focus 在“取消”。
- Enter 不直接确认危险操作。
- pending 期间禁用重复操作。

被拦截时保存：

- before Doc identity 或稳定 hash。
- Editor state epoch。
- selection。
- transaction steps。
- affected IDs。

确认时重新验证当前 Doc、epoch 和 selection。任一变化都不重放，提示“正文已经变化，请重新执行刚才的操作”。不得对旧 position 强行 dispatch。

## 多 Annotation 操作

一个 transaction 只产生一个确认请求。affectedAnnotationIds 按当前文档位置排序。确认后所有受影响 Mark 与原始编辑在同一个 transaction 内执行。

如果其中一个 ID 在等待期间失效，则整个操作失败；不能部分删除、部分重放。

## Undo、Redo 与确认历史

确认后的复合 transaction 同时包含文字 steps 与 Mark removal，因此普通 Undo 必须一次恢复：

- 被删除或替换的文字。
- Annotation Mark。
- annotationId。
- selection。

Redo 必须再次移除文字和 Mark，但不重新弹窗。

Guard 维护已确认 transition registry，键至少包含：

- before Doc hash。
- after Doc hash。
- affected ID 集合。
- canonical step signature。

Redo 只有精确匹配已确认 transition 才可免确认。Undo 后以另一种操作删除同一 ID 不匹配 transition，仍然要求确认。registry 只属于当前编辑 session，不提交服务器。

当前 pending removal IDs 始终由“base anchor IDs 减去当前 Doc anchor IDs”派生。Undo 恢复 anchor 后自动退出 pending；Redo 后自动恢复 pending。

## 中文 IME 安全模式

普通 Annotation 内部 composition 应直接工作，不在 compositionupdate 中反复检查或弹窗。

当 composition 开始前的 selection 会替换受保护端点：

1. 在 beforeinput、composition 和 plugin transaction 三层中尽早识别。
2. 阻止第一次 composition 对 Doc 落地。
3. 整个 composition session 只触发一次确认。
4. 用户取消时恢复原 selection 和 focus。
5. 用户确认时记录一个一次性授权 token，不立即删除文字或 Mark。
6. 恢复原 selection，显示“批注已确认待撤下，请重新输入刚才的文字”。
7. 用户下一次在完全相同 Doc 和 selection 上输入时，Guard 把 Mark removal 与新的 replacement 组合为一个 history transaction。
8. selection、Doc 或焦点上下文变化时 token 立即失效，必须重新执行操作。

不缓存、不猜测、不自动重放操作系统候选文本，从而避免重复字符、候选错位和 stale replay。

composition cancel 不改变 Doc、Mark 或 pending deletion。普通 composition 的 Undo 继续由 ProseMirror history 管理。

## Clipboard、Cut、Paste 与 Drag/Drop

建立唯一的 Slice sanitizer，递归移除 Annotation Mark，保留：

- 文本。
- Bold、Italic、Strike。
- Link。
- 其他现有允许的普通 formatting。

同一个 sanitizer 接入：

- transformCopied。
- transformPasted。
- clipboard DOM serializer 前的 Slice。
- internal drag/drop insertion Slice。

Copy 永不触发 Guard。复制出的 rich HTML、ProseMirror Slice 和可序列化 clipboard payload 均不能携带 annotationId。

Cut 先产生已 strip 的 clipboard 内容，再由 source deletion transaction 经过 Guard。若需要确认而用户取消，正文不变；系统不承诺撤回浏览器已经写入的非破坏性 clipboard 文本，但不得执行 destructive cut。

Paste 到 Annotation 内部时，外来 Annotation Mark 先被剥离，随后新文本继承当前位置已有的 Annotation Mark。Paste 到外部不能产生新 anchor。

Drag move 的插入端 strip Mark；source 删除端仍经过 Guard。跨位置拖动不能复制或移动现有 annotationId。

## 编辑器 Bridge 与插件接入

MarkdownEditor 增加可选 annotated editing 能力，而不影响 new Post 和 compact reply editor：

- onEditorReady / onEditorDestroy。
- editor root DOM。
- 当前 EditorView 或受限 bridge。
- onAnchorStateChange。
- onGuardStateChange。
- baseAnchorIds、initialConfirmedDeletionIds 和 annotation metadata。

AnnotationGuard 只在编辑已有 annotated Post 时启用。普通新帖与回复编辑器继续使用轻量配置。

Bridge 不把每次 EditorState 复制成完整 React JSON。Sidebar 只接收 ID、DOM range 与必要的状态变化；Markdown 序列化继续沿用现有 markdownUpdated。

## 编辑页只读 Annotation Sidebar

EditPostPage 同时加载：

- 当前 Post 与 current revision。
- current annotation threads。
- annotation author、reply count 和现有 thread view data。

页面使用一个 AnnotatedPostEditorLayout：

- 左侧为真实 Milkdown/ProseMirror 编辑器。
- 右侧复用 Annotation card 的只读变体。
- Annotation Mark DOM 上继续使用 data-annotation-id。
- active ID 联动 editor mark、connector 与 card。
- 点击 card 定位 editor anchor。
- card 不渲染 Reply CTA、reply composer、delete、remove 或 moderation control。
- 移动端使用只读 Bottom Sheet。

编辑造成 anchor position 变化时，从 EditorView 和 mark DOM 读取实时位置。connector 在 requestAnimationFrame 中合并测量，并用 ResizeObserver 处理 card/editor 尺寸变化。

不得每个字符：

- 全量重新 parse Markdown。
- 重新请求 Annotation threads。
- 对全部 connector 做多轮同步 layout。

确认撤下 anchor 后，对应 card 暂时退出当前连接列表；编辑器保存区显示“保存后将移除 N 条批注”。Undo 后 card 与 connector 恢复。

## 阅读页 Selection Preview

现有添加批注发生在只读 HTML，因此 authoritative selection 仍是：

- AnnotationSelectionDescriptor。
- baseRevisionId。
- selectedText。
- selection 创建时的 DOM Range 和 document epoch。

视觉预览优先使用 CSS Custom Highlight API；不支持时使用由 Range.getClientRects 生成、pointer-events: none 的 overlay rectangles。两者都不改变 DOM 文本、HTML sanitizer 输出或 Markdown。

生命周期：

- 合法 selection 完成后，在显示“添加批注”按钮前创建 preview。
- Bubble Menu 和 composer 打开期间保留。
- 发布成功、取消、点击正文其他位置、selection 失效、revision 变化或 unmount 时移除。
- 取消后仅在 DOM 与 revision 未变化时恢复 native selection 和 editor focus。

点击“添加批注”后不再读取当前 window Selection 作为权威。提交前重新用保存的 descriptor、base revision 和 selected text 校验。失败时保留 composer 内容并要求重新选择。

Annotation Create pending 期间 preview 保留；成功后移除；失败后 composer、内容和 preview 尽量保留。

## Annotation Reply composer

AnnotationThread 调整为：

1. root 作者与时间。
2. original selected text excerpt。
3. root Annotation 正文或 lifecycle placeholder。
4. root Reply CTA。
5. 唯一 composer。
6. 分隔线与回复数量。
7. replies。

每条 reply 的“回复”按钮只设置 shared composer target，并显示“回复 某人”。不能在第 N 条 reply 下创建另一个 editor。

发送成功后清空 composer、更新 submission key，并保持合理 scroll position。失败保留 Markdown、target 和 focus。5 条与 100 条回复都不需要滚到 thread 底部才能回复 root。

桌面 Sidebar 和移动 Bottom Sheet 复用同一个 thread composer state。编辑页只读模式不创建 composer state。

## 本地草稿与 Pending Annotation Removal

LocalDraft 升级为包含：

```ts
type LocalDraft = {
  title: string;
  markdown: string;
  tags: string;
  attachmentIds: string[];
  attachments?: UploadedAsset[];
  baseRevisionId: string | null;
  confirmedAnnotationDeletionIds?: string[];
  updatedAt: number;
};
```

confirmedAnnotationDeletionIds 保存当前 Doc 相对 base Doc 已确认且仍然缺失的 ID。它不是数据库 mutation，也不改变线上 Annotation。

规则：

- 每次 autosave 与 Markdown 同批写入 IndexedDB。
- Undo 恢复 anchor 时从集合移除。
- Redo 后重新加入。
- 放弃草稿删除整个记录。
- 恢复草稿时必须同时恢复 Markdown、base revision 和确认集合。
- 保存成功后删除草稿。
- 保存失败或 conflict 后完整保留。
- pre-V6 草稿不可能合法包含 annotation directive，因为 V5 锁定 annotated Post；不需要猜测旧草稿的删除确认。

## 服务端 Markdown 与 Annotation 验证

新增 validateCanonicalAnnotationDocument：

1. parse canonical Markdown AST。
2. 收集每个 directive 的 ID、block、range、text 和 nested depth。
3. 验证 ID 格式和唯一性。
4. 验证 single allowed block、连续、非空白。
5. 验证 no overlap、no nested。
6. 验证每个 ID 的 Annotation row 存在且 postId 匹配。
7. 验证 Markdown IDs 与提交后的 current membership 完全一致。
8. 验证没有由 Paste 或伪造请求产生的新 ID。

服务端不能从最终 Markdown 判断作者是否真的点击过浏览器弹窗，因此 confirmed deletion IDs 是帖子作者在受认证保存请求中的显式删除声明。服务器仍必须验证声明格式、所属 Post、base membership 和实际 delta。

## Annotation Delta

以服务器当前 revision 为 base：

```text
baseIds      = 当前 post_annotation_anchors
submittedIds = 提交 Markdown 中的合法唯一 IDs

retained   = baseIds ∩ submittedIds
removed    = baseIds - submittedIds
unexpected = submittedIds - baseIds
```

规则：

- unexpected 非空：拒绝，返回 ANNOTATION_INTEGRITY_ERROR。
- actual removed 不是 confirmed deletion IDs 的子集：拒绝。
- confirmed IDs 必须唯一、格式合法并属于 baseIds。
- 多余但当前未 removed 的确认 ID 不执行任何删除。
- retained Annotation row、original_selected_text、content、replies 和 ID 不变。
- 内部正文编辑只改变 canonical Markdown 中的当前 anchor text；original_selected_text 永远不更新。

## Anchor retirement 生命周期

annotations 新增：

- anchor_retired_at。
- anchor_retired_by_user_id。
- anchor_retired_reason：POST_EDIT 或 REVISION_RESTORE。

含义：

- deleted_at 继续只表示批注作者主动删除或现有导入 thread remove 语义。
- anchor_retired_* 表示 thread 因当前版本不再含 anchor 而退出。
- 当前页面是否显示 thread 首先由 post_annotation_anchors 决定。
- anchor-retired thread 的 annotation 和 replies 内容保留，不产生当前页面 orphan placeholder。
- Activity 与 Notification 历史保留，但深链显示“该批注已不属于当前版本”，不泄漏已撤下正文。
- Admin 普通 hide/unhide 不能把 retired thread 重新加入正文。
- 只有 Revision Restore 可以恢复 membership，并清除 source revision 中 anchor 的 retirement 字段。

作者主动删除：

- 有其他成员回复时继续保留 anchor 和“该批注已被作者删除”占位。
- 无依赖讨论时按 V5 逻辑 unwrap anchor，保留 deleted_at；不冒充 POST_EDIT。

## 原子 Save Transaction

保存 annotated Post 的 service 顺序：

1. requireMember 并验证 Post 作者。
2. 加载 Post、current revision、base revision 和 current snapshots。
3. 验证 base revision / overwrite policy。
4. validatePostInput。
5. validateCanonicalAnnotationDocument。
6. 计算 Annotation delta。
7. 验证 confirmed deletion IDs。
8. 验证 assets、tags 与 Annotation ownership。
9. 生成 revision、retirement、asset、tag 和 snapshot plan。
10. 构建一个 D1 batch。

正文、标题或 asset snapshot 变化，或者 Annotation delta 非空时，同一个 batch 包含：

- currentRevisionId CAS guard。
- 新 CONTENT_EDIT revision。
- Post title、Markdown、searchText、edited_at 和 currentRevisionId。
- post_annotation_anchors 的 retained membership。
- removed roots 的 anchor retirement。
- retained roots 的 revision_annotation_states。
- retained roots 所属的 imported reply state snapshot。
- post_asset_refs 与 revision_asset_refs。
- tags。

正文编辑不更新 last_activity_at，不生成公开 Activity 或 Notification。

如果 title、Markdown、asset snapshot 与 Annotation membership 都未变化，只有 tags 变化，则继续沿用 V3 metadata-only save：执行 revision CAS 与 tags batch，不创建 revision，也不更新 edited_at。即使走 metadata-only，也必须验证提交 Markdown 与当前 Annotation membership 一致，不能让 tags-only 请求成为 integrity bypass。

任何 batch 失败后重新查询 currentRevisionId：

- revision 已变化：返回 EditConflict。
- 未变化：返回原始 integrity 或 storage error。

不得先保存正文再异步 retirement，也不得在编辑时提前更新 deleted_at。

## Revision Restore

管理员 Restore 是受控 server pipeline，不经过前端 Guard。

Restore 仍验证：

- source/current Markdown IDs。
- source/current snapshot IDs。
- Annotation ownership。
- assets。
- imported reply states。

Restore batch：

- 复制 source Markdown、title、assets 和 current anchor membership。
- source anchors 清除 anchor retirement，并恢复 source deleted/hidden snapshot。
- 退出 source 的 current anchors 标记 anchor_retired_reason = REVISION_RESTORE。
- 创建新的 RESTORE revision。
- 不更新 last_activity_at，不创建公开通知。

历史 thread 和 replies 不做物理删除。恢复 old revision 后应完整可读。

## Concurrent Edit 与 Force Overwrite

所有 Annotation create、root lifecycle state change和 restore 已经创建 revision；base revision CAS 继续是第一道冲突保护。

Conflict service 在 base 与 current 之间检查 Annotation transition：

- 比较每个相关 revision 的 anchor ID 集合。
- 比较每个 ID 的 anchored text、block type 与 supported inline structure。
- 比较 deleted/hidden root snapshot。
- 比较 imported reply lifecycle snapshot。
- 检查区间内新增、退出或再次恢复的 ID。

只要区间中发生过 Annotation transition，即使最终净集合碰巧相同，也设置 annotationConflict = true。

annotationConflict 为 true：

- 不提供“使用我的版本覆盖”。
- 保留 IndexedDB 草稿。
- 展示线上最新版本和“编辑期间批注状态已变化”。
- 用户重新载入最新版并手动重新应用内容。

annotationConflict 为 false 且只是普通 Post content conflict：

- 保留 V3 的 online / overwrite 流程。
- overwrite 仍以最新 current revision 为 CAS base。
- 保存前重新执行完整 Annotation delta 和 integrity validation。

不实现自动 rebase。

## Global Navigation Progress

根 layout 使用一个由 Vinext 导航生命周期驱动的原生 2px progress bridge，要求：

- 2px 高度。
- 使用现有 accent token。
- 不渲染 spinner 或 shadow。
- hash-only navigation 不创建 loading token。
- 不阻挡 pointer interaction。
- RSC response / navigation promise 完成后结束。
- 新导航会使旧 token 失效，异常、页面卸载和超时都会复位。

项目由 Vinext 构建，因此实现时必须通过：

- npm dependency resolution。
- production build。
- 普通 Link navigation。
- useRouter.push。
- query navigation。
- hash navigation不触发长 loading。

不监听浏览器点击或 monkey-patch history；若第三方包与当前 Vinext 不兼容，应改用 Vinext 的
`onRouterTransitionStart` 和 `__VINEXT_RSC_NAVIGATE__` promise bridge，而不是用固定 trickle
动画冒充完成状态。

## Route Loading、Skeleton 与 Suspense

新增共享 Skeleton primitives，模拟现有页面布局并预留稳定高度。

覆盖：

- 首页 Post list。
- Post detail header、正文和讨论区域。
- User profile 与 Activity。
- Notifications。
- Search results。
- Admin lists。
- Tag detail。
- Revision admin。

建议文件边界：

- app/(site)/loading.tsx：站点级通用列表骨架。
- app/(site)/posts/[id]/loading.tsx：阅读页骨架。
- app/(site)/users/[id]/loading.tsx。
- app/(site)/notifications/loading.tsx。
- app/(site)/search/loading.tsx。
- app/(site)/admin/loading.tsx。
- app/(site)/tags/[name]/loading.tsx。
- app/(site)/admin/revisions/[postId]/loading.tsx。

共享 site layout、header 和 navigation 保持可操作。独立慢查询拆成 async Server Component，并在有实际并行价值时使用 Suspense：

- Post body / Annotation discussion。
- Post replies。
- Notifications list。
- User activity。
- Admin content list。
- Revision preview。

不为了形式把每个组件包进 Suspense。Skeleton 动画延迟出现，避免极短命中时 50ms 闪烁；布局占位可以立即存在。

## Mutation Pending 统一

保留并统一现有 useActionState：

- 发布 Post。
- 保存修改。
- 创建 Annotation。
- 创建 Post Reply。
- 创建 Annotation Reply。
- Post / Reply / Annotation delete。
- imported thread remove。
- Admin hide / unhide / restore。

补足：

- Profile save 的 client pending wrapper。
- 全部通知标记已读的 pending form。
- Revision Restore pending。
- 普通附件上传 progress / pending。
- editor image upload error 与 progress surface。

所有 mutation：

- 按钮立即 disabled。
- 文案立即变为“发布中…”、“保存中…”或具体操作。
- 使用 aria-busy。
- 防双击和重复提交。
- 输入内容只在成功后清空。
- 失败保留正文、composer、draft 和 selection preview。

普通 mutation 不使用全屏 spinner。Post Save 可同时启动顶部 progress，但编辑器和当前上下文保持可见。

## Upload 与 DOCX Loading

DOCX 现有 worker stage、图片计数 progress、取消、错误恢复和 IndexedDB Preview 继续沿用。V6 只统一视觉 token、ARIA 和 reduced motion，不改写 V5.5 parser 或 commit pipeline。

附件和编辑器图片上传显示：

- uploading 状态。
- 可用时显示 percentage；底层无法提供字节进度时至少显示明确阶段。
- 成功后加入 asset state。
- 失败后保留表单和可重试错误。

## Error、Not Found 与访问状态

新增：

- app/error.tsx。
- app/global-error.tsx。
- app/not-found.tsx。
- app/(site)/error.tsx。

错误 UI：

- 不显示 stack、SQL、内部 ID 或 Worker details。
- 提供 Retry。
- 提供返回首页。
- 登录失效引导重新登录。
- 白名单移除继续使用 access-denied 专门状态。
- Annotation integrity error 明确提示正文未保存、草稿仍在本地。
- conflict 与普通服务器错误不混用。

global-error 必须自带 html/body；segment error 复用站点样式和语言。

## Accessibility

- Guard dialog focus trap、Escape 取消、危险按钮非默认 focus。
- 每个 pending button 使用 aria-busy。
- 保存成功、失败、pending removal count 使用合适 live region。
- Skeleton 使用 aria-hidden，真实 loading container 使用 aria-busy。
- Route progress 不是唯一反馈；route skeleton 提供语义 loading。
- Selection Preview 除背景色外增加可见边缘或下划线，满足对比度。
- Sidebar card 与 anchor 的键盘激活、定位顺序保持一致。
- shared reply composer 打开后把 focus 放到编辑器，并提供明确 target label。
- 错误信息使用 role=alert；非危险进度使用 polite live region。

## Reduced Motion

prefers-reduced-motion: reduce 时：

- Route progress 不使用固定 trickle；仅在真实阶段切换时过渡。
- Skeleton 取消 shimmer，仅保留静态占位。
- highlight 不闪烁。
- connector 和 card 不做动画追随。
- scrollIntoView 使用 auto，而不是 smooth。

功能状态不能只靠动画表达。

## Sidebar 性能

- 实时 source 是 EditorState Doc，不是每次序列化后的 Markdown。
- 每次 transaction 只重扫受影响 textblocks；第一版允许 O(document size) 的单次纯扫描，但禁止在同一 keystroke 中重复扫描或叠加 DOM 全量测量。
- React state 只发布 anchor ID、active ID、pending IDs 和经过节流的位置结果。
- connector measurement 合并到一个 requestAnimationFrame。
- ResizeObserver 只观察 editor container、sidebar container 和已挂载 card。
- card layout 延续现有向下避让算法。
- 性能测试至少覆盖长正文、100 条 Annotation cards 和连续输入。

## 测试策略

### 纯函数测试

- Anchor scanner 的 duplicate、split、empty、nested、overlap、invalid block。
- Transaction inspector 的 before/after 分类。
- 多 ID 聚合与 reason 排序。
- Annotation delta 和 confirmed deletion validation。
- Annotation conflict signature 与区间 transition。
- retirement lifecycle 与 restore planner。
- clipboard Slice sanitizer。

### Editor 集成测试

使用真实 ProseMirror/Milkdown schema：

- 内部输入：A:我|喜欢你 → 输入“非常”。
- 内部 Backspace。
- 内部 selection delete。
- 左外边界 Delete。
- 左首字符 Backspace。
- 右外边界 Backspace。
- 右尾字符 Delete。
- 唯一字符删除。
- 整个 Annotation 删除。
- 跨 A、B 的一次确认。
- paragraph / heading / list conversion。
- Enter inside Annotation。
- block join、paragraph delete、indent/outdent。
- formatting 跨 Annotation boundary。
- stale replay。

### Clipboard 与 Drag/Drop

- Copy Annotation 内容后 Paste 到外部，不出现 ID。
- Copy A、B 后 Paste，不产生 duplicate anchors。
- 内部 Paste 继承当前 A，clipboard 自带 Mark 被 strip。
- Cut 内部安全。
- Cut 端点取消后正文不变。
- Cut 端点确认后单 transaction。
- drag copy 与 drag move 都不复制 ID。

### Undo、Redo 与 Draft

- confirm destructive edit → Undo 完整恢复 text、Mark、ID。
- Redo 不重弹。
- Undo 后保存不 retirement。
- Redo 后保存 retirement。
- confirm 后关闭页面、恢复 IndexedDB draft，再保存。
- confirm 后放弃 draft，线上完全不变。
- 保存失败和 conflict 保留 confirmed deletion IDs。

### IME 自动化

- compositionstart / update / end 的内部输入。
- 内部 composition replacement。
- destructive selection 第一次 composition 被阻止且只弹一次。
- cancel 不改变 Doc。
- confirm 后 one-shot token。
- selection 变化使 token 失效。
- 重新输入后单 history transaction。
- Undo composition。

自动化事件模拟不能替代真机结果。

### Server 与 D1

- valid retained anchor save。
- internal anchor text update，ID 与 original_selected_text 不变。
- unconfirmed removed ID 被拒绝。
- unexpected ID 被拒绝。
- duplicate、nested、cross-block、empty 被拒绝。
- multi-remove 一次 batch。
- batch failure 全回滚。
- asset、tag、revision、retirement 与 edited_at 一致。
- last_activity_at 不变。
- Activity / Notification 查询对 retired thread 不报错、不泄漏内容。
- Revision Restore 恢复 anchors、threads、replies、assets。

### Concurrent

- A 打开 annotated Post。
- B 创建 Annotation 或改变 root lifecycle。
- A 保存得到 annotation conflict。
- Force Overwrite 不出现。
- A 的 IndexedDB draft 保留。
- B 的 Annotation 不丢失。

另测纯普通内容冲突且 Annotation 区间无变化时，V3 Force Overwrite 仍可用。

### Selection Preview 与 Reply UI

- Bubble Menu focus 后 preview 仍可见。
- composer 打开、pending 和失败时 preview 保留。
- cancel 恢复 selection。
- revision 变化或 stale descriptor 清除 preview。
- root composer 位于 reply list 前。
- reply target 复用同一 composer。
- 100 条 replies 时无需滚到底部回复 root。
- 编辑页只读 Sidebar 不渲染 mutation controls。

### Loading 与错误 UI

通过开发延迟和网络 throttling 检查：

- Link 导航立即有 route progress / Skeleton。
- Post detail 无长时间白屏。
- Save、Annotation Create、Reply、Delete、Admin、Profile 和 mark-all-read 立即 pending。
- mutation 失败保留输入。
- error、global-error、not-found、access-denied 文案正确。
- reduced motion 下无 shimmer 和长动画。

### 真机 IME 清单

实现完成后由可用真机检查：

- Windows Microsoft Pinyin。
- macOS 中文输入法或等价浏览器环境。

检查内部输入、内部替换、端点 selection、cancel、Undo，不得出现重复字符、Mark 丢失、连续弹窗或 composition 锁死。若当前执行环境无法提供这些输入法，最终报告必须明确标为“待真机验收”，不能声称已通过。

## 解除 V5 编辑锁的发布门

以下条件全部满足后，才同时删除页面与 service 层的 V5 lock：

1. Transaction inspector 测试矩阵通过。
2. Clipboard、Undo/Redo、Draft 和 IME 自动化通过。
3. Server integrity、D1 rollback、revision restore 和 conflict 测试通过。
4. Save/reload 与 boundary delete save 通过。
5. 现有 V1～V5.5 回归测试通过。
6. TypeScript、ESLint、production build 和 rendered artifact assertions 通过。
7. Loading / Selection Preview / Reply UI 浏览器检查通过。
8. 真机 IME 若不可用，保留明确限制并不得把自动化模拟写成真机通过。

解锁必须是最后一个实现里程碑，不能作为第一步。

## 实施里程碑

### Task 1：静态不变量与服务端保存模型

- 完整 Markdown validator。
- Annotation delta。
- retirement schema 与 migration。
- atomic save planner。
- revision restore 与 conflict signature。
- 纯函数和 D1 测试。

### Task 2：AnnotationGuard 核心

- Editor anchor scanner。
- transaction inspector。
- Guard plugin 与确认 controller。
- multi-ID、stale replay 和结构操作。

### Task 3：History、Clipboard、IME 与 Draft

- Slice sanitizer。
- Cut/Paste/Drop。
- Undo/Redo transition registry。
- IndexedDB confirmed IDs。
- IME 安全模式。

### Task 4：Annotated Editor Sidebar 与 Selection Preview

- Editor bridge。
- 编辑页只读 Sidebar / Bottom Sheet。
- live connector。
- readonly DOM selection highlight。

### Task 5：Reply composer 与 Loading / Error 收尾

- 单一顶部 Annotation Reply composer。
- Route progress bridge。
- route Skeleton / Suspense。
- mutation pending 补缺。
- error / global-error / not-found。
- accessibility / reduced motion。

### Task 6：回归、解锁与版本交付

- 完整测试矩阵。
- 浏览器延迟与交互检查。
- 移除 V5 lock。
- 最终 build、review、保存新的 Sites version。
- 是否部署继续遵守 Sites owner-only 私有访问策略和用户当时的明确指令。

## 完成汇报

最终汇报必须覆盖：

1. AnnotationGuard 架构。
2. transaction inspector。
3. 集中规则而非 keydown hacks。
4. 内部插入 / 删除继承。
5. protected endpoint 检测。
6. structural invalidation。
7. multi-Annotation confirm。
8. copy/paste/drop strip。
9. Undo / Redo。
10. IME 安全模式与真机状态。
11. pending deletion 与 IndexedDB。
12. Annotation delta。
13. server integrity。
14. concurrent conflict 与 Force Overwrite。
15. Selection Preview。
16. 编辑页只读 Sidebar。
17. Reply composer。
18. Route progress bridge。
19. loading.tsx / Suspense / Skeleton。
20. mutation pending。
21. error UI、accessibility 和 reduced motion。
22. 当前已知限制。

## 已知限制

- Annotation 仍然只能位于单个允许的文本 block。
- 不允许 overlap、nested、table、image、code 或 attachment Annotation。
- 编辑页 Sidebar 只读。
- 并发冲突不自动 rebase。
- 破坏性 IME selection 确认后需要用户重新输入。
- 真机 Windows/macOS IME 是否通过必须按实际可用环境报告。
- 路由 progress bridge 必须通过当前 Vinext navigation compatibility gate。
- Word Online fixture 仍是 V5.5 的独立已知缺口，不属于 V6 AnnotationGuard 范围。

## 最终验收定义

V6 只有在以下整体行为成立时完成：

```text
普通编辑
→ 不打扰

Annotation 内部编辑
→ 不打扰，Mark 与 ID 保留

Annotation 外部编辑
→ 不打扰，不扩张 Mark

普通 formatting
→ 不打扰

受保护端点或结构被破坏
→ 一次明确确认

确认
→ 本地单 history transaction

Undo / Redo
→ 完整恢复 / 重放，不重复询问

Save
→ Markdown + Revision + Annotation + Assets 原子一致

Conflict
→ 不静默覆盖任何并发批注变化

明显等待
→ 立即出现 route progress、Skeleton 或局部 Pending
```

V6 不以“能打开 annotated Post 编辑页”为成功，而以普通写作无感、真正破坏才介入、保存绝不失去批注语义为成功。
