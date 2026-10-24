---
name: "Quaestor · 司库"
category: Brands
surface: web
colors:
  paper: "#faf8f3"
  linen: "#f2ece5"
  ink-navy: "#1e253d"
  ash: "#6b6674"
  taupe-rule: "#dbd3cb"
  quiet-indigo: "#42508c"
  oat: "#a7917e"
---

# Quaestor · 司库

> Category: Brands

> Surface: web

*你的个人资产管家*

Quaestor（司库）是一个替你管钱的个人 agent：把散落在券商、钱包和交易所里的资产收拢成一本可读的账，替你盯住自己定下的纪律，并在动用任何一笔钱之前先解释清楚。它说话像一位基金经理助理——先结论，再依据，最后只留下你需要决定的那一件事。

## Color Palette

| Role | Name | Hex | Usage |
| --- | --- | --- | --- |
| background | Paper | `#faf8f3` | 页面底色。参考图实测主色：暖白纸面，带一点棕调（chroma 0.007，比纯白暖 5 个点）但仍是最亮的一层；大面积留白是主色。 |
| surface | Linen | `#f2ece5` | 卡片、面板、侧栏托底。比纸面深 3.3 个明度点，仍属浅色；必须配 1px Taupe Rule 才成立。 |
| foreground | Ink Navy | `#1e253d` | 正文、标题、金额。低饱和海军蓝墨色（chroma 0.046），纸面上 14.6:1；色相 271° 接住参考图里靛蓝阴影的方向。 |
| muted | Ash | `#6b6674` | 次级文字、元信息、表格辅助列。纸面上 5.4:1，卡片底上 4.5:1，贴住下限，不要再调浅。 |
| border | Taupe Rule | `#dbd3cb` | 1px 分隔线与卡片描边，实测自图中的浅暖棕（#ddd2ca 同族）。只做结构不做控件边界。 |
| accent | Quiet Indigo | `#42508c` | 主操作、焦点环、图表主线、当前项标记。chroma 0.100 —— 与图中最深那块靛蓝（#5b5694，chroma 0.098）同级，不是高饱和皇家蓝。纸面 7.3:1，卡片底 6.2:1。 |
| accent-secondary | Oat | `#a7917e` | 次级强调，仅装饰层：标签底、下划线、图表次线、区块分隔。实测自图中暖棕 #a7907d。2.9:1，绝不单独承载文字；其上压 Ink Navy 为 5.0:1。 |

## Typography
- **Display:** Newsreader — weights 400, 500, 600 — fallbacks: Iowan Old Style, Georgia, Times New Roman, serif (标题与修辞句专用衬线，字距 -0.01em。正文、按钮、表格一律不用它。)
- **Body:** Inter — weights 400, 500, 600 — fallbacks: system-ui, -apple-system, Segoe UI, Helvetica Neue, Arial, sans-serif (界面与正文。16px 起排，行高 1.6；层级靠字重与留白，不靠变灰。)
- **Mono:** IBM Plex Mono — weights 400, 500 — fallbacks: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace (金额、代码、时间戳。开启 tabular-nums，数字列右对齐。)

## Voice & Tone

- **Adjectives:** 克制, 可信, 有判断力, 亲密, 不喧哗
- **Tone:** 像一位替你管了几年钱的基金经理在说话：先给结论，再给依据，最后只留下你需要决定的那一件事。句子短，动词具体，不用感叹号，不用营销形容词。涉及数字时给区间和前提，而不是单一预测；不确定就直说不确定，并说明缺哪份数据。

### Messaging pillars
- 一本账 —— 券商、钱包、交易所的余额与持仓收拢成一个视图，任何时候打开都对得上。
- 替你盯着 —— 回撤、集中度、现金流这些你自己定的纪律由 agent 持续检查，触发时先解释再建议，不擅自执行。
- 说人话 —— 波动、费率、税与滑点讲成一句话，并附上这句话依据的数据来源。
- 你的钱，你的授权 —— 每一次动用都留痕、可撤回；agent 不替你承担你没同意的风险。

