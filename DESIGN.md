---
version: "2.0"
name: "知临中学"
description: "面向少数受邀同学的私密 Markdown 写作社区，以旧校刊纸张与克制校园绿构成安静、可信的阅读界面。"
colors:
  paper: "#FBFAF7"
  paper-strong: "#FFFEFA"
  ink: "#242D27"
  muted: "#626B62"
  line: "#E6E4DC"
  primary: "#386647"
  primary-dark: "#356145"
  primary-soft: "#EDF3EB"
  primary-pale: "#F5F8F3"
  danger: "#9B3933"
  danger-soft: "#FBECEA"
  info: "#536257"
  info-soft: "#F0F3EF"
  placeholder: "#F2F3EE"
  warning: "#75591F"
  warning-soft: "#F7F0E2"
  annotation: "#F8E9E5"
  annotation-active: "#F0D2C9"
  annotation-ink: "#833F3A"
typography:
  display:
    fontFamily: "Noto Serif SC, Songti SC, STSong, SimSun, serif"
  sans:
    fontFamily: "Inter, system-ui, Noto Sans SC, Microsoft YaHei, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "10px"
  sm: "8px"
  md: "10px"
  lg: "12px"
spacing:
  section-gap: "24px"
  page-max: "1040px"
  workspace-max: "1320px"
  admin-max: "1800px"
  paper-width: "786px"
  paper-padding: "32px"
components:
  button: {}
  card: {}
  dialog: {}
  editor: {}
  revision-timeline: {}
  annotation-range: {}
  annotation-sidebar: {}
  annotation-sheet: {}
  admin-shell: {}
  admin-table: {}
---

# 知临中学 Design System

## Overview

### Creative North Star

界面参考一本被同学反复传阅、保存良好的校刊：暖白纸张、墨绿色批注记号、细而清楚的分隔线，以及适合长文阅读的中文衬线正文。它不是复古装饰，也不是公开社交网络的信息流。

### Product context and register

- **Audience and primary job:** 几位彼此认识的受邀中国用户，写作、阅读、回复、正文批注并在管理员帮助下保护内容历史。
- **Target market and evidence:** 私密中文社区；当前产品规格与现有简体中文界面是直接依据。
- **Locale and language policy:** `zh-CN`；界面动作使用简洁中文，技术名词只在管理员界面保留必要英文，如 Post revisions。
- **Usage scene:** 桌面长文写作为主，手机阅读和轻量回复为辅；低频、低压力、内容密度中等。
- **Register:** 纯产品界面；不使用营销 hero。
- **Memorable signature:** 简笔柚叶/柚子校徽与校刊纸张式长文表面。
- **Restraint:** 编辑器、冲突确认、管理员恢复优先保证可读、可撤回和明确后果。
- **Anti-references:** 不做增长型社交网络、炫光 SaaS 仪表盘、小香风名媛感或新闻报纸式高密排版。
- **Token ownership/runtime mapping:** 本文件记录规范值，`app/globals.css :root` 是运行时唯一 CSS token 来源；`primary*` 规范 token 映射到既有 `--green*` 运行时变量，`annotation*` 一对一映射到 `--annotation*`。修改规范值时必须同步两处并通过静态审计。

## Colors

`paper`/`paper-strong` 提供两层暖白表面，`ink` 与 `muted` 建立正文和辅助信息层级。`primary` 是品牌、焦点和当前选择，`primary-soft` 仅用于轻提示与选中背景。`annotation` 是克制的淡红正文范围，`annotation-active` 只在 hover、focus 或联动激活时增强，`annotation-ink` 用于批注操作与连线；批注范围另有点状下划线、焦点与语义标签，不能只靠颜色。`warning`/`warning-soft` 标记需要处理的风险，`danger`/`danger-soft` 标记高后果动作与错误；已删除/隐藏内容使用 `muted`/`placeholder` 的中性正常字重占位；强制色模式退回系统颜色。

## Typography

