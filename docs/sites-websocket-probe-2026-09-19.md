# Sites WebSocket 实测（2026-09-19）

## 结论

知临中学现有 Sites 生产域名能够接受 WebSocket 升级并进行双向通信。
本次没有配置 Durable Objects，也没有新增外部服务。
这证明传输链路可用，不代表已经实现双人房间、跨实例广播或持久化对局。

## 测试部署与边界

- 原生产基线：Version 52，`39e1b71fc5db3d9b2e9ee555e04575e43ca43f64`。
- 临时探针：Version 53，`d703ee5f652cc41432c2846a3fe79973e3fbf8af`。
- 端点：`/api/admin/transport-probe`，位于 Worker 入口，先于 vinext 与性能响应包装器。
- 使用独立、随机的临时 bearer secret，保存在 Sites 环境变量中；只回传测试字符串，不读取数据库、用户或帖子。
- 未配置密钥或超过截止时间返回 404；凭证错误返回 403；连接最多 90 秒，最多 8 条消息，每条最多 128 字符。
- 本次验证的是测试凭证保护的传输端点，未验证浏览器登录 Cookie、生产房间权限或长期空闲。

## 实测结果

| 检查                                     | 结果                                                          |
| ---------------------------------------- | ------------------------------------------------------------- |
| 本地 Workerd 正向对照                    | 403 权限检查、200 元数据、101 升级、echo 均通过               |
| 生产普通 HTTP，无凭证                    | 403，并有探针响应头                                           |
| 生产普通 HTTP，正确凭证                  | 200，运行时存在 `WebSocketPair`                               |
| Worker 经同一公开 Sites 域名发起 WS 自测 | 101，有 WebSocket 对象，成功收到 echo                         |
| 两个外部客户端，经环境 HTTP 代理         | 两者均 open，收到 ready 与首次 echo                           |
| 连接空闲 30 秒后再次发送                 | 两者均成功收到第二次 echo，服务端 elapsedMs 分别 30043、30037 |
| 约 35 秒后主动关闭                       | 两者均 close code 1000                                        |

原始脱敏结果见 `sites-websocket-probe-2026-09-19.json`。
首轮 `ws` 客户端没有正确采用环境代理，报 `getaddrinfo EAI_AGAIN`；这是客户端解析失败，不是 Sites 拒绝升级。
改用已安装的 `undici.WebSocket` 与显式 `EnvHttpProxyAgent` 后通过。
本地最初采用比已安装 Workerd 更新的 compatibility date 导致启动失败；对照测试改为该二进制支持的 2026-05-22 后通过，未更改网站的兼容日期。
握手耗时约 8.5 秒包含沙箱代理路径，不作为普通用户延迟结论。

## 对正式联机实现的影响

1. 不应再以“Sites 不支持 WS”为由要求独立部署游戏服务器。
2. 当前 `worker/index.ts` 的性能探针用 `new Response(body, { status, statusText, headers })` 重建响应，没有携带 `webSocket`。正式接入必须保留 101 的升级对象，或让 WS 路由直接返回；本次临时探针采用后者。
3. 两个测试连接的 instance ID 相同，但其他 HTTP 请求已出现不同 instance ID；一次命中同实例不能证明连接具有房间亲和性，不能用全局 Map 作为可靠的房间真相源。
4. WS 支持与 Durable Objects 开放是两个问题。本次没有验证 Durable Objects 绑定，也没有验证跨实例消息唤醒机制。
5. 若继续仅用现有 D1，房间状态可以持久化并通过版本条件更新防并发覆盖；另一连接如何及时获知变化仍需设计。WS 本身不会让 D1 自动推送，服务端轮询也仍有查询开销。

## 清理

实验结束后移除 `worker/transport-probe.ts` 与入口分支，恢复原有 Worker 源码；删除 Sites 中临时密钥并发布清理版本。
本文件与脱敏结果保留验证依据；临时实现可在上述 Git 提交中查看。
