# 知临中学 V7 发布收尾报告

## 当前状态

- 日期：2026-09-03
- 分支：`feature/v7-hardening`
- 基线：`488ab91`
- 阶段：设计与实施计划完成，代码实现进行中，尚未发布
- 自动化基线：317 tests / 316 pass / 1 approved skip
- 浏览器门：`BLOCKED`；Work cloud browser 对健康的 Site preview 返回 `ERR_BLOCKED_BY_CLIENT`

## 可行性裁决

没有整体技术不可行项。已确认并写入设计的非字面实现包括：access 与 target 状态分层；24 小时 IndexedDB Preview 由 7 天 temporary 窗口保护；R2/D1 以 claim/recheck/retry 实现工程安全而非伪装成跨存储事务；Milkdown 多文件上传先通过集成 risk gate；owner-only 托管暂不向其他 allowlist 成员开放。

以下 16 节是 V7 完成时的强制交付结构。在取得证据前一律保留 `PENDING`，不填写推测结果。

## 1. Annotation card collision algorithm

`PARTIAL`：现有算法已按 document order 稳定排序并只向下推，基线测试通过。V7 geometry、long-thread 与 browser evidence 待完成。

## 2. Connector geometry 与重算机制

`PENDING`：待完成 gutter routing、font/image hooks、single layout mode 与 unchanged-geometry suppression。

## 3. Notification deep-link / highlight

`PENDING`：当前 root target 使用稳定 ID；exact Annotation Reply target 与 transient highlight 尚缺。

## 4. deleted / hidden / historical-unavailable 状态矩阵

`PENDING`：设计采用 access result + target resolution 两层状态；实现与测试待完成。

## 5. Route skeleton / loading

`PARTIAL`：site、post、profile、notifications、search、tag、admin、revision 已有 route loading；局部 retry 与防闪烁审计待完成。

## 6. Mutation failure / retry

`PENDING`。

## 7. Auth expiry 与本地内容保护

`PENDING`。

## 8. Duplicate submit protection

`PARTIAL`：Reply、Annotation、Annotation Reply、DOCX、lifecycle、restore、mark-read 已有服务端保护；create Post 缺失。

## 9. D1 indexes 与对应 query

`PENDING`：只在 query plan 证明后填写实际新增/替换索引。

## 10. 消除的 N+1

`PENDING`：已定位 Post list、Reply target user、Activity/Notifications lifecycle、Tag counts。

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

