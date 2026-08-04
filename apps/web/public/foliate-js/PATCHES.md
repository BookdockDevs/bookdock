# foliate-js 本地魔改点清单（升级必须重放）

> 维护约定：**每次修改本目录内任何文件，必须同步更新本清单**（新增/变更条目 + 提交 hash）。升级 foliate 上游时以此为基线重放。
>
> 识别方式：所有补丁均带 `// bookdock:` 注释标记（grep 可定位）；历史可追溯于 `git log -- apps/web/public/foliate-js/`（初始 vendored `a8e48f2`，后续触碰：`2161acf` / `5981470` / `927b9f8` / `901d83f`）。
>
> 行号基于 2026-08-04 checkout（`901d83f` 附近），升级后先 grep 标记再核对。

## 1. 可追溯补丁（8 处）

### 1.1 `overlayer.js:128-151` — `Overlayer.dashedUnderline`（想法标注）

- **提交**：`2161acf`（multi-user）
- **行为**：新增静态绘制器——想法（idea）标注的微信读书式虚线下划线：`stroke-dasharray '4 3'`、线宽 1.5、圆头（`stroke-linecap: round`），横排画底部、竖排画右侧。
- **上游对照**：上游无此方法（仅 highlight/underline/squiggly/strikethrough/outline）。

### 1.2 `paginator.js:1314-1333` — `#scrollToRect` 滚动模式锚点落位下移 28%

- **提交**：`2161acf`
- **行为**：scrolled 模式 `contextOffset = this.size * 0.28`，`offset = rect.left - margin - contextOffset (+continuous 视图偏移)` + `Math.max(0, …)`——搜索/笔记/书签跳转锚点落在视口上方 28% 处，保留前文上下文。
- **上游对照**：上游直接把锚点贴到视口顶。

### 1.3 `view.js:353` — 搜索高亮样式

- **提交**：`2161acf`
- **行为**：搜索命中高亮从上游 `Overlayer.outline #39c5bbaa`（半透明描边）改为 `Overlayer.highlight { color: '#fbbf2459' }`（半透明黄色填充，与标注同风格）。
- **上游对照**：上游后来抽象为可配置 `#searchDraw/#searchDrawOptions`；bookdock 直接改字面量（vendored 基线早于该重构）——升级时优先迁移到上游配置项。

### 1.4 `paginator.js:348` — `expand()` 空文档守卫

- **提交**：`927b9f8`
- **行为**：`if (!this.document) return`——ResizeObserver 在 iframe 文档就绪前/销毁后触发 expand 时避免 `this.document is null` 刷屏。
- **上游对照**：上游 2024-03（18159a4）刻意删过该检查，bookdock 加回；升级时需重放。

### 1.5 `paginator.js` — `gutter` 布局属性（4 处）

- **提交**：`927b9f8`
- **位置**：
  - `:416` `observedAttributes` 加入 `'gutter'`；
  - `:673` `attributeChangedCallback` 的 `case 'gutter'` 与其他布局属性一起走 `render()`；
  - `:962-970` 宽度折算公式重写：`inset = Math.max(0, Math.min(size - 320, Math.max(size - maxInlineSize, gutter * 2)))`。
- **行为**：**`horizontalPadding` 在 page 模式的作用点**——有效宽度语义 = `min(max-inline-size, size − 2×gutter)`；`min(size−320, …)` 保证小视口 320px 内容下限。`max-inline-size` 仅承担 pageWidth 上限（哨兵 100000 = auto）。
- **上游对照**：上游无 gutter 概念。

### 1.6 `paginator.js:503, 590` — 页眉/页脚带下限

- **提交**：`901d83f`
- **行为**：grid 行改 `max(var(--_top-margin), var(--_header-band, 0px))`（底部对称）；`:host([show-header]:not([flow="scrolled"])) #top { --_header-band: 28px }`——**仅 paginated flow 且带属性时生效**，保证 `verticalPadding = 0` 时页眉页脚文字不被 `#top` 的 `overflow: hidden` 裁掉。`verticalPadding` 语义 = 正文与页眉页脚带的间距。
- **上游对照**：上游无此机制。

### 1.7 `view.js:360` — `addAnnotation` 剥 `|${type}` 后缀

- **提交**：`901d83f`
- **行为**：`const cfi = value.includes('|') ? value.slice(0, value.lastIndexOf('|')) : value`——标注 value 带 `` `|${type}` `` 后缀以区分同 range 的 highlight 与 idea；`|` 不是合法 CFI 字符，`resolveNavigation` 前必须剥掉。
- **坑**：无此补丁则 CFI parse 失败被上层 `.catch(() => {})` 吞掉，**标注全部不渲染且无报错**。