文章正文和品牌使用本地 `Noto Serif SC, Songti SC, STSong, SimSun, serif`，本轮不引入 Web 字体；Windows 明确接受 SimSun/系统 serif 回退。导航、列表、管理界面和批注使用无衬线，Windows 回退 Microsoft YaHei。功能标题 26px/1.35（手机24），文章标题32px/1.45（手机27），列表标题18px/1.5，长文18px/1.9，控件14px；桌面批注13px/1.7，Sheet14px/1.7，元数据12–13px。Windows 实机观感尚待实际验收，不能以 Linux 静态检查替代。

## Layout

浏览外框及 Header 内框1040px；阅读、编辑、导入预览1320px；后台1800px。外侧gutter桌面24px、手机16px，顶部24–28px/20px，Header64px/60px可增高。壳由当前路由实际渲染的页面类型（含对应骨架）在CSS中同步决定，导入随预览阶段整体扩展。通知880px、设置与初始导入720px是外框内居中内列。首页单列，不新增通用右侧栏。

阅读组合 W=min(C,1242px)，C为扣除外侧gutter后的可用宽度。W≥1182px时，纸面786px（720正文+两侧32padding+两侧1border）、沟槽56px、右栏min(400,W−842)；不足1182px进Sheet。读取和编辑共享 `lib/annotations/responsive.ts`，测量组合容器而非正文。CSS容器规则只预置首次渲染纸面位置，线程挂载与connector以组件模式为准。有无批注均固定第一列，空栏不渲染可聚焦控件。普通讨论最大净宽720px，跟随同一纸面列，根回复+一层子回复，缩进24px/12px。

导入预览纸面786px、间距24px、检查栏320px；实际容器不足1130px时堆叠。写作与导入主操作区sticky于Header下方，由同一个Header高度测量供给偏移；工具栏正常文档流。新建页保留DOCX入口；标签仍为最多5个的逗号输入，自动本地草稿不改成服务器草稿。

管理后台保留208px纯文字导航、弹性工作区和278px摘要栏；1200px以下摘要退让，900px以下导航收进details。后台不显示社区页脚，继续占满Header以下视口；表格双轴滚动，总览/成员/日志/摘要各自滚动。表头、选择列和266px操作列保持可达。历史时间线320px，900px以下堆叠。固定弹窗保持安全边距与焦点恢复。

## Elevation & Depth

层级主要依靠纸张色差与 1px 边线，阴影只用于文章纸面、弹窗和账户浮层。顶部导航可粘滞并轻微模糊；内容卡片不使用重阴影。层级 token 固定为 header 400、popover 450、backdrop 500、dialog 600。

## Shapes

纸面10px、弹窗12px、控件8px圆角，计数与状态胶囊使用全圆角。边线始终轻薄；危险动作不通过夸张形状吸引注意。

## Components

### Foundational visual states

所有可点击元素有 hover、键盘焦点、按下和 disabled 状态。选中 revision 使用绿边与浅绿背景；错误与冲突使用文字、图标语义和浅红表面，不单靠颜色。加载按钮保持尺寸稳定。路由切换使用 2px 主题绿进度条且不拦截交互；主要动态页面用接近最终几何的共享 Skeleton，局部慢查询放进独立 Suspense，不让导航与既有页面壳一起消失。错误边界只提供安全说明、重试和返回首页，不显示内部错误文本。普通阅读页只在用户打开回复或批注输入区后加载 Milkdown；帖子编辑与 DOCX Preview 仍直接加载完整编辑器。

### Buttons and actions

现有 `.button` 为共享视觉入口：primary绿底、ghost保留现有次级描边语义、text透明、danger-quiet危险入口、danger仅最终确认。常规40px、紧凑36px、粗指针44px目标；hover仅颜色边线，不上浮。`PendingSubmitButton`负责提交pending、重复提交禁用和叠放文案保宽；编辑页追加上传/冲突占位文案，保留一个提交入口。

