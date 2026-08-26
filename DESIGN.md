---
version: "1.0"
name: "知临中学"
description: "面向少数受邀同学的私密 Markdown 写作社区，以旧校刊纸张与克制校园绿构成安静、可信的阅读界面。"
colors:
  paper: "#FBFAF7"
  paper-strong: "#FFFEFA"
  ink: "#20251F"
  muted: "#737970"
  line: "#E6E4DC"
  green: "#4F825F"
  green-dark: "#356145"
  green-soft: "#EDF4EE"
  danger: "#A44D47"
  warning: "#8B6A2C"
  warning-soft: "#F6F0DF"
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
---

# 知临中学 Design System

## Overview

### Creative North Star

界面参考一本被同学反复传阅、保存良好的校刊：暖白纸张、墨绿色批注记号、细而清楚的分隔线，以及适合长文阅读的中文衬线正文。它不是复古装饰，也不是公开社交网络的信息流。

### Product context and register

- **Audience and primary job:** 几位彼此认识的受邀中国用户，写作、阅读、回复并在管理员帮助下保护内容历史。
- **Target market and evidence:** 私密中文社区；当前产品规格与现有简体中文界面是直接依据。
- **Locale and language policy:** `zh-CN`；界面动作使用简洁中文，技术名词只在管理员界面保留必要英文，如 Post revisions。
- **Usage scene:** 桌面长文写作为主，手机阅读和轻量回复为辅；低频、低压力、内容密度中等。
- **Register:** 纯产品界面；不使用营销 hero。
- **Memorable signature:** 简笔柚叶/柚子校徽与校刊纸张式长文表面。
- **Restraint:** 编辑器、冲突确认、管理员恢复优先保证可读、可撤回和明确后果。
- **Anti-references:** 不做增长型社交网络、炫光 SaaS 仪表盘、小香风名媛感或新闻报纸式高密排版。
- **Token ownership/runtime mapping:** 本文件记录规范值，`app/globals.css :root` 是运行时唯一 CSS token 来源；修改规范值时必须同步两处并通过静态审计。

## Colors

`paper`/`paper-strong` 提供两层暖白表面，`ink` 与 `muted` 建立正文和辅助信息层级。`green` 是品牌、焦点和当前选择，`green-soft` 仅用于轻提示与选中背景。`warning`/`warning-soft` 标记作者已撤回的内容，`danger` 标记管理员隐藏与高后果确认；状态同时使用文字而不单靠颜色。强制色模式退回系统颜色。

## Typography

标题、帖子正文和历史预览使用 Georgia 与 `Noto Serif SC` 回退，保持校刊式阅读感；控件、导航和元数据使用无衬线栈；Markdown 原文比较使用等宽字体。正文行高约 1.9，控件不使用全大写中文，技术 ID 不直接暴露给普通用户。

## Layout

普通内容列最大宽度 920px，编辑器 1080px，revision 管理页 1180px。管理员历史在宽屏采用 320px 左侧时间线和右侧预览；900px 以下堆叠，时间线自身限高滚动。所有固定弹窗保留安全边距，移动端转为单列操作。

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

### Iconography

使用现有简笔线性 SVG，描边约 1.6–1.7px；只有常见通知铃可无文字，其余关键动作保留文字标签。

### Motion

常规反馈为 150–200ms，现有回复定位高亮为 2.5s 后消退。动画只表达状态；减少动态偏好下不得依赖动画传达结果。

### Content and data visualization

文案从用户视角描述结果：保存修改、处理冲突、恢复此版本。版本号用 `v1`、`v2`，opaque ID 不在界面显示。错误明确说明内容是否仍保存在本地以及下一步动作。

## Do's and Don'ts

- **Do:** 让当前帖子与历史预览共享同一 Markdown 渲染语义。
- **Do:** 让危险选择明确说明不会删除既有 revision。
- **Don't:** 把 revision、restore 或编辑操作混入公开 Activity。
- **Don't:** 用都市 SaaS 渐变、巨型指标或过度圆润卡片破坏私密校刊感。
