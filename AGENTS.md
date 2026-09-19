# 知临中学：Codex 工作约定

这份文件用于让新的 Codex 对话快速进入正确的项目状态，避免重复探路。

## 项目身份

- 站点：知临中学；仓库：`zhilin-writing`。
- 在 Sites 云端中，若 `/workspace/sites/zhilin-writing` 存在且包含 `.openai/hosting.json`，将其作为现有 checkout 使用；不要另行初始化或克隆第二个站点。
- `.openai/hosting.json` 是 Sites 身份配置。除非用户明确要求，不要改动其中的项目 ID 或绑定名。

## 远端与凭据

- `origin` 是 Sites 的内部源码/部署远端，是本项目默认权威源。
- `github` 是辅助镜像，不要默认把 `github/main` 当作最新或可部署主线；只有用户明确要求时才同步它。
- 不要把 token、密码或带凭据的 URL 写入仓库、`.env`、Git 配置或提交历史。
- 对 `origin` 执行 fetch/push 时，使用 Sites 提供的短期、按命令注入的凭据。普通 Git 提示输入用户名时，不要盲目重试，也不要向用户索要或持久化 token。

## Git 工作流

- 每次提交的 author 使用：`user.email=loremmlel@163.com`、`user.name='柚子'`。
- 在新环境提交前，确认已执行：`git config --local user.email 'loremmlel@163.com'` 和 `git config --local user.name '柚子'`。
- 纯 Git、文档或分支整理任务：先检查 `git status --short --branch`、远端和分支指向；不要无关地执行 `npm install`、构建、预览或部署。
- 修改分支历史前，先确认工作树干净、重新获取目标远端引用，并使用 `--force-with-lease` 保护并发更新；不要使用无条件的 `--force`。
- 用户要求移动或合并提交时，保留原始提交历史；完成后核对本地分支、远端分支、提交数量和工作树状态。
- 不要因为“最新 main”就推断它已经部署。

## GitHub 镜像同步

- 只在用户明确要求时，把 `main` 原样镜像到 `github/main`；使用 `bash scripts/sync-github.sh`，不要用 GitHub 内容 API 重建提交，否则原始 commit SHA 会改变。
- ChatGPT Work 中必须以可写 stdin 的 TTY 会话启动脚本。脚本获取设备码后会停在 `Waiting for an explicit resume after authorization...`，此时把显示的地址和代码发给用户，不要让进程在后台轮询。
- 用户明确回复已授权后，向同一个执行会话发送一次回车并保持前台等待；脚本随后交换临时令牌、执行快进推送，并核对本地与 GitHub 的完整 SHA。
- 已验证成功的 Work 流程不依赖持久登录：`gh auth login --web` 在设备授权后还会访问 `api.github.com` 校验账户，可能在保存登录态前被网络策略终止。安装或校验 `gh` 不能替代仓库脚本。
- 脚本只允许 `github/main` 是本地 `main` 的祖先；若历史分叉则停止，不要自动 force push。
- OAuth 令牌只能存在于同步进程内，并通过临时 credential helper 传给 Git；不得输出、写入文件、remote、Git 配置或 shell 历史。

## Sites 部署

- Git 分支状态与 Sites 生产状态是两套信息。需要判断某个提交是否已部署、回退主线或准备发布时，查询 Sites 版本历史，并将其 `source.commit_sha` 与 Git 提交比较。
- 已知历史基线：Sites Version 8 对应 `06614a5`；这只是参考，后续必须重新查询，不能把它当作永久当前状态。
- 只有用户明确要求，或当前任务确实需要发布验证时，才运行构建、预览或部署。

## Cloudflare D1 查询限制