主操作为实心绿色，次操作为暖白描边，危险确认为实心暗红。作者删除与管理员隐藏都使用共享确认弹窗，明确说明其他成员讨论是否保留。危险操作与安全主操作分开，弹窗默认首先聚焦取消或保留选项。

### Navigation and data display

顶部导航保持紧凑；帖子采用细分隔线轻列表，动态按时间线展示；revision 用带版本号、创建者、时间和状态徽标的纵向时间线。管理后台的内容类型只出现在左侧索引导航，主区使用状态页签、显式搜索、北京时间日期区间、单一排序和共享原生语义表格，不重复内容类型切换，也不引入通用 DataGrid。总览卡只呈现帖子、回复、批注、批注回复的真实状态计数，不展示推算趋势。Normal、User Deleted、Admin Hidden 可并列显示；批注另显示是否属于当前版本。当前页选择最多 20 条，批量隐藏或永久删除使用固定反馈区和共享确认弹窗。历史正文使用与当前帖子一致的 Markdown 渲染器。

### Forms and overlays

表单由应用处理错误，长文本不可拖拽破坏布局。账户浮层支持点击外部和 Escape 关闭。冲突、放弃草稿与恢复操作使用共享 `ModalDialog`，通过 portal 挂到 `document.body` 的全局层，避免被卡片、侧栏或滚动容器裁切及挤压；同时包含焦点循环、Escape 和焦点恢复。

正文编辑破坏批注边界时也复用共享 `ModalDialog`：首个焦点和默认安全操作必须是“取消”，危险确认不得绑定 Enter。列表最多先展示五条受影响摘要，并明确说明撤下只发生在本地草稿、保存后才提交，Undo/放弃草稿仍可完整恢复。

批注输入复用精简 Markdown 编辑器；用户只能从阅读页合法文本选区打开输入，不存在 Annotation Markdown 源码入口。移动端 thread 使用共享 ModalDialog 的 bottom-sheet 变体：限制高度、尊重安全区、内部可滚动并可由 Escape / 关闭按钮退出。

### Annotation reading

正文范围、右侧卡片、SVG connector 与移动端 Sheet 全部用稳定 `annotation_id` 联动。同一逻辑批注可以由连续正文块中的多个 inline mark 表达；所有同 ID mark 必须一起高亮、激活和定位，桌面 connector 与卡片以第一段可见范围为稳定锚点。正文 mark 可聚焦，卡片可键盘访问；内部普通链接仍保持导航语义。悬停正文 mark 只提供局部视觉反馈，不滚动或改变侧栏位置；点击、键盘激活和通知深链才联动定位。桌面卡片按文档位置排列并避免重叠，间距14px；默认不绘制全量连线，仅激活或焦点线程显示一条细实线；hover不改变选中ID或滚动。使用紧凑的 13px 批注正文与收紧的回复间距，并且不重复展示已由正文高亮表达的选区原文；字体、图片、容器和卡片尺寸变化才合并重测几何，普通 scroll 不触发 React 布局更新，也不重新解析 Markdown。删除或隐藏的根内容只显示占位，其他成员讨论不被连带移除。

合法正文选区在“添加批注”入口、输入弹窗和发布 pending/失败期间必须持续可见；以已保存且含 revision/epoch 的 range 为权威，原生 Selection 只负责最初捕获。视觉优先使用 CSS Custom Highlight，fallback overlay 仍需同时具备背景与点状下划线，不能只靠颜色。每个 thread 只有一个回复输入区，固定放在根批注正文之后、回复计数和列表之前；回复某条回复只重定向并聚焦这个输入区，失败保留草稿，成功后才清空。

编辑页复用同一批注数据与卡片语言，但线程严格只读：只允许激活、定位、阅读根批注和回复，不显示回复、删除、移除或管理入口。锚点位置直接来自当前 ProseMirror DOM；输入变更只按 animation frame 合并测量，不逐字重新解析 Markdown 或请求线程。确认待撤下的批注暂时退出侧栏与连线，Undo 后随 live editor state 恢复。

