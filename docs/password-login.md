# 邮箱密码登录

2026-10-01 用户要求：保留 ChatGPT 登录，增加手动邮箱密码登录；管理员为受邀成员设置密码，仍只有白名单内邮箱可访问。

- 两种方式最终使用同一规范化邮箱、`allowed_users` 和 `users`，不创建另一套资料或权限。游戏组和帖子白名单继续使用原鉴权。
- 新 `/login` 为公开入口。两种方式成功后返回安全的站内目标；首次登录仍需完善资料。管理员继续使用 ChatGPT 登录，密码只为非管理员的受邀成员设置。
- `/admin?section=members` 展示密码是否设置；设置／重置在全局弹窗中输入新密码及确认密码，成功后关闭，失败保留输入。没有注册、找回密码或明文密码查看功能。
- 密码不裁剪、不改变大小写，允许粘贴和密码管理器。长度 12–128 个 Unicode 字符。使用 Node 内置 scrypt、随机 16 字节盐，N=16384/r=8/p=5（16 MiB 工作内存档）；比较使用 timingSafeEqual。来源：[Cloudflare Node crypto](https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/)、[OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)。实际 workerd 测试同时验证此配置可用。
- 密码单独存于 `member_passwords`，成员列表只投影设置状态，普通鉴权不读取密码哈希。32 字节随机会话令牌只在 HttpOnly/Secure/SameSite=Lax 的 `__Host-zhilin-session` Cookie 中；D1 只存 SHA-256 摘要，14 天过期，每次鉴权联查最新白名单和资料。
- 本站密码会话优先于平台 ChatGPT 身份，避免静默切换账号。无效本站会话要求重新登录；明确点击 ChatGPT 登录时先清理本站会话，再通过平台原有入口登录。退出同时清理本站会话和平台登录。
- 重置密码和会话删除使用 D1 原子 batch；登录的会话插入须匹配刚验证过的密码哈希，避免并发重置后旧密码生成会话。移除白名单级联删除密码和会话；重新邀请必须重新设置密码，原社区资料和内容保持。
- 登录请求限制 4 KiB，邮箱最大 254 个字符；登录失败使用统一信息，不透露邮箱是否存在。D1 原子计数：每邮箱 15 分钟最多 10 次、每来源 IP 最多 60 次；来源 IP 缺失时共享桶，不信任客户端 `X-Forwarded-For`。只存邮箱/IP 摘要，过期记录在下一次登录清理。
- 密码登录入口和原生登录／退出表单验证同源 Origin；所有携带本站会话的写请求在 Worker 入口验证同源，覆盖现有 API 与 Server Actions。登录响应禁止缓存，秘密不进入 URL、日志、诊断、提示或本地持久化。

验证入口：`tests/access/password-login.test.ts` 在真实 workerd/D1 中验证设置、错误密码、未知／未设密码邮箱、规范化邮箱、会话摘要、重置失效、移除／重新邀请、并发限流与恢复；`tests/access/auth-access.test.ts` 继续覆盖原有管理员、成员、游戏组及请求级缓存合同。页面、Route Handler 和共享鉴权还需生产构建及本地 HTTP 验证；这些不等同于真实浏览器双账号验收。

## 工程验收记录

- 全站单元／行为检查：450 项，449 通过、1 项既有跳过、0 失败；扩展后的认证检查再次运行，11 项通过。
- TypeScript、ESLint、全仓 Prettier 和 strict premium 静态审计通过。
- 本地实际 HTTP：登录页返回 200 并渲染双入口；受保护深链保留登录后目标；跨源登录 POST 返回 403，缺失输入返回 400。
- 生产 Worker 构建通过；`tests/build/haojie-http.test.mjs` 在隔离 D1/R2 中实际执行后台设置／权限拒绝、规范化邮箱登录、安全 Cookie、不同 ChatGPT 身份下的密码身份优先、游戏组拒绝写作、跨源写入拒绝、退出、重置及旧会话失效，并继续执行原双人对局旅程。平台 ChatGPT 入口由生产调度器拥有，测试仅验证顶层跳转，不在 Miniflare 内模拟平台认证。
- 未做真实浏览器视觉和双账号人工验收。
