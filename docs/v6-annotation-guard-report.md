# V6 AnnotationGuard 完成与验收报告

日期：2026-09-01
分支：`feature/v6-annotation-guard`

V6 已解除“存在正文批注时禁止编辑”的 V5 临时限制。作者现在可以正常编辑带批注帖子：保持 anchor 语义的操作直接通过，真正破坏端点或结构的操作才会被集中拦截并要求确认。编辑页批注 Sidebar / 移动端 Sheet 继续只读；服务器仍是 canonical Markdown 与 Annotation 生命周期的一致性权威。

## 1. AnnotationGuard 架构

保护分为三层：

1. `lib/editor/annotation-guard.ts` 是纯 transaction inspector，比较 ProseMirror transaction 前后文档。
2. `lib/editor/annotation-session.ts` 与 `annotation-guard-plugin.ts` 管理阻止、确认、stale 检查、IME 安全模式和 history transaction。
3. `lib/annotations/save-plan.ts`、`lib/posts/service.ts` 与 `lib/posts/save-transaction.ts` 在服务端重新验证 Markdown、Annotation delta、确认集合、revision 基线和原子写入。

输入入口的 clipboard / composition 适配只负责把操作标准化；最终是否允许仍由同一个 document invariant 检查决定。

## 2. Transaction inspector 如何工作

`inspectAnnotationTransaction(beforeDoc, transaction)` 首先跳过不改变文档的 transaction，然后用 `analyzeAnnotationRanges` 扫描前后 anchor。它通过 transaction mapping 检查原始左右端点是否仍映射到同一连续 range，并聚合 `REMOVED`、`LEFT_ENDPOINT_REMOVED`、`RIGHT_ENDPOINT_REMOVED`、`EMPTY`、`MULTI_BLOCK`、`DUPLICATE`、`OVERLAP`、`NESTED`、`INVALID_BLOCK`。结果只有 `SAFE` 或一个按正文位置稳定排序的 `ANNOTATION_IMPACT`。

## 3. 为什么不是一组 keydown hacks

Guard 检查 proposed document，而不是键名。键盘输入、selection replacement、Paste、Cut、Drop、IME、command 和未来编辑器插件只要形成 ProseMirror transaction，就共享同一套前后文档规则。`docChanged === false` 的 Bold、Italic、Strike、Link 等格式 transaction 不会触发撤下批注。

## 4. 内部插入 / 删除如何继承 Annotation Mark

Annotation Mark 在 `lib/editor/annotation-mark.ts` 中设置 `inclusive: false`，因此左右外边界输入不会扩张 anchor。严格位于 anchor 内部的普通输入由 ProseMirror 继承当前 Mark；Paste 先剥离来稿携带的 Annotation Mark，再由 `inheritDestinationAnnotationMark` 继承目标位置的既有 ID。内部删除只要原左右端点仍存在、range 非空且结构合法，就直接通过，ID 不变。

## 5. Boundary destruction 如何检测

Inspector 保存每个旧 anchor 的 first / last text endpoint，并用 `transaction.mapping.mapResult` 分别检查边界位置和端点文字。删除首字符、尾字符、唯一字符、整个 anchor，或 replacement 覆盖任何受保护端点，都会产生 destructive impact。Dialog 默认焦点在“取消”，展示作者、回复数与最多五条 excerpt；多个原因不会造成重复弹窗。

## 6. Structural invalidation 如何检测

`analyzeAnnotationRanges` 对 proposed document 验证 anchor 仍是单个允许 text block 内的单一、连续、非空、非重叠、非嵌套 range。Enter 将 anchor 拆为多 block、block join / delete 造成非法结构时会被拦截；paragraph / heading 转换或 list 包裹如果最终仍满足不变量则直接允许。

## 7. 多 Annotation 删除如何处理

Inspector 一次收集所有受影响 ID，去重并按正文位置排序。Session 只创建一个 pending token，Dialog 显示总数与最多五条摘要；确认后同一 composite transaction 执行原编辑并移除所有受影响 Mark。

## 8. Copy / Paste 如何防止 duplicate Annotation ID

`lib/editor/annotation-clipboard.ts` 递归映射 ProseMirror Slice，复制、粘贴、剪切和拖放均剥离 Annotation Mark / `annotationId`，同时保留文本和普通 marks。Paste 到 anchor 严格内部时再继承目标 anchor 的既有 Mark。任何新 ID 仍只能通过受控 Annotation 创建、DOCX Import 或 Revision Restore 进入 canonical Markdown。

