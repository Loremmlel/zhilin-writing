# ADR: officeparser 不进入 V5.5 DOCX 导入生产路径

- 日期：2026-08-28
- 状态：Accepted
- 探测版本：`officeparser@7.8.0`

## 背景

V5.5 要求 Word comment 的 anchor 在正文单遍解析中精确落到 inline range，并可靠区分相邻、嵌套和交叠 range；threaded reply parent、resolved 状态和稳定 comment ID 也必须直接可得。规范允许用实际安装版本和固定 fixtures 做一次最长两小时的 feature probe，但七项 gate 必须全部通过，任何一项失败就停止 production-path 评估。

## 决策

`officeparser@7.8.0` 不进入生产 DOCX 导入路径。后续实现使用已批准的轻量 OOXML Import Walker；`officeparser` 只保留为 devDependency，用于可重复 probe 和可选交叉验证。生产目录 `lib/`、`app/`、`components/` 不得导入它。

## Fixtures

Fixtures 由 `scripts/fixtures/generate-docx-fixtures.mjs` 以固定 XML、固定 ZIP entry 顺序、固定时间和 STORE 压缩确定性生成。

| Fixture | SHA-256 | 用途 |
| --- | --- | --- |
| `probe-adjacent.docx` | `892d6335d2e44a301bc435ea328eea551a9a87cbb39056b7decaf1c25488e6f5` | 两个端点相接的 comment ranges |
| `probe-overlap-nested.docx` | `7b1ed2197744d1b16000a918e34d7c9cec9f53d3d15c0a07890f6c4f8bab05e4` | 外层、嵌套及交叠 ranges |
| `probe-threaded-resolved.docx` | `93ccf246ae05a50f5d3e8200bd72e68d06304e68dd56a31361c928bd147f9a3d` | `w14:paraId`、`w15:paraIdParent`、`w15:done` |

## Gate 结果

| Gate | 结果 | 实际证据 |
| --- | --- | --- |
| inline range 精确性 | FAIL | 期望 `10=ABCDE, 11=BC, 12=CD`；AST 仅得到 `10=E, 11=C, 12=D`。comment 被挂到 range end 前的 text node，完整选区丢失。 |
| adjacent comments 不合并 | PASS | `0=alpha`、`1=beta`，两个相邻 comment 保持独立。 |
| nested/overlapping 可区分 | FAIL | ID `10,11,12` 尚在，但三个 range 均缩成结束前的单个 text node，不能区分真实嵌套/交叠范围。 |
| comment ID 稳定 | PASS | 同一 fixture 独立解析两次均得到 `0,1`。 |
| threaded reply immediate parent | FAIL | AST 只返回 root comment `20`；reply comment `21` 及其 parent 不存在。 |
| resolved state | FAIL | root metadata 只有 `commentId/author/date/initials`，没有 `w15:done` 对应状态。 |
| 不依赖 selectedText 反向搜索 | FAIL | AST 无法直接还原完整 range；只能重新解析 raw OOXML 或猜选中文本，均不满足 gate。 |

最终结果：`productionEligible=false`。

## 后果

- Task 2 起使用 `@zip.js/zip.js`、`fast-xml-parser` 和本站语义 walker 直接读取 OOXML parts。
- comment active set 与正文 text segment 在同一次 document walk 中形成，不能从 officeparser AST 或 selected text 反推。
- probe 脚本和 fixtures 保留为版本升级时的回归门；只有未来版本七项全部通过，才允许先修改 ADR/计划、重新评审生产架构。

## 复现

```powershell
node scripts/fixtures/generate-docx-fixtures.mjs
node scripts/probe-officeparser.mjs
node --experimental-strip-types --test tests/docx-officeparser-probe.test.ts
```
