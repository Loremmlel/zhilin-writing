# 知临中学 V7 发布收尾报告

## 当前状态

- 日期：2026-09-03
- 分支：`feature/v7-hardening`
- 基线：`488ab91`
- 阶段：设计与实施计划完成，代码实现进行中，尚未发布
- 自动化当前：345 tests / 344 pass / 1 approved skip（以最终回归为准）
- 浏览器门：`BLOCKED`；Work cloud browser 对健康的 Site preview 返回 `ERR_BLOCKED_BY_CLIENT`

## 可行性裁决

没有整体技术不可行项。已确认并写入设计的非字面实现包括：access 与 target 状态分层；24 小时 IndexedDB Preview 由 7 天 temporary 窗口保护；R2/D1 以 claim/recheck/retry 实现工程安全而非伪装成跨存储事务；Milkdown 多文件上传先通过集成 risk gate；owner-only 托管暂不向其他 allowlist 成员开放。

以下 16 节是 V7 完成时的强制交付结构。在取得证据前一律保留 `PENDING`，不填写推测结果。

## 1. Annotation card collision algorithm

`PARTIAL`：按 `(anchorY, annotationId)` 稳定排序，首卡取 `desiredTop`，后续卡取 `max(desiredTop, previousBottom + gap)`，只向下推。长 thread 自然增高并继续推动后卡；自动测试已通过，browser evidence 待完成。

## 2. Connector geometry 与重算机制

`PARTIAL`：起点取正文/编辑器右缘后的 gutter，终点取 card 左缘稳定 attachment point；窄 gutter 降级为短直线。font ready、image load、ResizeObserver、window resize 和模式切换经单一 `requestAnimationFrame` scheduler 重算；相同 geometry 保持 state identity。browser evidence 待完成。

## 3. Notification deep-link / highlight

`PARTIAL`：Post Reply、Annotation root、Annotation Reply 均使用实体 ID URL/DOM target；Annotation Reply 精确到 reply ID。页面进入 viewport 后高亮 2 秒并渐退，reduced motion 下取消平滑滚动。桌面联动 anchor/card，compact 模式打开对应 sheet。browser evidence 待完成。

## 4. deleted / hidden / historical-unavailable 状态矩阵

`PARTIAL`：已实现 access result + target resolution 两层状态，并区分 author deleted、admin hidden、not current revision、post unavailable、not found；hidden 原文不进入普通用户 view model。browser evidence 待完成。

## 5. Route skeleton / loading

`PARTIAL`：site、post、profile、notifications、search、tag、admin、revision 已有 route loading；Post 正文/讨论、Profile 内容、Notifications、Admin 列表、Revision Preview 使用保留外层页面和 URL 状态的局部 Error Boundary + Retry。局部 skeleton 保留几何但延迟 160ms 显示，短请求不闪烁；browser evidence 待完成。

## 6. Mutation failure / retry

`PARTIAL`：typed action failure 会结束 pending 并保留受控输入；白名单表单改为 inline retry。图片/附件按文件保留 success / failed / pending，失败项单独 Retry / Remove；browser failure injection 待完成。

## 7. Auth expiry 与本地内容保护

`PARTIAL`：server action 与 asset/DOCX API 已区分 `AUTH_EXPIRED`、`ACCESS_REVOKED`；前者允许重新登录后重试，后者阻止继续提交，二者均不删除 IndexedDB draft 或受控输入。顶层 SIWC 与 browser evidence 待完成。

## 8. Duplicate submit protection

`PASS (automated)`：Reply、Annotation、Annotation Reply、DOCX、lifecycle、restore、mark-read 延续既有保护；create Post 新增持久化在 IndexedDB draft 的 UUID，并以 D1 `(author_id, creation_submission_key)` unique index 在请求前与并发冲突后回查同一实体。

## 9. D1 indexes 与对应 query

`PASS (SQLite equivalent EXPLAIN)`：

- `posts_author_published_idx(author_id, published_at)`：替换 author-only index，服务 Profile Posts 的 author filter + published order；仍保留 left-prefix author lookup。
- `replies_post_published_idx(post_id, published_at)`：替换 post-only index，服务 Post Detail replies 的 post filter + document order；仍服务按 post 聚合计数。
- `post_tags_tag_post_idx(tag_id, post_id)`：服务 Tag → Post lookup 与 tag count join；原主键继续服务 Post → Tags。
- 已有 `posts_published_at_idx`、`posts_last_activity_at_idx`、`activity_events_actor_created_idx`、两组 recipient notification indexes、Annotation/Annotation Reply created indexes、revision post-number unique index 均经现有 query plan 复核，未重复加索引。
- Admin lifecycle 是低频、上限 100 的维护查询，bounded `%LIKE%` search 是小站明确取舍，均未为其过度索引。