## 9. Undo / Redo 如何恢复 Annotation

确认后，原 proposed steps 与受影响 Mark removal 被合并到同一个 `addToHistory: true` transaction，并附加 `annotationGuard` meta。Undo 因而同时恢复文字、Mark 和 ID；Redo 重放已登记 transition，不再次弹窗。Session 只保留有限的 transition signature，并在 doc / selection / epoch 不匹配时安全失败，避免 stale replay。

## 10. IME 如何处理

普通内部 composition 直接通过。若 composition 开始前的 selection 会破坏端点，safe mode 在候选文字落地前捕获“删除 selection”的 proposed transaction；确认后不重放已捕获的操作系统候选文本，而是要求用户重新输入一次，并只在相同 doc / selection / epoch 下授权下一次 composition。composition cancel 清理 pending / authorization，防止重复字符和连续弹窗。

自动化已覆盖 composition start、内部输入、边界 replacement、确认重入、cancel 与 Undo safety。Windows Microsoft Pinyin 和 macOS 原生输入法在当前执行环境不可用，状态为 **待真机验收**，本报告不声称二者已经通过。

## 11. Pending deletion 为什么只保存在本地

确认 destructive edit 只更新 editor document、history，以及 IndexedDB draft 中的 `confirmedAnnotationDeletionIds`；不会提前修改 D1 的 `annotations` / anchor 行。这样 Undo、关闭页面、保留草稿和放弃草稿都不会改变线上正文或 thread。只有“保存修改”成功后服务器才提交 retirement。

## 12. Save 时 Annotation delta 如何计算

服务器以当前 revision 的 anchor IDs 为 `baseIds`，从提交的 canonical Markdown 重新扫描 `submittedIds`，得到 `retained`、`removed`、`unexpected`。内部编辑仍含原 ID，因此属于 retained；已确认撤下的 ID 消失，因此属于 removed；提交文档中凭空出现的 ID 属于 unexpected 并拒绝保存。`original_selected_text` 不参与当前 anchor 更新，继续保存创建时的历史文本。

## 13. Server 如何阻止未经确认的 Annotation 丢失

`planAnnotatedPostSave` 重新验证 canonical AST、允许 ID 集合和 Annotation 状态归属。它要求每个 actual removed ID 都属于客户端提交的 confirmed deletion IDs，并拒绝不在 base 中的确认 ID 或 unexpected ID；失败统一抛出 `ANNOTATION_INTEGRITY_ERROR`。因此绕过客户端、插件遗漏或损坏草稿都不能静默删除 thread。

## 14. Concurrent Annotation / edit conflict 如何处理

保存前要求 `baseRevisionId` 与线上 current revision 匹配，并在 D1 batch 中再次用 current revision guard 防竞态。如果基线到当前版本存在新批注、删除或 anchor state 变化，conflict snapshot 会标记 `annotationStateChanged` 并将 `forceOverwriteAllowed` 设为 false，界面不显示“使用我的版本覆盖”。IndexedDB 本地草稿保留，用户需载入线上最新版并手动重做修改。

## 15. Selection preview decoration 如何解决选区消失

合法 selection 出现 Bubble Menu 前会保存 ProseMirror from / to、base revision、selected text 和 document epoch。`selection-preview.ts` 用 editor-native / CSS Highlight 等价 preview 显示高对比度选区，不依赖失焦后会消失的浏览器原生 selection。Bubble、composer、pending 和失败重试期间 preview 保留；成功、取消、正文重新点击、revision 变化或 unmount 时清理。提交使用保存的 descriptor 并重新验证，不重新读取 DOM Selection。

## 16. Annotation Reply composer 为什么调整到 thread 顶部

Root 的“回复批注”及唯一共享 composer 现在紧跟批注正文，位于 reply count / list 之前，所以 5 条或 100 条回复都无需滚到末尾。点击某条 reply 的“回复”仍打开同一顶部 composer，并显示目标作者；thread 不会在第 N 条回复下生成第二个输入区。编辑页 Sidebar / Sheet 继续只读。

## 17. Route progress 如何实现