### Vocabulary
- **Use:** 资产, 持仓, 回撤, 集中度, 现金流, 费率, 纪律, 授权, 可撤回, 留痕, 依据, 区间
- **Avoid:** 稳赚, 保证收益, 暴富, 颠覆, 革命性, 无缝, 下一代, AI 驱动, 感叹号标题, emoji 当功能性图标

## Imagery

- **Style:** 暖白纸面 + 单一暖光：燕麦棕的纸、布、木，阴影压向海军蓝。构图安静，留白大于主体，像私人银行的年报插图，而不是科技产品渲染图。
- **Subjects:** 纸质对账单、账簿与手写批注的局部特写, 亚麻织物、木桌面与纸张边缘的静物, 资金流向的抽象线条图／等值线图, 暖白与海军蓝的大面积对照（参考图本身）
- **Treatment:** 低饱和、自然光、轻微颗粒；色温偏暖，但阴影不经滤镜直出，直接压到海军蓝。不用高对比棚拍，不加蓝紫渐变，不描边发光。
- **Avoid:** 紫色／彩虹渐变, 发光 3D 币、金牛、蜡烛图剪贴画, 手绘人物与手绘场景, 带浏览器或手机外框的截图, 明亮多色插画与 emoji 图标

## Layout

- **Radius:** 8px
- **Border weight:** 1px
- **Spacing:** 8px baseline grid · 4px micro-step · 24/32/48/64 section rhythm

### Posture rules
- 控件高度 44px、圆角 8px、1px 描边；表格行高 40px，紧凑工具条 36px，但可点击区域的触点高度不低于 44px。
- 海拔用描边不用阴影：卡片 = Linen 底 + 1px Taupe Rule；只有浮层（下拉、弹窗、命令面板）允许一层柔和阴影。
- 全屏只允许一枚实心主按钮（Quiet Indigo）；其余操作走 1px 描边的次级样式或纯文字链接，同屏不出现两个同等实心按钮。
- 焦点环固定为 2px Quiet Indigo、向外偏移 2px，键盘与鼠标一致；移除焦点环等同于移除可用性。
- 正文 16px / 行高 1.6、行宽 65–75 字符（移动端 35–60）；标题用 Newsreader 500–600 与字距 -0.01em，正文与按钮不用衬线。
- 金额与单位用 nowrap 绑在一起，数字用 IBM Plex Mono + tabular-nums 右对齐；绝不让数字孤行或与货币符号分家。
- 层级靠字重、字号与留白，不靠把正文调灰：次级内容才用 Ash，正文保持完整对比度。
- 图表取色顺序固定为 Quiet Indigo → Ash → Oat，暖棕永远排最后；正负值同时用正负号与颜色表达，不单靠颜色。
- Oat 只做装饰层（标签底、下划线、图表次线、区块分隔），其上必须压 Ink Navy 文字；不允许用 Oat 或 Ash 承载正文。
- 卡片内边距 20 / 24 / 32 三档，圆角 8px；同一视图里不同时出现大圆角、重阴影与渐变边框。
- 导航：顶部 64px 透明条压在纸面上，当前项用 2px Quiet Indigo 下划线标记，不用整块色块高亮；侧栏底色为 Linen。
- 表单：标签常驻在控件上方；错误态同时给 1px error 边框、图标和一句可执行的修复建议，不只用红色。
- 动效 150–260ms，ease-out 进入、ease-in 退出，只表达状态变化与因果；列表逐项错开 30–50ms；尊重 prefers-reduced-motion。
- 深色主题由同一颗种子按算法推导，不手工反色；暗色下要重新校验每一对前景／背景对比度后再使用。
- 无 logo 时用纯排版双语字标：Quaestor 用 Newsreader 600、字距 -0.01em；中文「司库」用系统中文字体（PingFang SC / Noto Sans SC）600、字距 +0.04em（中文不加负字距）。两者可上下叠用或左右并置，拉丁在上/左、中文在下/右作为翻译而非副标题。不加图形标、不加色块底。
- 禁用：紫蓝渐变铺底、每个标题配图标、同屏多个实心按钮、编造的收益率与「10×」类指标、hover 时把文字调灰。
