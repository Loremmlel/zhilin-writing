# 知临中学 V7 发布回归矩阵

## 状态定义

- `PASS`：已经在当前提交取得可复核证据。
- `FAIL`：已经执行且不符合预期。
- `BLOCKED`：环境或前置任务阻止执行，不能视为通过。
- `PENDING`：尚未执行。

每次验证记录：commit、环境、viewport/network/failure 条件、预期、实际、证据和复测人。自动化通过不能代替标记为 browser 的项目。

## 当前基线

- V6 基线：`488ab91`
- V7 实现：`2a8c3d5..208b4a0`，最终证据随本报告提交封存
- Unit：`PASS`，346 tests / 345 pass / 1 approved skip
- Site preview process：`PASS`
- Work cloud browser navigation：`BLOCKED`，三次均为 `ERR_BLOCKED_BY_CLIENT`
- Browser gate exception：`AUTHORIZED`，用户于 2026-09-03 明确允许因沙箱限制跳过；所有 browser rows 仍保持 `BLOCKED` 而非 `PASS`
- Build / rendered HTML：`PASS`，production build + 9/9 rendered artifact checks
- TypeScript / ESLint：`PASS`

## Auth

- [ ] `PENDING` signed out 首次访问进入 Sign in with ChatGPT。
- [ ] `PENDING` allowlist member 可以访问私人页面。
- [ ] `PENDING` session 有效但 allowlist 移除返回 `ACCESS_REVOKED`，停止私人数据请求。
- [ ] `PENDING` 编辑中 session 过期返回 `AUTH_EXPIRED`，当前输入与 IndexedDB draft 保留。
- [ ] `PENDING` top-level SIWC 跳转后草稿仍可恢复。

## Post

- [ ] `PENDING` create，含 double-click / browser retry 只创建一个实体。
- [ ] `PENDING` ordinary edit。
- [ ] `PENDING` annotated internal edit。
- [ ] `PENDING` AnnotationGuard destructive edit confirm / cancel / undo / redo。
- [ ] `PENDING` author delete、admin hide、restore 使用不同文案且不泄漏正文。
- [ ] `PENDING` optimistic revision conflict 保留本地内容且不产生 ghost revision。

## Reply

- [ ] `PENDING` root reply。
- [ ] `PENDING` nested reply 保持两层视觉模型。
- [ ] `PENDING` deleted parent 只在可见依赖需要时保留 placeholder。
- [ ] `PENDING` notification deep link 按 reply ID 定位并短暂高亮。
- [ ] `PENDING` failed mutation 保留编辑内容，同一 key 可重试且不重复。

## Annotation

- [ ] `PENDING` create / reply / delete / hide / restore。
- [ ] `PENDING` root composer 始终位于 replies 之前，长 thread 无需滚到底部回复 root。
- [ ] `PENDING` cards 按文档顺序、只向下碰撞、不重叠。
- [ ] `PENDING` connector 不穿正文/card，active 仅关联一个 annotation ID。
- [ ] `PENDING` font/image/card resize 后 geometry 正确，scroll 不全量 rerender。
- [ ] `PENDING` Annotation root deep link 桌面定位 anchor + card。
- [ ] `PENDING` Annotation Reply deep link 定位 exact reply。
- [ ] `PENDING` mobile/compact deep link 打开对应 sheet。
- [ ] `PENDING` current revision 退出后显示历史版本语义。

## DOCX

- [ ] `PENDING` normal import。
- [ ] `PENDING` annotations / replies / warnings / attribution。
- [ ] `PENDING` failed upload 保留可恢复 Preview。
- [ ] `PENDING` duplicate commit 只生成一个 batch/post/activity/notification set。

## Assets

- [ ] `PENDING` multi-file upload 支持 success / failed / pending 并存。
- [ ] `PENDING` 单文件 retry 不重传 success 项。
- [ ] `PENDING` historical revision asset 仍受引用保护。
- [ ] `PENDING` temporary GC 只处理超过 7 天且无任何引用的 asset。
- [ ] `PENDING` orphan GC dry-run 报告 count / bytes / ids / reasons 且零 mutation。
- [ ] `PENDING` R2 delete failure 保留 metadata、记录失败并允许后续 retry。

