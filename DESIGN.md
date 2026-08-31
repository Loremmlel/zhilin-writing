---
version: "1.1"
name: "知临中学"
description: "面向少数受邀同学的私密 Markdown 写作社区，以旧校刊纸张与克制校园绿构成安静、可信的阅读界面。"
colors:
  paper: "#FBFAF7"
  paper-strong: "#FFFEFA"
  ink: "#20251F"
  muted: "#737970"
  line: "#E6E4DC"
  primary: "#4F825F"
  primary-dark: "#356145"
  primary-soft: "#EDF4EE"
  primary-pale: "#F5F8F3"
  danger: "#A44D47"
  warning: "#8B6A2C"
  warning-soft: "#F6F0DF"
  annotation: "#F7E8E6"
  annotation-active: "#EFCBC6"
  annotation-ink: "#7D3934"
typography:
  display:
    fontFamily: "Georgia, Noto Serif SC, serif"
  sans:
    fontFamily: "Inter, system-ui, Noto Sans SC, Microsoft YaHei, sans-serif"
  mono:
    fontFamily: "ui-monospace, monospace"
rounded:
  DEFAULT: "14px"
  sm: "8px"
  md: "10px"
  lg: "14px"
spacing:
  section-gap: "28px"
  page-max: "920px"
components:
  button: {}
  card: {}
  dialog: {}
  editor: {}
  revision-timeline: {}
  annotation-range: {}
  annotation-sidebar: {}
  annotation-sheet: {}
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

`paper`/`paper-strong` 提供两层暖白表面，`ink` 与 `muted` 建立正文和辅助信息层级。`primary` 是品牌、焦点和当前选择，`primary-soft` 仅用于轻提示与选中背景。`annotation` 是克制的淡红正文范围，`annotation-active` 只在 hover、focus 或联动激活时增强，`annotation-ink` 用于批注操作与连线；批注范围另有点状下划线、焦点与语义标签，不能只靠颜色。`warning`/`warning-soft` 标记作者已撤回的内容，`danger` 标记管理员隐藏与高后果确认；强制色模式退回系统颜色。

## Typography

标题、帖子正文和历史预览使用 Georgia 与 `Noto Serif SC` 回退，保持校刊式阅读感；控件、导航和元数据使用无衬线栈；Markdown 原文比较使用等宽字体。正文行高约 1.9，控件不使用全大写中文，技术 ID 不直接暴露给普通用户。

## Layout

普通内容列最大宽度 920px，编辑器 1080px，revision 管理页 1180px。带批注的桌面帖子扩展为舒适正文列、70px 连线沟槽和 270–330px 右栏；卡片按正文位置顺序错开。900px 以下去掉侧栏和引导线，批注线程使用底部 Sheet。管理员历史在宽屏采用 320px 左侧时间线和右侧预览；900px 以下堆叠，时间线自身限高滚动。所有固定弹窗保留安全边距，移动端转为单列操作。

## Elevation & Depth

层级主要依靠纸张色差与 1px 边线，阴影只用于文章纸面、弹窗和账户浮层。顶部导航可粘滞并轻微模糊；内容卡片不使用重阴影。层级 token 固定为 header 400、popover 450、backdrop 500、dialog 600。

## Shapes

主要容器 14px 圆角，字段和小卡 8–10px，计数与状态胶囊使用全圆角。边线始终轻薄；危险动作不通过夸张形状吸引注意。

## Components

### Foundational visual states

所有可点击元素有 hover、键盘焦点、按下和 disabled 状态。选中 revision 使用绿边与浅绿背景；错误与冲突使用文字、图标语义和浅红表面，不单靠颜色。加载按钮保持尺寸稳定。

### Buttons and actions

主操作为实心绿色，次操作为暖白描边，危险确认为实心暗红。作者删除与管理员隐藏都使用共享确认弹窗，明确说明其他成员讨论是否保留。危险操作与安全主操作分开，弹窗默认首先聚焦取消或保留选项。

### Navigation and data display

顶部导航保持紧凑；帖子与动态用列表卡片；revision 用带版本号、创建者、时间和状态徽标的纵向时间线。内容管理用小型筛选列表和可组合状态胶囊表达 Normal、User Deleted、Admin Hidden；同时状态并列显示。历史正文使用与当前帖子一致的 Markdown 渲染器。

### Forms and overlays

表单由应用处理错误，长文本不可拖拽破坏布局。账户浮层支持点击外部和 Escape 关闭。冲突、放弃草稿与恢复操作使用共享 `ModalDialog`，包含焦点循环、Escape 和焦点恢复。

正文编辑破坏批注边界时也复用共享 `ModalDialog`：首个焦点和默认安全操作必须是“取消”，危险确认不得绑定 Enter。列表最多先展示五条受影响摘要，并明确说明撤下只发生在本地草稿、保存后才提交，Undo/放弃草稿仍可完整恢复。

批注输入复用精简 Markdown 编辑器；用户只能从阅读页合法文本选区打开输入，不存在 Annotation Markdown 源码入口。移动端 thread 使用共享 ModalDialog 的 bottom-sheet 变体：限制高度、尊重安全区、内部可滚动并可由 Escape / 关闭按钮退出。

### Annotation reading

正文范围、右侧卡片、SVG connector 与移动端 Sheet 全部用稳定 `annotation_id` 联动。正文 mark 可聚焦，卡片可键盘访问；内部普通链接仍保持导航语义。桌面卡片按文档位置排列并避免重叠，resize/scroll 只重新测量几何，不重新解析 Markdown。删除或隐藏的根内容只显示占位，其他成员讨论不被连带移除。

### DOCX import workspace

DOCX 导入是现有写作表面的受控入口，不是营销上传页。初始态使用清楚的文件选择区说明浏览器解析、20 MB 限制与原始文件不上传；解析态保持固定布局并显示分阶段进度、取消和 typed error；Preview 在桌面使用校刊正文纸面与批注/警告右栏，在移动端按现有 Annotation Sheet 语义堆叠。Word author mapping 明示“Word 导入”和可选站内关联，不能把关联用户渲染成原作者。warnings 使用既有 info/warning/danger 层级和可展开分类，不用装饰性仪表盘。包含正文批注时必须显示 V5 编辑锁提示。

### Iconography

使用现有简笔线性 SVG，描边约 1.6–1.7px；只有常见通知铃可无文字，其余关键动作保留文字标签。

### Motion

常规反馈为 150–200ms，现有回复与批注深链定位使用短暂增强状态。动画只表达状态；减少动态偏好下取消平移和过渡，不得依赖动画传达结果。

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