### DOCX import workspace

DOCX 导入是现有写作表面的受控入口，不是营销上传页。初始态使用清楚的文件选择区说明浏览器解析、20 MB 限制与原始文件不上传；解析态保持固定布局并显示分阶段进度、取消和 typed error；Preview 在桌面使用校刊正文纸面与批注/警告右栏，在移动端按现有 Annotation Sheet 语义堆叠。Word author mapping 明示“Word 导入”和可选站内关联，不能把关联用户渲染成原作者。warnings 使用既有 info/warning/danger 层级和可展开分类，不用装饰性仪表盘。跨连续正文段落的 Word 批注按正式帖子相同的多段 mark 语义导入；穿过代码、表格、图片或其他不支持块的范围仍以明确 warning 跳过。包含正文批注时必须说明导入后仍可继续编辑；只有修改逻辑批注的最外侧受保护端点或破坏 anchor 结构时才会要求确认。

### Iconography

使用现有简笔线性 SVG，描边约 1.6–1.7px；只有常见通知铃可无文字，其余关键动作保留文字标签。

### Motion

常规反馈为 150–200ms，现有回复与批注深链定位使用短暂增强状态。Skeleton shimmer 延迟出现，避免瞬时命中时闪烁；其静态底色、`aria-busy` 与可读状态文本本身就能表达加载。动画只表达状态；减少动态偏好下取消 shimmer、进度条过渡、平移和其他过渡，不得依赖动画传达结果。

### Content and data visualization

文案从用户视角描述结果：保存修改、处理冲突、恢复此版本。版本号用 `v1`、`v2`，opaque ID 不在界面显示。错误明确说明内容是否仍保存在本地以及下一步动作。

## Do's and Don'ts

- **Do:** 让当前帖子与历史预览共享同一 Markdown 渲染语义。
- **Do:** 让正文范围、卡片、connector 和通知深链只通过稳定 annotation id 建立关系。
- **Do:** 让危险选择明确说明不会删除既有 revision。
- **Do:** 让 DOCX Preview 与正式帖子共享 canonical Markdown、Annotation 和图片渲染语义。
- **Don't:** 用文字搜索、DOM offset 或 Markdown source offset 重新定位批注。
- **Don't:** 把 DOCX 导入做成 Word 像素预览，或让 attributed user 看起来像站内原生作者。
- **Don't:** 把 revision、restore 或编辑操作混入公开 Activity。
- **Don't:** 用都市 SaaS 渐变、巨型指标或过度圆润卡片破坏私密校刊感。

## Implementation map and verification

批准依据：[重构方案](docs/plans/zhilin-design-refactor-plan.md)与[三页样板](docs/plans/zhilin-design-reference.html)，样板优先于审查者推测；演示数据与JS不得替代真实查询。

| 角色           | 唯一运行时入口                                                               | 消费方                            |
| -------------- | ---------------------------------------------------------------------------- | --------------------------------- |
| 品牌/语义色    | globals.css :root；primary→--green，danger/info/warning/annotation按同名变量 | 按钮、文字、批注、状态            |
| 页面框架       | globals.css --page-max、--page-gutter与页面类型选择器                        | Header、PageHeader、页面外框      |
| 纸面字体       | globals.css --font-serif                                                     | 阅读、写作、导入、历史正文        |
| 标题/列表/搜索 | PageHeader、PostCard、SearchForm                                             | 首页、标签、个人、搜索、通知      |
| 分页           | lib/pagination.ts、db/queries.ts分页入口、Pagination                         | 社区六类列表                      |
| sticky偏移     | HeaderHeight→--header-height                                                 | 写作/导入操作区、输入焦点滚动间距 |

实际执行记录见 [实施记录](docs/plans/design-refresh-progress.md)。静态审计、类型检查和构建不代表浏览器视觉验收；预览访问被环境策略阻止时，明确保留视觉/Windows/端到端验收缺口。
