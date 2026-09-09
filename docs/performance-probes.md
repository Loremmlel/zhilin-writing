# 请求性能探针

## 覆盖与读取

- Worker 统一覆盖页面、RSC 导航、Server Actions、API、上传/下载和经过 Worker 的图片请求。
- 浏览器用 Resource/Navigation Timing 收集同源请求（包括静态资源、fetch、XHR）；另外记录 fetch 拒绝、慢交互（40ms 起）和主线程长任务（浏览器支持时）。
- `Server-Timing` 与 `X-Request-Id` 提供请求编号。既有错误日志仍保留 incidentId，同时附带 requestId。
- D1 `performance_logs` 独立保存性能数据。管理员登录后访问 `/api/performance` 获取最近 200 条，或用 `?requestId=<编号>` 查询关联记录。普通成员不能读取。
- 不新增管理界面。排查时也可通过 Sites 的数据库只读工具读取该表。

## 指标口径

| 字段                                         | 含义与边界                                                                                                              |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| responseReadyMs / 浏览器 serverMs            | Worker 开始处理至返回响应头；不含到达 Worker 之前的代理、边缘鉴权、排队、冷启动等开销，也不等于流式响应完成             |
| streamEndMs                                  | Worker 开始至响应流被消费完、报错或取消；含流式生成、消费背压，不能视为纯 CPU 或纯网络时间                              |
| dbMs / dbCount                               | D1 调用累计墙钟时间与语句数，含数据库通信等待；批处理按一次往返累计时间、按语句数计数。并行调用的时间可相加超过请求时间 |
| r2Ms / r2Count                               | R2 get/head/put/delete/list 调用累计时间与次数；get 返回后的文件流传输在 downloadMs/streamEndMs 中                      |
| dnsMs / connectMs / tlsMs                    | 浏览器可观测的 DNS、建连与 TLS；connectMs 包含 TLS；复用连接或缓存时可为零                                              |
| ttfbMs                                       | requestStart 到 responseStart，含发送、网络与服务端等待                                                                 |
| downloadMs / durationMs                      | 首字节至响应结束 / 浏览器资源请求总时长；流式响应下载阶段也可能包含后端工作                                             |
| inputDelayMs / processingMs / presentationMs | 慢交互的输入排队、事件处理、下一次呈现延迟；不是异步操作完成时间，也不是整页 INP 汇总                                   |
| domInteractiveMs / domCompleteMs             | 相对于首次导航起点的文档阶段时间                                                                                        |
| observedAt                                   | 客户端观测时间；由客户端时钟提供，不用于计算跨端精确时间差                                                              |

服务端分别保存 `response_ready` 和有响应体时的 `stream_end` 记录；后者包含流式阶段完成后的数据库累计值。浏览器响应头只能得到前者的快照。请求在客户端缓存命中时可能复用旧响应头编号；结合 transferBytes、时间和服务端记录判断。资源响应状态不可用时，缺失/零值不代表成功。

诊断时先比较同一编号的 ttfbMs、serverMs 和服务端数据库时间，再看 downloadMs、stream_end 与慢交互/长任务。`ttfbMs - serverMs` 仅是网络与未计入服务端入口的开销估算，不能据此断言代理有问题。探针不会访问或测量代理内部节点。

## 开销与数据边界

- 全局硬上限 **5,000 条**，SQLite 插入触发器在同一事务删除旧记录；服务端两个阶段与客户端记录共同占用上限。与错误日志分开。
- 浏览器最多缓存 120 条，每 10 秒最多发送 30 条，一次只允许一个在途批次；离开/隐藏页面尝试 keepalive 发送一批。积压淘汰最旧记录，失败不重试，关闭页面可能丢失尾部记录。
- 上报接口不被探针记录，防止递归。每次上报须同源且已登录白名单成员，JSON 流式读取上限 24KB，最多 30 条，只接受已知字段和有限数值。
- 不记录正文、查询参数、文件名、SQL、邮箱、Cookie、请求体或任意异常文本。路径仅保留预定义路由形状，动态参数被替换。
- 服务端使用 waitUntil 写入；日志失败不会改变业务响应，也不会重试业务操作。响应流按需透传，不克隆、不预读全文。
- 平台直接返回、浏览器不支持的指标、跨域请求、未完成或被取消的尾部上报不保证覆盖。此方案用于有界诊断，不承诺完整审计或精确链路追踪。

## 验证

`node --experimental-strip-types --test tests/platform/performance.test.ts tests/platform/logging.test.ts`

覆盖脱敏、并发请求隔离、D1/R2 返回和失败语义、批处理原始对象、流式字节/取消/异常、不预读、5,000 条实际 SQLite 滚动上限、日志写入失败不传播。另运行 TypeScript 静态检查；真实网络归因须部署后积累数据，不能由本地单测证明。
