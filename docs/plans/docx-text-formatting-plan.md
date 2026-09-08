# DOCX 字号、文字颜色与居中导入计划

日期：2026-09-08

分支：`feat/docx-text-formatting`

源码基线：`origin/main`，`3ca823d4ddebc9088502700ab7a782cef2654716`

状态：**待用户审阅，仅完成调查和计划，尚未实现。**

## 1. 结论与推荐

可实现，但不能只在 DOCX 转换结果里插入 HTML。

当前正文以 canonical Markdown 为唯一持久内容，阅读器、Milkdown 编辑器、导入预览、批注校验和历史版本都依赖它。推荐沿用已有 `remark-directive`，增加受限的文字格式和段落对齐语义；由应用生成安全 HTML。保留现有 Markdown、Annotation AST 和数据库关系，不引入第二份 HTML 正文，也不开放任意 HTML/CSS。

这是一次贯穿导入、编辑与批注的中等规模增强，不是单独修改渲染器的 CSS。完成标准是：**导入 → 预览 → 发布 → 再编辑 → 保存 → 重载，格式与批注均能保留。**

| 路线                      | 收益                                                                  | 代价与结论                                                                                    |
| ------------------------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 开放原始 HTML             | 与常见 HTML 导出直观接近                                              | 仍需实现 Milkdown 往返、批注 AST 识别及 HTML 清洗；块级 HTML 隐藏内部 Markdown 结构，本轮不选 |
| 受限 directive            | 复用现有解析依赖和批注方式，格式随 Markdown、草稿及 revision 一起保存 | 需要协调几处白名单和编辑器 schema；通用 Markdown 阅读器不保证识别，是本轮推荐                 |
| Markdown 加独立样式范围表 | Markdown 正文可保持纯净                                               | 每次正文编辑都要映射样式偏移，并同步 revision/恢复/粘贴，增加另一套范围系统，本轮不选         |