## Loading / Error / Retry

- [ ] `PENDING` route navigation 即时 top progress。
- [ ] `PENDING` initial page data 使用 geometry-stable skeleton。
- [ ] `PENDING` local fast request 不发生可见 skeleton flash。
- [ ] `PENDING` Post / Notifications / Annotation / Profile / Search / Admin / DOCX / R2 失败均有明确 Retry。
- [ ] `PENDING` mutation 失败结束 pending、保留输入、无 Activity/Notification/ghost UI。

## Responsive

- [ ] `BLOCKED` 320px，无页面级横向滚动。
- [ ] `BLOCKED` 375px，无页面级横向滚动。
- [ ] `BLOCKED` 390px，无页面级横向滚动。
- [ ] `BLOCKED` 430px，无页面级横向滚动。
- [ ] `BLOCKED` 768px，Annotation layout 合理。
- [ ] `BLOCKED` 820px，Annotation layout 合理。
- [ ] `BLOCKED` 1024px，正文、gutter 与 rail 均不拥挤。
- [ ] `BLOCKED` common desktop，长文/长 thread/cards/connectors 稳定。
- [x] `PASS (automated contract)` long URL / inline code / code block / table / filename / unbroken text 均使用局部 scroll/wrap；真实 viewport 仍受上方 browser rows 阻塞。

## Accessibility / History

- [ ] `BLOCKED` Tab 顺序和 visible focus。
- [ ] `BLOCKED` Annotation range Enter/Space 激活准确 thread。
- [ ] `BLOCKED` modal/sheet focus trap 与关闭后 focus return。
- [ ] `BLOCKED` 主要移动操作 touch target 至少 44px。
- [ ] `BLOCKED` reduced motion 与 forced colors。
- [ ] `BLOCKED` Search / Tag / Notification / Profile tabs / Post Back-Forward 保留正确 URL、目标与 scroll。

## Slow network

- [ ] `BLOCKED` annotated Post save。
- [ ] `BLOCKED` create Annotation。
- [ ] `BLOCKED` Annotation Reply。
- [ ] `BLOCKED` DOCX Import。
- [ ] `BLOCKED` Revision Restore。

每项必须验证：立即反馈、button pending、no double submit、输入保留、Retry、无异常 layout jump。

## Failure injection

- [x] `PASS (automated)` D1 mutation failure：batch 全回滚，无 ghost relation。
- [x] `PASS (automated)` R2 upload/metadata failure：best-effort compensation，失败进入 orphan scan。
- [x] `PASS (automated)` R2 delete failure：metadata 保留并记录可重试失败。
- [x] `PASS (automated)` notification query failure：受保护 shell 不被未读计数拖垮。
- [x] `PASS (automated)` asset bind failure：GC claim 阻止绑定，最终引用复查胜出。
- [x] `PASS (automated)` auth expiry during edit：typed result 不清空受控输入/IndexedDB draft。
- [x] `PASS (automated)` optimistic revision conflict：保留本地选择且不产生 ghost revision。

每项必须记录：数据一致性、用户可见说明、恢复路径、日志 redaction、是否产生重复或 ghost state。

## Deployment gate

- [x] `PASS` migrations 在空库与带既有数据的 V6 fixture 升级通过。
- [ ] `PENDING` D1 / R2 bindings、allowlist、admin identity 正常。
- [ ] `PENDING` production 无 fixture/mock/test account/debug backdoor。
- [ ] `PENDING` 记录前一个稳定 Sites version。
- [ ] `AUTHORIZED` owner-only/private deployment；用户已明确批准浏览器门例外，等待 Sites terminal status。
- [ ] `PENDING` production smoke test。
- [ ] `PENDING` rollback procedure 验证。