`components/loading/route-progress.tsx` 在 root layout 提供 2px、主题 `--green`、不阻挡交互的
原生 progress bridge。`instrumentation-client.ts` 在真实路由转换开始时发出事件，bridge 包装
Vinext 的 `__VINEXT_RSC_NAVIGATE__` promise，并在 RSC response 到达时推进阶段、promise settle
时完成；hash-only 导航不触发长 loading。没有固定 trickle 动画，页面卸载、异常、重复导航和
30 秒 watchdog 都会清理状态。全局 CSS 在 `prefers-reduced-motion` 下停用过渡。

## 18. loading.tsx / Suspense / Skeleton 覆盖

Segment skeleton 已覆盖站点首页、Post detail、User profile、Notifications、Search、Admin、Admin revision preview 和 Tag page。局部 Suspense 覆盖 Post body / discussion、Notifications list、User profile content、Admin list 与 revision preview，使共享 layout / navigation 在慢查询期间保持可用。全局与站点区域 `error.tsx`、`global-error.tsx`、`not-found.tsx` 提供 Retry / 返回首页且不泄漏 stack。

## 19. Mutation pending state 覆盖

即时局部反馈覆盖：发布帖子、保存修改、创建 Annotation、创建 Post Reply、创建 Annotation Reply、删除内容、Admin hide / restore、revision restore、全部通知标记已读和 Profile save。按钮进入 disabled + `aria-busy` 并显示“发布中…”“保存中…”等 compact 状态；输入内容只在成功后清空，失败继续保留。图片 / 附件与 DOCX 继续使用具体上传百分比和 Parsing / Extracting / Building preview / Uploading / Ready 阶段，不改成全屏 spinner。

## 20. 当前已知限制

- 仍不支持 cross-block、overlap、nested、image、table Annotation；这些是明确的 V6 非目标。
- 不提供自动 rebase、协同编辑、WebSocket、用户可见 revision history 等扩展能力。
- Windows Microsoft Pinyin 与 macOS 原生 IME：**待真机验收**；现有结论只来自确定性 transaction / composition 测试。
- Sites 本地预览已报告 healthy，但云浏览器访问内部 preview 地址返回 `net::ERR_BLOCKED_BY_CLIENT`。按 Sites 预览故障协议判定为执行环境阻断，因此未声称 Task10 的人工桌面 / 移动浏览器矩阵已经通过。
- Word Online 公共 DOCX fixture 因来源与再分发限制保留一个显式 skip；其原因在测试内记录。

## 自动化证据

| Gate | 命令 | 结果 |
|---|---|---|
| Pre-unlock | `npm test` | V5 锁仍在时通过 |
| Unlock RED | `node --experimental-strip-types --test tests/annotation-edit-lock.test.ts tests/annotation-guard-integration.test.ts` | 按预期仅旧 UI 锁断言失败 |
| Focused unlock GREEN | 同上 | 6 / 6 通过 |
| V6 focused matrix | `node --experimental-strip-types --test` 加载 13 个 V6 测试文件 | 77 / 77 通过 |
| Unit suite | `node --experimental-strip-types --test tests/*.test.ts` | 315 total；314 passed；1 explicit skip；0 failed |
| Full regression | `npm test` | unit、production build、rendered artifact 8 / 8 通过 |
| TypeScript | `npx tsc --noEmit` | 通过 |
| Lint | `npm run lint` | exit 0；仅工具自身输出既有 `jsx-ast-utils` AwaitExpression diagnostic |
| Frontend strict audit | `audit_project.py . --mode strict --no-write` | 0 findings |
| Design contract lint | `npx -p @google/design.md designmd lint DESIGN.md` | exit 0；0 errors；14 个既有 orphaned-token warnings |
| Browser preview | `sites-preview start` / `sites-preview status` | preview healthy；云浏览器连接被客户端策略阻断，人工矩阵未声称通过 |

## 结论

V6 的自动化发布门已验证：普通编辑不受打扰；内部编辑保留 Annotation ID；受保护端点或非法结构只在确认后于本地撤下；Undo / Redo 可恢复；服务端以 canonical AST、confirmed delta、revision guard 和 D1 batch 保证 Markdown、Annotation、revision 与 assets 原子一致。V5 临时编辑限制已删除，受保护端点、只读编辑 Sidebar 和 safe-mode IME 决策均保留。