此选择基于仓库现状；[remark-directive](https://github.com/remarkjs/remark-directive)本身提供扩展语法，并不会自动完成对应的渲染与编辑语义。

## 2. 现状：HTML 支持到了哪里

### 2.1 源码证据

| 环节           | 当前实现                                                                                                             | 对本需求的影响                                                |
| -------------- | -------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| DOCX 解析      | `lib/docx-import/lookups.ts` 的 `parseRunProperties` 把 `color/sz/szCs` 等归入 `visualFormatting`；没有解析段落 `jc` | 字号、颜色被主动丢弃，居中尚未进入 IR                         |
| 中间结构       | `lib/docx-import/types.ts` 的 `InlineSegment` 只有 text、marks、link、commentIds 等                                  | 没有可穿过 Worker、预览缓存和提交的格式字段                   |
| Markdown 输出  | `lib/docx-import/markdown.ts` 按文字范围切片，生成普通格式及 `:annotation[...]`                                      | 适合在现有片段上增加格式；切片合并条件也必须纳入格式          |
| 阅读渲染       | `lib/markdown/render.ts` 使用 remark → rehype → sanitize → stringify；没有 `rehype-raw` 或 `allowDangerousHtml`      | 不解析原始 HTML 为可展示元素；sanitize 未放行 style           |
| 编辑器         | `components/editor/markdown-editor.tsx` 注册 commonmark/GFM 和 `annotationPlugin`                                    | 没有字号、颜色 Mark，也没有段落对齐属性及其 Markdown 往返规则 |
| 服务端创建批注 | `lib/annotations/selection.ts` 明确拒绝 html；当前 textDirective 只允许 annotation                                   | 即使 HTML 看起来能显示，创建批注仍会失败                      |
| 批注保存校验   | `lib/annotations/invariants.ts` 仅允许现有内联容器                                                                   | 新格式不接入会报 INVALID_BLOCK                                |
| 编辑器保护     | `lib/editor/annotation-ranges.ts` 有独立的 Mark 白名单                                                               | 新增格式 Mark 后必须同步，否则合法批注变成非法范围            |
| 段落对应       | `lib/annotations/span.ts` 与 `dom-selection.ts` 分别枚举 AST 块与 DOM 块                                             | 对齐不能额外包一层任意 div，导致两边块序号不一致              |
| 提交边界       | `lib/docx-import/commit-schema.ts` 使用 Zod strictObject                                                             | 只增加客户端字段会被服务端拒绝                                |

原始 HTML 默认不进入渲染结果，与 [remark-rehype 的官方说明](https://github.com/remarkjs/remark-rehype)一致。浏览器最终接收生成的 HTML，不代表 Markdown 输入支持原始 HTML。

### 2.2 已执行的只读探针

在当前安装依赖和基线源码上，直接调用现有 `renderMarkdown`、`markdownToPlainText` 和 `validateCanonicalAnnotationDocument`，没有修改实现或数据库。

| 输入示例                                                     | 实际结果                                                            |
| ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `前<span style="font-size:18pt;color:#ff0000">红字</span>后` | 输出 `<p>前红字后</p>`，样式消失                                    |
| `<p style="text-align:center">居中 **粗体**</p>`             | HTML 输出和搜索纯文本均为空                                         |
| span 内放现有 annotation directive                           | 批注 mark 可以出现在渲染结果中，但 canonical 校验报 `INVALID_BLOCK` |
| HTML p 内放 annotation directive                             | HTML 输出为空，校验报 `MISSING_ACTIVE_ID`                           |
| annotation 内放拟议的 text directive                         | 当前只产生无样式 span，校验仍报 `INVALID_BLOCK`                     |

因此，“加 HTML 标签”与“给新 directive 起名字”都不能单独完成需求。必须协调全部消费方。

## 3. 本轮产品范围

| 内容                          | 本轮行为                                                                                     |
| ----------------------------- | -------------------------------------------------------------------------------------------- |
| 正文文字字号                  | 保留普通文字的有效字号，包括同段混合字号和半磅字号                                           |
| 正文文字颜色                  | 保留有效 RGB；解析 Word 主题色及 tint/shade 后固化为 RGB；auto 跟随站点正文色                |
| 正文段落与标题居中            | 保留整段对齐，继续使用 p / h1–h4，不因居中改变标题语义                                       |
| 引用、列表项中的段落居中      | 保留段落对齐，引用和列表结构继续存在，列表标记位置沿用站点规则                               |
| 表格单元格                    | 保留字号和颜色；单段或各段对齐一致的单元格保留居中。当前多段已被摊平，混合对齐时明确降级提示 |
| 现有粗体、斜体、删除线、链接  | 与新格式组合，不能互相覆盖                                                                   |
| 正文批注范围                  | 支持上述可批注正文中的格式；表格依旧不可批注                                                 |
| Word 批注和批注回复的讨论文字 | 本轮保持现有纯文本导入，避免把正文排版扩展到紧凑讨论卡片                                     |
| 帖子标题输入框                | 继续纯文本；DOCX 正文标题块的格式可以保留，帖子 title 字段不存格式                           |

本轮不增加字体家族、背景色、高亮色、页面尺寸、页边距、首行缩进、行距、浮动布局、图片/表格整体居中、任意 HTML 编辑器或字号/颜色工具栏。代码风格内容保持现有代码表现，新视觉格式降级并提示；不扩大其批注资格。

本轮只新增“居中”；显式 left/start 用于取消继承的居中。right/justify/distribute 等不伪装成 center，降级为站点默认对齐并合并提示。

## 4. 保存格式：Markdown directive，不存任意 HTML

### 4.1 文字格式

拟定语法：

```markdown
普通文字 :text[红色大字]{size="18" color="#c00000"}。

:annotation[前半 :text[重点 **文字**]{size="14" color="#c00000"} 后半]{#ann_550e8400-e29b-41d4-a716-446655440000}
```

- `size` 表示磅值，只输出规范化数字；`color` 只输出小写六位十六进制色值。
- IR 使用可选 `fontSizeHalfPoints` 整数与 `color`，内部避免半磅换算的浮点歧义。
- 新建一个 `textStyle` Mark，合并字号和颜色，不为每个属性独立造一套插件。
- 空属性不输出 directive；相邻相同格式可以合并；格式不同的片段不能合并。
- 文字切片仍只计算原始 text 的 UTF-16 长度，不把标签、属性或 CSS 算进批注偏移。
- 普通文字中的 directive 特殊字符必须转义；保留中文、emoji、括号、反斜杠、链接、表格竖线和首尾空格。

### 4.2 段落居中

拟定块语法：

```markdown
:::align{value="center"}

## :text[居中的正文标题]{size="18"}

:::
```

align 容器**仅允许包一个现有 paragraph 或 heading**；不是任意布局容器，也不能包整个列表、表格或多个段落。引用和列表将该语法放在所属内部段落的位置，序列化器正确处理前缀、缩进与空行。

GFM 表格单元格不能容纳块 directive。使用同名的受限内联形式，例如 `:align[单元格文字]{value="center"}`，仅在它是单元格唯一内容容器时解释为该单元格对齐；不把 inline span 的 text-align 当成单元格对齐。正常段落中不接受这种内联对齐语义。

### 4.3 AST、编辑器和 DOM 必须保持同一正文结构

使用共享的纯函数将合法 align directive 转为原 paragraph/heading/tableCell 上的受限对齐元数据；结构化 AST 中不额外增加业务段落。转回 Markdown 时重新编码为上述 directive。该转换必须可逆，保留 annotation 子节点的源码 position，供现有“恢复批注原文”按源码范围替换使用。

明确接入三个入口：

1. `parseAnnotationMarkdown` / `stringifyAnnotationMarkdown`：在 parse 后显式规范化，stringify 前恢复传输语法。当前这里只调用 `processor.parse`，不能以为注册 transformer 就会自动执行。
2. 阅读器与搜索纯文本：在各自解析链路使用同一规范化规则。
3. Milkdown：共用 remark 转换，扩展现有 paragraph/heading/table-cell schema 的 attrs 和往返规则，保持原节点类型；不创建 centeredParagraph，也不使用原始 HTML 节点。当前 Milkdown parser 已调用 `remark.runSync`，但 serializer 仍需明确接入逆转换。

最终居中 HTML 为原本的 `<p>`、`<h2>` 或 `<td>` 携带受控对齐属性，不产生额外 div。列表紧/松形式可能因语法空行改变，必须以 AST 与 DOM 的块顺序、可见文字和最终显示一致为准，不能用 Markdown 字节一致代替语义验收。

无效 align 结构不可直接拆成合规段落来绕过批注屏障。写入时拒绝非法格式；只读兜底保留可见子内容、去除格式，不执行未知布局或 HTML。具体语法在阶段一验证；若基础库无法稳定往返此语法，先修订计划，不临时改为开放 HTML。

## 5. Word 样式解析规则

### 5.1 字号与继承

`w:sz` 使用半磅，例如 21 对应 10.5pt。[Microsoft FontSize 文档](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.fontsize?view=openxml-3.0.1)说明了该单位及继承行为。

- 读取 docDefaults、默认段落/字符样式、basedOn 链、显式段落/字符样式和 run 直接格式；直接格式覆盖继承值。
- 对齐读取段落 pPr/jc 及其样式继承；显式非居中不能因空值合并而重新继承 center。
- 未指定与显式 reset/auto 必须区分；不能全部用 `own ?? base` 导致重置失效。
- 保留现有样式循环保护，增加深度/缓存边界，复用现有 ZIP/XML 资源限制。
- 中文与普通拉丁正文优先按 `sz` 处理；不能用 `szCs` 覆盖全部普通文字。复杂文字出现独立字号而当前无法忠实表达时保留正文并提示，不承诺完整多脚本排版。
- 本轮不实现 Word 全部排版继承机制。表格条件样式、编号标记本身的样式等未支持来源不假装已还原；在遇到会影响目标格式的情况时给合并提示。

建议网页允许 6–72pt、0.5pt 步长；超界或非法值去除该属性并提示，不静默截成边界值。该范围是本计划的产品选择，**不是 Word 的字号上限**。输出 rem：16px 根字号下 `size / 12`，例如 18pt → 1.5rem；随浏览器字体设置及缩放变化，不限制页面缩放。

没有解析出字号时沿用站点默认值；有源字号时按源值保留，不把所有 Word 默认正文强行改成站点 18px。字体家族与行距继续使用站点规则，因此承诺格式保留而非 Word 像素复刻。

### 5.2 颜色

- 直接 RGB 规范化为 `#rrggbb`；`auto` 清除继承的固定色，使用站点默认文字色。
- 从 DOCX 包内 Theme relationship 获取主题，不硬编码 Office 默认配色，也不发起外部请求。
- 解析 themeColor 指向的色表及 tint/shade；主题与显式色同时出现时按 OOXML 优先规则处理，系统色使用包内可用的 lastClr。
- 主题无法解析时使用合法的显式 RGB 后备，否则退回默认色，并提示；不凭名称猜一个颜色。
- `w:color` 的自动色、主题色、tint/shade 来源参见 [Microsoft Color 文档](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.wordprocessing.color?view=openxml-3.0.1)。变换公式在实现时以官方定义及固定预期样本验证，不用简单 RGB 明暗相乘替代。

### 5.3 提示与预览

`VISUAL_FORMATTING_DROPPED` 只表示仍不支持的格式；已保留的字号/颜色不能继续被报为“已丢弃”。新增或细分必要的字体大小、颜色解析及对齐降级原因，按类型合并计数，避免每个 run 一条提示。提示使用“部分单元格含不同的段落对齐，已使用默认对齐”等结果描述。

保留现有 Worker、20 秒超时、取消和失败恢复流程；不增加第二个 DOCX 转 HTML 库或服务端重新解析 DOCX 的链路。

## 6. HTML 与批注如何共存

HTML 元素本身并不天然与批注冲突；风险来自解析后正文结构、范围和白名单不一致。受控 span 只是文字容器，批注继续使用 mark 与稳定 ID。

### 6.1 批注创建与保存

- `selection.ts` 和 `invariants.ts` 只把合法 `text` 格式 directive 当作透明格式容器；annotation 深度只在真正的 annotation 上增加，不把格式嵌套误报为批注嵌套。未知 directive 不能因此获得白名单资格。
- `annotation-ranges.ts` 接受规范化后的 `textStyle` Mark。跨块范围、首尾可见字符、重叠、未知 ID、非连续复用 ID 的限制不变。
- 选区跨越普通字/彩色字/大字时，仍以可见文字映射范围。格式不改变 blockOrdinal 或 selectedText，居中不引入新段落。
- 同一段内一条批注跨越多个字号/颜色片段，canonical 输出仍是一个 annotation 包裹多个格式片段。不能因 Mark 顺序拆成多个同 ID directive，从而触发 DUPLICATE。
- 编辑器 Mark 顺序、spanning、与链接/粗体组合的实际序列化在阶段一验证。接受两种合法格式/批注嵌套输入时也须统一输出，不通过放宽 DUPLICATE 校验规避问题。
- 跨段批注继续在连续各段复用同一个 ID，不做重建 ID、重新定位或数据库迁移。

### 6.2 编辑、剪贴板与冲突

- 在格式文字内部输入继承当前格式；同格式范围内删除/撤销不丢属性；不同格式边界采用明确、稳定的 ProseMirror Mark 行为。
- 居中段落中 Enter 后新段落继承对齐；合并段落以保留下来的段落属性为准；标题/段落转换保留适用属性。涉及批注的删除、拆段确认仍由现有 AnnotationGuard 负责。
- 改格式本身不表示删除批注，不要求 confirmed_deletion_ids。
- `annotation-clipboard.ts` 已只剥离 annotation Mark：继续保留普通格式 Mark；DOM 粘贴仅读取支持且合法的字号/颜色/对齐，绝不允许复制产生批注 ID。
- 覆盖富文本复制、剪切、粘贴、拖放、Undo/Redo 与中文输入。纯文本粘贴不承诺保留源格式。
- 保留当前保守冲突策略：批注原文相关的字号、颜色和所在段落对齐变化计入 anchor 状态签名，跨这类变化禁止强覆盖。更新 `inlineShape` 等比较逻辑，包含规范化属性及有效外层格式，避免属性变化被漏检。
- 导入预览的“恢复批注原文”同时恢复该范围原有的内联格式；外围段落对齐不因恢复文字而意外消失。

### 6.3 阅读与布局

- `.annotation-range` 继续负责高亮背景、下划线、焦点和点击；源文字颜色通过继承保留。显式检查浏览器 mark 默认黑字以及链接样式是否覆盖源色。
- 来源颜色不替代批注的状态色；强制色模式使用系统前景，不让内层格式 span 的内联颜色覆盖强制色规则。
- 字号变化会改变行高、折行和批注位置。复用当前 getClientRects 与 ResizeObserver 测量；只有代表性样本证明失准时才调整测量算法。
- 居中、放大不产生额外 hover 滚动，继续点击/键盘/深链定位；跨行和跨段批注使用真实矩形。
- 阅读、编辑、导入预览、管理员历史预览使用同一格式解释与 CSS。搜索、摘要、通知引用提取纯文本，不能泄露 directive 语法。
- 固定源颜色可能过浅；保留源色并合并提示，不静默改色。正文背景、高亮等不在本轮范围，不能承诺还原原文所有对比度组合。

## 7. 安全、缓存与旧内容

### 7.1 受限格式与安全 HTML

继续关闭 raw HTML；不加入 `rehype-raw`，不全局放行 style。字号、颜色、对齐使用同一套 DOM 无关的校验/规范化函数，供导入、服务端写入、编辑器和渲染器调用。

建议阅读渲染先生成经过白名单约束的内部格式属性，经过 sanitize 后，再由一个可信且功能单一的转换生成 CSS，并去掉内部属性。此转换只能设置 `font-size`、`color`、`text-align`，不能创建节点、URL、事件、任意样式或其他属性。第二次验证属性值；不能只信任“来自导入器”。

不允许 style 字符串、url()/var()/calc()、背景图、position、display、opacity、自定义 class/id 或事件属性穿过格式层。普通帖子 create/update 与导入 commit 都验证格式，即使文中没有批注也要执行。只读遇到异常格式去属性留文字，不让历史内容白屏。

[rehype-sanitize 官方说明](https://github.com/rehypejs/rehype-sanitize)提醒，清洗之后执行的插件也必须可信；上述后处理是固定值映射，不是开放式 CSS 解释器。

### 7.2 IR 和草稿兼容

- 为 segment、段落/list item/table cell 增加可选字段，同步 `commit-schema.ts`，旧 v1 预览和旧 Worker 消息缺字段按默认处理；本轮不为了可选字段增加 D1 schema 或新正文列。
- 旧 IndexedDB 预览在有效期内应能继续恢复提交；新增格式字段经 Worker 结构化克隆、缓存、恢复、请求 schema 后仍存在。
- 未修改的旧 Markdown 正文和历史版本继续按旧语义显示；不批量重写历史内容，不尝试恢复以前已经丢弃的 Word 格式。
- 现有 raw HTML 不因本轮突然变为可执行内容。
- 新 directive 是内容格式扩展：新版本向后兼容旧内容，旧应用代码不保证识别新内容。发布后不能把回滚到不认识该语法的版本当作无损方案；必要回退保留 reader/validator 兼容能力、仅撤回导入入口。
- 新旧标签页跨发布混用时仍遵守现有版本冲突和失败保留草稿；旧后端拒绝新字段不得表现为导入成功。

## 8. 实施顺序与交付边界

本计划经用户批准后才执行以下阶段。每阶段形成可审阅提交，最终整体可用后再交付；不发布只能显示却不能保存的半成品。

| 阶段               | 工作与主要文件                                                                                                                                         | 阶段验收                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| 1. 固定格式往返    | `lib/markdown/` 增加一个聚焦格式合同的模块；接入 `lib/annotations/markdown.ts`、`lib/markdown/render.ts`；`lib/editor/` 增加格式插件，注册到现有编辑器 | 两轮 Markdown ↔ Milkdown 往返后可见文字、属性、段落顺序、批注 ID 不漂移；单条批注跨多样式不拆 ID |
| 2. 接入批注合同    | `selection.ts`、`invariants.ts`、`annotation-ranges.ts`，按需调整 guard/clipboard；检查 DOM 块映射和 save-plan 的状态签名                              | 格式范围可创建批注、保留并保存，非法 ID/重叠/屏障仍失败；纯格式编辑不误触发删除                  |
| 3. DOCX 解析与提交 | `types.ts`、`lookups.ts`、`walker.ts`、`markdown.ts`、`commit-schema.ts`，及必要的主题解析/预览验证与提示映射                                          | 指定格式穿过 Worker、缓存、预览、提交；继承/重置准确，提示只报告真实降级                         |
| 4. 阅读表现与合同  | `app/globals.css`、必要的预览提示组件，复核现有阅读/编辑/历史预览消费者                                                                                | 源字号/颜色和批注高亮并存；强制色、窄屏和大字号不破坏基本阅读任务                                |
| 5. 验证与记录      | 补强现有功能测试；更新根目录 `DESIGN.md`、`UX-CONTRACT.md`，记录实际验证与限制                                                                         | 下表行为有明确证据；记录尚未完成的真实浏览器验收，不声称已经端到端通过                           |

DESIGN 更新依据为 D5/D6/D8：网站界面字体和状态色仍固定，用户文档的正文格式是明确例外；源格式范围、默认值、强制色和批注高亮规则应成为长期合同。UX 更新涉及 U4/U7/U8/U9/U10：格式往返、批注身份、选区、模式切换、降级提示及旧预览兼容。本计划尚未批准，当前不改写这两个现行规范。

## 9. 稳定行为验收

复用 `node:test` 和当前分领域测试目录；按能力补强已有套件，不按每个 Bug 新建回归文件。不引入 Vitest 或 Playwright，不为三条 CSS 声明写镜像测试。

| 稳定行为            | 代表性覆盖                                                                                               | 现有测试归属                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| DOCX 格式解析       | 10.5/12/18pt、混色、直接/继承/auto 重置、默认样式、主题色和变体、居中标题/列表/引用/单元格、非法属性降级 | `tests/docx/docx-import-body.test.ts`、`docx-import-rich-content.test.ts`                           |
| Markdown 阅读与安全 | 生成受限 HTML；raw HTML 仍不执行；恶意属性不进入 CSS；plain text 不丢字或带语法                          | `tests/posts/markdown.test.ts`                                                                      |
| 编辑往返            | 同段多格式、annotation 外层与格式外层输入、链接/粗体、表格、连续两次重载、首尾空格与特殊字符             | `tests/annotations/annotation-roundtrip.test.ts`，需要时补充聚焦正文格式的测试文件                  |
| 选区与批注不变量    | 跨样式、跨居中段；AST/DOM 块顺序；emoji 偏移；同 ID 不意外分裂；表格/代码屏障继续拒绝                    | `annotation-selection.test.ts`、`annotation-dom-selection.test.ts`、`annotation-invariants.test.ts` |
| 编辑保护与剪贴板    | 合法格式编辑、边界删除确认、撤销、跨样式粘贴保留格式且剥离 ID、IME                                       | 现有 guard integration、clipboard、IME 套件                                                         |
| 预览恢复与提交      | 原文修复保留格式；旧 v1 无新增字段恢复；新字段过严格 schema；重复提交不丢格式                            | 现有 docx preview、preview-store、import-commit、import-e2e 套件                                    |
| 版本与冲突          | 重载/历史恢复保留属性；批注相关格式变化的冲突保护；旧 Markdown 兼容                                      | 现有 annotation revision/save-plan 和 docx revision 套件                                            |

新增一份小型、可重复生成的格式 DOCX fixture，包含批注边界穿过不同样式、居中段之间的跨段批注、样式继承、颜色重置与主题色；纳入现有 fixture 生成脚本和目录，不写新测试框架。沿用已有真实跨段 DOCX 做兼容对照，不改写用户原始 fixture。

阶段一先运行最小往返与安全样本；后续按变更执行相关功能套件，最终运行 typecheck、相关 lint、生产构建及已有产物合同。全量测试仅在共享 Markdown/批注变更的最终集成点运行一次，出现具体失败再定向重跑。

真实视觉验收关注：正文大字号折行、彩色链接与批注高亮、居中标题、混合字号批注选区、跨段连线、手机 Sheet、200% 缩放和 forced-colors。Happy DOM 只能验证模型和 DOM 映射，不能证明这些视觉结果。当前遵守 `AGENTS.md` 的浏览器限制，不把不可运行的 Playwright 套件列为门槛；后续若请求浏览器验收而基础设施仍不可用，明确记录未验证并提供可审阅的实际结果。

## 10. 本次调查交付

- 已从最新获取的 `origin/main` 建立新分支。
- 已检查导入、渲染、编辑、批注、严格提交 schema、剪贴板和设计/交互合同。
- 已执行五个现有函数的只读探针，结果见第 2 节。
- 本次仅提交此计划；不改产品源码、不运行依赖安装或生产构建、不合并 main、不部署。
- 等待用户审阅推荐方案及范围。批准后按阶段 1 开始实现。
