# V5.5 DOCX Import 进度

## 2026-08-28 — 设计与实施计划

- 状态：完成并已获用户确认。
- 已确认：浏览器 Worker 内的轻量 OOXML Import Walker；ZIP/XML 使用成熟库，本站语义层自研。
- 已确认：Import IR、单遍 comment range、typed warnings、deterministic overlap、thread 原子跳过。
- 已确认：imported identity 永不伪装 native author，attribution 不授予权限。
- 已确认：单次 D1 batch、R2 temporary asset、initial revision、batch 幂等。
- 已确认：Preview/IndexedDB 24 小时恢复、真实 producer fixtures、TDD、分功能提交与 owner-only 私有部署。
- 规范：`docs/superpowers/specs/2026-08-28-docx-import-v5-5-design.md`
- 原始需求归档：`docs/V5.5原始spec.md`；内容与用户提供的 `V5.5原始spec.md` 在统一换行后逐字符一致，源文件 SHA-256 为 `9807b2d397d8e3aa5a31e5dd17b3ce77ba7bfc0381b58213550a48b8620d17bf`。该文件仅作原始资料，实施状态以已确认设计、计划、ledger 和后续用户指令为准。
- 计划：`docs/superpowers/plans/2026-08-28-docx-import-v5-5.md`，13 个 Task；每个 Task 完成后独立提交、推送并暂停等待确认。
- 验证：20 个必需 warning code、全部固定安全限额、幂等/身份/revision/R2 约束均已通过文档静态自审；`git diff --check` 通过。
- 提交：设计 `fed4755`；实施计划 `984b4a3`。

## 2026-08-28 — Task 1：officeparser feature probe

- 状态：完成；本条 ledger 与 Task 1 代码、测试、fixtures、ADR 在同一个提交中。
- 依赖锁定：production `@zip.js/zip.js@2.8.60`、`fast-xml-parser@5.11.1`、`zod@4.4.3`；development `officeparser@7.8.0`、`fake-indexeddb@6.2.5`。`package.json` 与 lockfile 的 direct versions 一致。
- 基线：安装依赖前的现有 `npm run test:unit` 为 95/95 通过。
- RED 1：gate test 因缺少 `lib/docx-import/officeparser-probe.ts` 失败（`ERR_MODULE_NOT_FOUND`）。
- GREEN 1：七项 gate 合同、逐 gate conjunction 和 JSON 序列化测试通过。
- RED 2：deterministic fixture test 因缺少生成脚本失败；实现固定 entry 顺序、固定 `lastModDate`、STORE 写入后通过。
- RED 3：实际 probe test 因缺少 `scripts/probe-officeparser.mjs` 失败；实现真实 AST 观测后通过。
- Fixtures：`probe-adjacent.docx` SHA-256 `892d6335d2e44a301bc435ea328eea551a9a87cbb39056b7decaf1c25488e6f5`；`probe-overlap-nested.docx` `7b1ed2197744d1b16000a918e34d7c9cec9f53d3d15c0a07890f6c4f8bab05e4`；`probe-threaded-resolved.docx` `93ccf246ae05a50f5d3e8200bd72e68d06304e68dd56a31361c928bd147f9a3d`。
- Probe 结果：`inlineRange=false`、`adjacentDistinct=true`、`nestedOverlapDistinct=false`、`stableCommentId=true`、`immediateReplyParent=false`、`resolvedState=false`、`noSelectedTextSearch=false`；`productionEligible=false`。
- 关键证据：多 run/交叠 fixture 期望 `10=ABCDE,11=BC,12=CD`，officeparser AST 只得到 `10=E,11=C,12=D`；reply `21` 未出现在 AST；root `20` 无 resolved metadata。
- 决策：`officeparser@7.8.0` 不进入 production path，只作为 probe/交叉验证 devDependency；Task 2 使用轻量 OOXML Import Walker。
- 详细记录：`docs/adr/2026-08-28-officeparser-docx-import.md`。
- 验证：probe focused tests 4/4 通过；完整 `npm run test:unit` 99/99 通过；`npx tsc --noEmit` 通过；四个新增代码/测试/脚本文件的定向 ESLint 通过；仓库全量 ESLint 直接运行退出 0。
- 环境记录：现有 `npm run lint` 经 WSL 调用 `scripts/sites-env.sh` 时，因该 checkout 的 CRLF 在 `set -o pipefail` 处退出；直接以相同 ESLint 参数运行通过。本 Task 未改动该包装脚本，后续最终验证需在 Sites 构建环境或 LF shell 副本中复核。
- 检查点：Task 2 尚未开始，等待用户确认继续。
