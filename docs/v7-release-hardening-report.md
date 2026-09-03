# 知临中学 V7 发布收尾报告

## 当前状态

- 日期：2026-09-03
- 分支：`feature/v7-hardening`
- 基线：`488ab91`
- 阶段：设计与实施计划完成，代码实现进行中，尚未发布
- 自动化当前：336 tests / 335 pass / 1 approved skip（以最终回归为准）
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

`PARTIAL`：site、post、profile、notifications、search、tag、admin、revision 已有 route loading；局部 retry 与防闪烁审计待完成。

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

`PENDING`。

## 12. GC dry-run 与 failure retry

`PENDING`。

## 13. Mobile / tablet Annotation breakpoint

`PENDING`：当前 900px 仅为保留基线；实际 viewport 验收前不宣布最终值。

## 14. Accessibility 修复

`PENDING`。

## 15. Slow-network / failure-injection 结果

`BLOCKED/PENDING`：浏览器 slow-network 受环境阻断；服务 failure injection 待实现。

## 16. 尚存已知限制

- Work cloud browser 当前无法打开 Site preview，发布门未通过。
- SIWC dispatcher 接管的顶层 session 失效可能不经过应用 typed result。
- R2/D1 不具备跨存储事务。
- bounded `%LIKE%` search 保留全表扫描取舍。
- owner-only deployment 暂时阻止其他 allowlist 成员。

## 证据索引

- 设计：`docs/superpowers/specs/2026-09-03-release-hardening-v7-design.md`
- 实施计划：`docs/superpowers/plans/2026-09-03-release-hardening-v7.md`
- 回归矩阵：`docs/testing/v7-regression-matrix.md`
- V6 基线：`docs/v6-annotation-guard-report.md`
