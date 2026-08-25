# 知临中学

一个只对少数受邀成员开放的 Markdown 写作与阅读社区。这个仓库是 V1 架构基础：功能真实可用，但主动推迟批注、版本历史、通知与复杂恢复系统。

## 架构

- **运行时：** ChatGPT Sites 的 Vinext / Cloudflare Worker 运行时。
- **身份：** dispatch-owned Sign in with ChatGPT；邮箱只作为服务端白名单身份键。
- **持久化：** D1 保存白名单、用户、帖子、回复、标签和文件元数据；R2 保存头像、正文图片和附件。
- **编辑器：** Milkdown Crepe（ProseMirror + Remark）。浏览器只显示富文本界面，数据库只保存 Markdown。
- **本地草稿：** IndexedDB 保存未发布文字与临时文件引用，文件本身已经进入 R2。
- **服务边界：** `lib/posts/service.ts` 是帖子创建/更新的唯一保存入口；未来可在这里加入版本快照、批注校验和事务。

## 主要目录

- `app/`：受保护页面、SIWC 流程和 API 路由。
- `components/editor/`：Markdown-first WYSIWYG 编辑器、草稿状态和附件插入。
- `lib/auth/`：白名单、成员与管理员权限。
- `lib/posts/`：帖子保存边界与回复写入。
- `lib/assets/`：R2 文件操作。
- `lib/markdown/`：安全 Markdown 渲染与检索文本提取。
- `db/`、`drizzle/`：D1 schema、查询和迁移。

## 数据模型

`allowed_users` 保存规范化邮箱和唯一管理员标记；`users` 使用不可变 ID 和唯一显示名称；`posts` 保存规范 Markdown、检索文本和发布/编辑/活跃/软删除基础字段；`replies` 保存根回复与实际被回复用户；`tags`/`post_tags` 负责轻量标签；`assets` 保存 R2 键、所有者、临时/永久状态、绑定帖子与七天清理时间。

## 编辑器扩展路径

Milkdown 已经提供 Markdown → Remark AST → ProseMirror 文档 → Markdown 的双向路径。未来批注可增加带 `annotation_id` 属性的 ProseMirror mark、Remark 解析/序列化插件和交易校验，而不替换主编辑器或把批注退化为 DOM/string offsets。

## V1 主动推迟

内联批注、批注讨论、版本快照与恢复、乐观版本锁、通知中心、活动事件日志、用户动态、复杂软删除恢复、@mentions、协同编辑、公开访问和社交增长功能。

## 验证

- `npm run test:unit`：领域规则与 Markdown 安全管线。
- `npm run lint`：源代码检查。
- `npx tsc --noEmit`：类型检查。
- `npm test`：单元测试、生产构建和最终产物检查。
- `npm run db:generate`：schema 变化后生成 D1 迁移。
