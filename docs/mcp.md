# 知临中学只读 MCP

入口为 `POST /mcp`，与现有网站共用 Worker、D1 和 R2。`.openai/hosting.json` 声明 `mcp` 能力；Sites 托管 OAuth 并提供网站对应的私人插件。连接使用 Sites 返回的 `mcp_connection`，不单独注册 OAuth 应用。

## 身份和权限

- 只接受 Sites 边界注入的 `oai-authenticated-user-id` 和经过验证的 `oai-authenticated-user-email`。部署必须始终经过 Sites 的认证边界；直接运行的本地 Worker 没有 OAuth 验证能力。
- 每次工具调用按规范化邮箱重新查询当前白名单和用户资料；不接受工具参数指定访问者、权限组或管理员身份，也不使用网页登录 Cookie 代替 MCP 身份。
- 管理员和普通组可读，游戏组、被移除的成员和未完成资料者返回 HTTP 403；缺少可信身份返回 HTTP 401。MCP 不执行管理员初始化或修复。
- 帖子列表、搜索、正文、讨论和图片均复用 `postVisibilityCondition`。管理员可以读所有正常帖子，普通成员受帖子白名单约束。
- 正文删除或隐藏后不返回正文、标题、标签或图片。若按网站规则仍有可访问的讨论，可读剩余讨论及安全占位信息；批注与评论的删除、隐藏规则沿用共享生命周期查询。
- 只列出和读取随笔当前引用的永久图片；不会按任意 URL 抓取，也不会提供 R2 key、公开图片链接、成员邮箱、会话或管理审计字段。
- 初始化、ping、工具发现不返回私人数据，可在连接前调用。所有响应 `private, no-store`。

## 工具

| 工具                      | 作用                                                               |
| ------------------------- | ------------------------------------------------------------------ |
| `get_access_info`         | 当前连接者的站内ID、显示名称、管理员状态、权限组                   |
| `list_posts`              | 每页20篇可见随笔，支持作者、标签及最新/活跃排序                    |
| `search_posts`            | 同列表，增加必填 query，匹配标题和正文，与网站搜索一致             |
| `get_post_content`        | 当前版本Markdown、作者、标签、图片ID及分段信息                     |
| `list_post_images`        | 当前图片元数据列表                                                 |
| `get_image`               | 按postId及assetId返回MCP image块，支持PNG/JPEG/GIF/WebP，最大10 MB |
| `list_annotations`        | 当前批注、选区、作者（含Word导入身份）、状态及回复数量             |
| `list_annotation_replies` | 指定当前批注的回复及回复关系                                       |
| `list_comments`           | 帖子评论及评论回复、楼层和回复关系                                 |

所有工具声明 `readOnlyHint`，没有发布、编辑、删除、回复或状态修改工具。请求和错误日志只走共享诊断入口；工具正文、邮箱、图片内容和请求体不写入日志。网站全局性能探针仍可能记录只含诊断信息的性能记录。

正文默认每段20,000个UTF-16字符，最大30,000，使用返回的 `nextOffset` 继续读取，返回 `revisionId` 供调用者判断是否跨越了编辑版本。图片内容独立读取。列表型讨论工具默认每页20条，最大50条；超出末页沿用网站的末页钳制行为。讨论查询复用现有网站查询后分页，不引入另一套生命周期算法。

## 协议和维护

采用无状态 Streamable HTTP JSON响应，支持初始化、工具发现、工具调用、ping、初始化完成和取消通知；不建立会话或SSE订阅，GET/DELETE返回405。支持2025-11-25、2025-06-18和2025-03-26协议版本。保留HTTP Origin校验、64 KiB实际请求体上限、严格参数验证、安全错误编号和HTTP 401/403。

`lib/mcp/protocol.ts` 负责静态工具定义、参数和协议，`lib/mcp/service.ts` 负责调用现有业务读取，`app/mcp/route.ts` 负责接入路由和错误日志。

运行 `node --experimental-strip-types --test tests/mcp/*.test.ts`。行为测试使用生产Drizzle D1驱动、迁移后的SQLite及D1格式batch数据，覆盖每个工具的游戏组拒绝、帖子白名单、搜索范围、管理员、即时撤销、正文分段、图片越权和MCP图片返回、批注/回复/评论及隐藏删除处理。测试断言业务SQL全部为SELECT，并约束D1绑定参数、列数和batch别名。