## 10. 消除的 N+1

`PASS (automated query-shape)`：Post lists 从 `1 + 2N` 改为主查询 + tags batch + reply-count group；Reply target users 分块 batch（每块 ≤90）；Activity lifecycle 从 per-row 查询改为固定 4 个 discussion/anchor batch 加一个 user batch；Notifications 从 `1 + 4N` 改为主查询 + 4 个 lifecycle batch；Tags 从 `1 + N` 改为单次 grouped join。

## 11. Temporary / orphan R2 GC 规则

`PASS (automated)`：temporary 只有同时满足 `created_at ≤ now-7d`、`expires_at ≤ now`、无 current/revision/avatar ref 才候选；24 小时 IndexedDB DOCX Preview 因此不会触达物理删除窗口。permanent 且零引用归类为 `PERMANENT_ORPHAN`。候选先 claim，所有 Post/DOCX/avatar binding 都拒绝已 claim asset，删除前再次查 current/revision/avatar ref；引用在 claim 前后出现时释放 claim，不删 R2。另有按单一 owner UUID prefix、每页 ≤90 的 R2 inventory scan，只识别 7 天前且符合本站 key 结构、D1 完全无 metadata 的对象。

## 12. GC dry-run 与 failure retry

`PASS (automated)`：`collectOrphanedAssets` 默认 `dryRun=true`，报告 candidate count、bytes、asset IDs、`EXPIRED_TEMPORARY | PERMANENT_ORPHAN` reasons 且零 mutation。执行模式逐项处理；R2 不可用/删除失败不会删除 DB metadata，也不阻塞后续 candidate，并持久化 failure count、time、code。claim 一小时后才可重试，避免并发 maintenance 重入；R2 已删但 metadata update 失败也保留可重试记录。无 metadata 的 `UNTRACKED_R2_OBJECT` 执行还必须提交与 dry-run 完全一致的 asset ID 集合，并在每次删除前再次查询 D1。

## 13. Mobile / tablet Annotation breakpoint

`PARTIAL`：Annotation 组件以实际容器宽度为唯一来源；至少 1060px 才进入 `desktop`（720px 正文 + 70px gutter + 270px rail），否则统一进入 compact sheet，CSS、connector 与交互消费同一 data attribute。320/375/390/430/768/820/1024px browser evidence 待完成。

## 14. Accessibility 修复

`PARTIAL`：interactive annotation mark 可 Tab 聚焦并以 Enter/Space 打开对应 thread；Modal/Sheet 已有顶层 focus trap、Escape 和关闭后触发点焦点恢复；补充全站 `:focus-visible` 与 forced-colors outline，compact 宽度的主要按钮/链接/批注操作统一至少 44px。Markdown 表格局部横向滚动，长正文/文件名换行，页面不以隐藏 overflow 掩盖问题。完整键盘与屏幕阅读器 browser evidence 待完成。

## 15. Slow-network / failure-injection 结果

`PARTIAL`：自动 failure injection 已覆盖 D1 batch 中途失败全回滚、R2 upload/delete/metadata failure、asset bind claim guard、auth typed failure 与 optimistic revision conflict；各项均保持输入或一致性并提供恢复路径。浏览器 throttling 与交互证据仍因 browser blocker 为 `BLOCKED`。

## 16. 尚存已知限制

- Work cloud browser 当前无法打开 Site preview，发布门未通过。
- SIWC dispatcher 接管的顶层 session 失效可能不经过应用 typed result。
- R2/D1 不具备跨存储事务。
- bounded `%LIKE%` search 保留全表扫描取舍。
- Milkdown/Crepe 的独立编辑器 chunk 约 1.19 MB minified，构建仍提示单 chunk 超过 500 KB；已从普通帖子阅读依赖中移除，只在打开 composer、帖子编辑或 DOCX Preview 时按需加载。进一步缩小需替换既有编辑器栈，V7 不做高风险重写。
- 生产错误日志只输出 operation、entity ID、内部 user ID、error code 和随机 request ID；测试证明不序列化 exception message/stack、email 或正文载荷。通用 mutation failure 对用户只返回固定恢复文案。
- owner-only deployment 暂时阻止其他 allowlist 成员。

## 证据索引

- 设计：`docs/superpowers/specs/2026-09-03-release-hardening-v7-design.md`
- 实施计划：`docs/superpowers/plans/2026-09-03-release-hardening-v7.md`
- 回归矩阵：`docs/testing/v7-regression-matrix.md`
- V6 基线：`docs/v6-annotation-guard-report.md`
