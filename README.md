# 知临中学

一个只对少数受邀成员开放的 Markdown 写作与批注社区。当前稳定基线为 V6：作者可以继续编辑已有正文批注的帖子；普通编辑保持无感，只有真正破坏批注锚点语义时才要求确认。V7 正在做发布收尾与可靠性加固，不增加新的大型产品能力。

## 当前能力

- Sign in with ChatGPT 私有白名单、成员 Profile 与单管理员权限。
- Markdown-first Milkdown/ProseMirror WYSIWYG，IndexedDB 本地草稿，R2 图片与附件。
- 帖子 Revision、资源快照、乐观冲突保护、管理员恢复。
- Activity、通知、两层帖子回复、标签、搜索与用户动态。
- 内容 Soft Delete、管理员隐藏/恢复与审计记录。
- 正文 Annotation、批注回复、revision snapshot/restore、桌面 Sidebar 与移动端 Sheet。
- DOCX → Markdown + Annotation 导入。
- V6 AnnotationGuard、选区预览、统一 Loading/Skeleton/Error 与 mutation pending 状态。

## V6 AnnotationGuard

- 一个纯 `inspectAnnotationTransaction(beforeDoc, transaction)` 检查所有 ProseMirror 文档变更，不依赖按键分支。
- 批注内部增删改、外部编辑和普通格式化直接放行；删除受保护端点、清空锚点或把锚点拆成多 block 时合并为一次确认。
- 确认只改变本地 editor/history 与 IndexedDB 草稿；Undo/Redo 同时恢复或移除文字、Mark 和 ID。
- Copy/Paste/Cut/Drop 的 Slice 会剥离 Annotation Mark，避免一个 ID 产生多个 anchor。
- 保存时服务端重新解析 canonical Markdown，校验 ownership/invariants，计算 annotation delta，并在同一 D1 batch 中提交正文、revision、anchor retirement、assets 和 tags。
- 编辑期间发生 Annotation 状态变化时禁止 force overwrite，本地草稿保留。

## 架构

- **运行时：** ChatGPT Sites 的 Vinext / Cloudflare Worker。
- **身份：** dispatch-owned Sign in with ChatGPT；邮箱仅作为服务端白名单身份键。
- **持久化：** D1 保存用户、内容、批注、revision、通知与文件元数据；R2 保存头像、正文图片和附件。
- **编辑器：** Milkdown Crepe（ProseMirror + Remark）；数据库只保存 canonical Markdown。
- **本地状态：** IndexedDB 保存未提交草稿、附件引用与已确认待撤下的 Annotation ID。
- **一致性边界：** `lib/posts/service.ts` 是帖子更新入口；`lib/annotations/*` 与 `lib/editor/annotation-*` 分别负责服务端权威校验和客户端交互保护。

## 主要目录

- `app/`：受保护页面、App Router loading/error、SIWC 与 API 路由。
- `components/editor/`：编辑器、AnnotationGuard dialog、只读批注 Sidebar 和草稿状态。
- `components/annotations/`：正文批注阅读、选区预览、thread 与共享回复 composer。
- `lib/annotations/`：canonical AST、不变量、delta、lifecycle 与 selection。
- `lib/editor/`：transaction inspector、session/history、clipboard、IME 与 conflict。
- `lib/posts/`、`lib/revisions/`：原子保存、revision 与恢复。
- `db/`、`drizzle/`：D1 schema 与迁移。

## 验证

- `npm run test:unit`：领域、编辑器、DOCX 与交互状态测试。
- `npm run lint`：源代码检查。
- `npx tsc --noEmit`：类型检查。
- `npm test`：全量单测、生产构建和最终产物检查。
- `npm run db:generate`：schema 变化后生成 D1 迁移。

V6 的实现与验收证据见 `docs/v6-annotation-guard-report.md`。V7 的可行性裁决、设计与实施顺序见 `docs/superpowers/specs/2026-09-03-release-hardening-v7-design.md` 和 `docs/superpowers/plans/2026-09-03-release-hardening-v7.md`。