## 2. vendored 基线专属机制（初始 vendored 自带，上游 main 没有，升级全部需要重放）

以下机制在 `a8e48f2` vendored 时就存在（上游从未有过），与 §1 的"补丁"区分——它们没有 `// bookdock:` 标记，只能按功能定位：

### 2.1 滚轮翻页/翻章（`paginator.js:1509-1557`）

- `#onWheel(e)`：scrolled flow → `#onWheelSnap`（章界跨越，"legacy TxtRenderer parity"——bookdock 自己的 TXT 阅读器遗产），paginated → `#onWheelPage`（整页）。
- 常量（`:463-468`）：`SNAP_DELTA_THRESHOLD = 150` / `SNAP_COOLDOWN = 600` / `PAGE_WHEEL_THRESHOLD = 40` / `PAGE_WHEEL_COOLDOWN = 200`。
- 侦听器挂 host 与每个 doc（`:643, 648`，`{ passive: true }`）。

### 2.2 iframe 内键盘翻页（`paginator.js:1559` `#onDocKey`）

- iframe 内 keydown 到不了顶层窗口，这里补 ArrowLeft/Right、PageUp/Down、空格（page 模式）。挂载于 `:652`。

### 2.3 continuous 无缝模式的视图管理

- `#views` Map + `#fillVisibleArea`（`:839`）/ `#trimDistantViews`（`:880`）；远距跳转保留目标 ±2 邻域（`:1612-1613`）；
- `#getVisibleRange`（`:1419`）连续模式按**视口中心**判定主章节（`:1432`）；
- `#afterScroll` 的 anchor 以 fraction 保留（relayout 后按比例恢复，而非 Range）。
- **上游对照**：上游 main 的连续模式实现不同（无 wheel、无中心判定）。

### 2.4 页眉页脚信息栏三格化 + 字号可调（`paginator.js`）

- **提交**：F4（阅读信息栏可配置）
- **行为**：
  - `#header`/`#footer` 从单格改 **3 列 grid**（`grid-template-columns: 1fr 1fr 1fr`）；首格 `text-align: left`、末格 `text-align: right`、中格居中；格内 `padding: 0 10px`；
  - `makeMarginals(3, ...)`（`:976-977`）→ `heads`/`feet` 各 3 个文本元素；**scrolled flow 分支同样建 3 格**（原实现置 null 并清空）——页眉页脚固定在视口顶/底（grid row 1/3，内容在 row 2 滚动），可见性只由 `show-header`/`show-footer` 属性控制（删除了 `:host([flow="scrolled"]) ... display:none`）；
  - band 高下限 `--_header-band/--_footer-band: 28px` 规则去掉 `:not([flow="scrolled"])` 限制（scroll 模式同样需要）；
  - `setMarginals({header, footer, fontSize})` 接受**文本数组**（`[L, C, R]`，字符串自动包成单元素数组向后兼容）；`fontSize` 写 `--_marginal-font-size`（0=清掉回退 `.75em`）；`#setMarginalTexts()` 统一回填（relayout 重建元素后同样调用）；
  - `#headerText`/`#footerText` 初始化为 `['']`。
- **上游对照**：上游单格居中；三格化是 bookdock F4 专属。

## 3. 未改动文件（与上游基线一致）

`epub.js` / `epubcfi.js` / `progress.js` / `search.js` / `text-walker.js` / `fixed-layout.js` / `footnotes.js` / `translator.js` / `tts.js` / `dict.js` / `vendor/*`——升级时可整体替换。

`reader-entry.js` 是 bookdock 自写入口（导出 `globalThis.FoliateReader`，供 `FoliateReader.ts` 动态 import），不属于上游文件。

## 4. 升级 foliate 操作流程

1. 以上游对应版本为基线整体替换未改动文件（§3）；
2. 对 §1 的 7 处补丁逐条重放（grep `// bookdock:` 核对，优先迁移到上游新抽象，如 1.3 的搜索配置项）；
3. 对 §2 的 3 项基线机制按功能重放（无标记，靠行为测试验证：滚轮翻页、iframe 键盘、continuous 无缝翻章）；
4. 跑阅读器相关测试 + 手动验证：搜索跳转锚点位置（28%）、想法虚线下划线、页眉页脚 padding=0 可见性、同 range 一划一想法渲染；
5. 更新本清单的行号与上游版本号。

## 5. 相关文档

- 实现细节与坑：`docs/local/implementation/06-web-reader.md` §13（本清单的文档版，含设计意图）
- vendored 决策：`docs/local/adr/0009-foliate-js-vendored.md`