- D1 的 SQLite 列数上限为 100；该上限也约束 `SELECT` 结果列，而不只是单张表的字段数。
- 新增或修改多表联查时，不要用 `select({ ...整张表 })` 累加全字段。必须显式投影当前调用方实际使用的列，尤其是通知、动态等会同时关联多张内容表的查询。
- 通知列表与通知详情查询的窄投影是刻意保留的 D1 兼容设计；后续需要新字段时只增加实际消费的字段，若数据面继续扩大则拆成按 ID 补查的定向查询，不要恢复整表投影。
- D1 每条语句最多 100 个绑定参数，`IN` 的每个元素和其它筛选条件都计入。数据库已有关系时用 JOIN / 子查询；外部解析出的无界 ID 列表使用 `db/id-list.ts` 的单参数 JSON 查询，不把它们直接展开为 `inArray`。有硬性分页上限的列表可保留 `inArray`。
- D1 `batch` 返回按 SQL 列名索引的对象；JOIN 投影必须使用唯一 SQL 别名，不能让多张表的 `id` / `created_at` 等字段互相覆盖。仅改变 TypeScript 对象键名无效。测试须使用生产 `drizzle-orm/d1` 驱动与对象格式的 batch 返回值，不能用 sqlite-proxy 的数组结果替代。
- 独立但同一业务步骤的读取优先 `db.batch`，查询构造函数保持惰性，不能先 `await` 再放入 batch。不要拆散写入事务以绕过限制。SQL 行为测试应同时约束绑定参数与 SELECT 列数不超过 100，不能只依赖本地 SQLite 的默认上限。

## 服务端错误日志

- 未预期的 Server Action、Route Handler、后台任务错误统一使用 `logServerError`；不要另写 `console.error`。
- `errorCode` 参数表示稳定的操作级错误码；底层异常自身的 `code`、异常类型、安全原因分类和 `incidentId` 由共享日志入口分别记录，不要用操作码覆盖底层错误码。
- 可预期的不变量失败可在异常上附加仅含大写字母、数字和下划线的固定 `reason` 诊断码；禁止把正文、选区、错误消息或其他用户输入拼进 `reason`。
- 多阶段且难以定位的服务流程使用受控 `stage` 标记；阶段名只能是简短固定标识，不能包含用户输入。
- 用户可见的失败状态或 5xx API 响应应带回 `incidentId`，页面显示同一编号，便于和生产日志关联。
- 禁止记录帖子或批注正文、选区、邮箱、文件内容、请求体、Cookie、凭据以及任意未经筛选的 `error.message`、`stack` 或完整异常对象。
- 权限不足、输入校验、编辑冲突等预期内失败直接返回安全提示，不记为服务端 error。

## 请求性能诊断

- 探针口径、覆盖、保留上限与读取方法见 `docs/performance-probes.md`。性能日志在 D1 `performance_logs`，与错误日志分离，全局最多 5,000 条。
- `response_ready` 只表示响应头就绪；流式请求必须结合 `stream_end` 判断，不要将 TTFB 差值断言为纯代理延迟。
- 新增直接 D1/R2 调用时复用 `measuredDatabase` / `measuredBucket`；不要记录 SQL、绑定值、文件路径或正文。保持 `/api/performance` 不被自身探针记录。
- `0010_performance_logs.sql` 中的滚动上限触发器是手写迁移；Drizzle 不管理该触发器，后续生成迁移不要删掉它。

## 设计与交互合同

- 修改 UI 前先读根目录 `DESIGN.md` 与 `UX-CONTRACT.md`，定位适用的 D1–D8、U1–U10 和共享组件所有者。它们是现行规范；历史方案用于解释取舍，不作为另起设计的入口。
- 新页面复用已定义的布局、视觉角色和交互。不要因为某个页面需要新内容，就另造宽度、按钮体系、弹窗、搜索或分页逻辑。
- 用户新要求优先；改变持久设计/行为时，在同一变更同步规范与实现，说明影响与依据。代码偶然偏差不能自动成为新标准；未记录理由的局部例外按漂移处理。
- 评审引用适用规则，核对一个同类消费者，并根据实际改动验证。纯文档不触发构建/部署；静态检查、用户反馈与真实浏览器测试分开记录。

## 完成前检查

- 分支操作：确认目标提交和远端引用一致，确认没有意外未跟踪或未提交文件。
- 源码变更：运行与变更直接相关的检查；不要为了文档/Git 操作触发完整依赖安装或生产构建。

## 浏览器测试环境

- 当前 ChatGPT Work 沙盒没有可由仓库内 Playwright 调用的浏览器。除非先在当前环境用一条最小真实旅程证明浏览器、本地 Sites 预览和一次性 D1/R2 能闭环运行，否则不要新增 Playwright 依赖、命令或批量用例。
- 不提交未实际运行的浏览器套件，也不用源码字符串、Happy DOM 或对话内手动浏览器操作冒充端到端测试。
- 自动化测试仍按稳定产品行为维护；新 Bug 优先补强所属功能合同，不默认新增独立回归文件。
