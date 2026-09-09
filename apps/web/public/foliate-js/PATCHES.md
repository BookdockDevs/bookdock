# foliate-js 本地魔改点清单（升级必须重放）

> 维护约定：**每次修改本目录内任何文件，必须同步更新本清单**（新增/变更条目 + 提交 hash）。升级 foliate 上游时以此为基线重放。
>
> 识别方式：§1 全部补丁均带 `bookdock:` 注释标记（grep 可定位，每处改动位置都有标记；JS 用 `// bookdock:`，CSS/样式模板内必须写 `/* bookdock: */`，见 §1.10）；§2 基线机制无标记，只能按功能定位。历史可追溯于 `git log -- apps/web/public/foliate-js/`（初始 vendored `a8e48f2`，后续触碰：`2161acf` / `5981470` / `927b9f8` / `901d83f` / `9e36c55`）。
>
> 行号基于 2026-08-06 working tree（`9e36c55` 之后，未提交），升级后先 grep 标记再核对。

## 1. 可追溯补丁（14 处）

### 1.1 `overlayer.js:128-151` — `Overlayer.dashedUnderline`（想法标注）

- **提交**：`2161acf`（multi-user）
- **行为**：新增静态绘制器——想法（idea）标注的微信读书式虚线下划线：`stroke-dasharray '4 3'`、线宽 1.5、圆头（`stroke-linecap: round`），横排画底部、竖排画右侧。
- **上游对照**：上游无此方法（仅 highlight/underline/squiggly/strikethrough/outline）。

### 1.2 `paginator.js:1358-1375` — `#scrollToRect` 滚动模式锚点落位下移 28%

- **提交**：`2161acf`
- **行为**：scrolled 模式 `contextOffset = this.size * 0.28`，`offset = rect.left - margin - contextOffset (+continuous 视图偏移)` + `Math.max(0, …)`——搜索/笔记/书签跳转锚点落在视口上方 28% 处，保留前文上下文。
- **上游对照**：上游直接把锚点贴到视口顶。

### 1.3 `view.js:362` — 搜索高亮样式

- **提交**：`2161acf`
- **行为**：搜索命中高亮从上游 `Overlayer.outline #39c5bbaa`（半透明描边）改为 `Overlayer.highlight { color: '#fbbf2459' }`（半透明黄色填充，与标注同风格）。
- **上游对照**：上游后来抽象为可配置 `#searchDraw/#searchDrawOptions`；bookdock 直接改字面量（vendored 基线早于该重构）——升级时优先迁移到上游配置项。

### 1.4 `paginator.js:367-369` — `expand()` 空文档守卫

- **提交**：`927b9f8`
- **行为**：`if (!this.document) return`——ResizeObserver 在 iframe 文档就绪前/销毁后触发 expand 时避免 `this.document is null` 刷屏。
- **上游对照**：上游 2024-03（18159a4）刻意删过该检查，bookdock 加回；升级时需重放。

### 1.5 `paginator.js` — `gutter` 布局属性（3 处）

- **提交**：`927b9f8`
- **位置**：
  - `:438` `observedAttributes` 加入 `'gutter'`（标记注释在 `:436-437`）；
  - `:704` `attributeChangedCallback` 的 `case 'gutter'` 与其他布局属性一起走 `render()`；
  - `:999-1004` 宽度折算公式重写：`inset = Math.max(0, Math.min(size - 320, Math.max(size - maxInlineSize, gutter * 2)))`。
- **行为**：**`horizontalPadding` 在 page 模式的作用点**——有效宽度语义 = `min(max-inline-size, size − 2×gutter)`；`min(size−320, …)` 保证小视口 320px 内容下限。`max-inline-size` 仅承担 pageWidth 上限（哨兵 100000 = auto）。
- **上游对照**：上游无 gutter 概念。

### 1.6 `paginator.js:525-532, 618-627` — 页眉/页脚带下限

- **提交**：`901d83f`
- **行为**：grid 行改 `max(var(--_top-margin), var(--_header-band, 0px))`（底部对称）；`:host([show-header]) #top { --_header-band: 28px }`——保证 `verticalPadding = 0` 时页眉页脚文字不被 `#top` 的 `overflow: hidden` 裁掉（scrolled flow 同样生效，见 §2.4）。`verticalPadding` 语义 = 正文与页眉页脚带的间距。
- **上游对照**：上游无此机制。

### 1.7 `view.js:357-360` — `addAnnotation` 剥 `|${type}` 后缀

- **提交**：`901d83f`
- **行为**：`const cfi = value.includes('|') ? value.slice(0, value.lastIndexOf('|')) : value`——标注 value 带 `` `|${type}` `` 后缀以区分同 range 的 highlight 与 idea；`|` 不是合法 CFI 字符，`resolveNavigation` 前必须剥掉。
- **坑**：无此补丁则 CFI parse 失败被上层 `.catch(() => {})` 吞掉，**标注全部不渲染且无报错**。

### 1.8 `paginator.js:228-245` — `View.load` iframe 事件超时兜底（2026-08-06）

- **提交**：`6d21188`（首开挂死根治配套）
- **行为**：原实现 promise 只等 iframe `load` 事件（`{once:true}`），**无超时无错误处理**——事件不来（iframe 被摘离 DOM / blob URL 失效 / 事件丢失）则阅读器永久挂起（表象：首开转圈直到 30s "书籍加载超时"，重进因 parseCache 秒开）。现加 10s 兜底：到点文档已就绪则按已加载继续（事件丢失怪癖），未就绪则 reject 让 mount 报真实错误（10s 内出结果，不再 30s 干等）。
- **上游对照**：上游无此机制。

### 1.9 `view.js:117-124` — renderer 级 click 监听只挂一次（2026-08-06）

- **提交**：`7abf03d`（fix(reader): renderer click listener dedup, warm-aware loading spinner, patch marker cleanup）
- **行为**：页边距/间隙点击（iframe 之外落在 paginator 上的 click）产生的 `click-view` 事件，监听器从 `#handleClick`（每次 view load 各挂一条，共享 renderer 上**无限累积**——读 N 章后点一次边距翻 N 页 + 监听器泄漏）上提到 `open()` 创建 renderer 后**只挂一次**。
- **验证**：page 模式翻 ~6 章后点击右侧空白边距只触发 1 次 `click-view`；正文内点击/中区 tap-to-toggle/continuous 间隙点击均正常。
- **上游对照**：上游原实现即 per-view 挂载（有同样问题），升级时确认上游是否已修复，未修复则重放。

### 1.10 `paginator.js` shadow `<style>` 内禁用 `//` 注释（2026-08-09）

- **提交**：`6768bcb` 在 `grid-template-rows` 声明**值内部**写了两行 `// bookdock:` 注释——CSS 没有行注释，整条 `grid-template-rows` 声明被静默丢弃。
- **行为后果**：行模板缺失 → 行退化为 auto + 默认 stretch 均分自由空间 → scrolled flow 下**内容不足一屏的短章被垂直居中**（长章节自由空间为负不受影响，page 模式 `#container` 跨全部行也不受影响，故只有短章中招）。
- **修复**：改为 `/* bookdock: */` 块注释（`#top` 规则里上游遗留的 `// --_gap: 7%;` 一并改为块注释）。**教训：本目录 shadow DOM `<style>` 模板里只能写 `/* */`，写 `//` 浏览器不报错、整条声明静默失效。**升级重放时同样禁止带入 `//`。
- **验证**：短章（序章）`gridTemplateRows` 从 `298px 701px`（均分）恢复为 `0px 1000px 0px`，内容回顶。

### 1.11 `paginator.js:228-310` — Blob 章节 srcdoc 兼容、文档就绪与导航边界保护（working tree）

- **行为**：部分嵌入式浏览器会让 Blob iframe 永远停在旧的 `about:blank`，并且不会触发 `load`；直接检查 `contentDocument` 会把空白文档误判为正文，造成阅读页空白。现在 Blob 章节先 fetch 回 markup，再通过 `iframe.srcdoc` 加载；同时按 `about:srcdoc`/实际 URL 检查文档 readyState，并用 50ms 轮询补足丢失的 `load` 事件，超时明确失败。`#goTo` 拒绝越界章节索引，避免首章/末章翻页访问 `sections[undefined].load`。
- **验证**：隔离本地实例真实浏览器回归：首开约 1 秒显示正文，目录跳转到“第二章 继续”显示对应正文，未再出现 10 秒 iframe 超时。

### 1.12 `footnotes.js` — 脚注引用判定、片段提取与取消（working tree）

- **行为**：显式识别 `epub:type`/`role=doc-noteref`/已验证类名；superscript 只在目标具备注释语义或可提取为非空块级内容时启用，数字索引簇和 backlink 保持普通链接。目标片段在独立临时 `foliate-view` 中渲染，支持同章/跨章、隐藏 `aside`，请求取消和 view dispose 可安全处理异步竞态。
- **宿主契约**：`FootnoteHandler.handle(book, event)` 返回带 `requestId` 的 Promise，发出 `before-render`/`render` 事件；解析或渲染失败由宿主恢复为普通 `display(href)`。
- **上游对照**：上游 `FootnoteHandler` 没有 Bookdock 的保守启发式、可取消请求和临时视图清理边界。

### 1.13 `view.js:307-338` — 正文点击交给宿主脚注会话处理（working tree）

- **行为**：移除旧的 `window.isFootNoteOpen()` / `window.closeFootNote()` 空桩调用；正文点击继续发出既有 `click-view`，由 `FoliateReader` 统一关闭脚注、消费本次点击并避免误翻页。
- **上游对照**：这是宿主接线所需的行为调整，不再让 React 状态泄漏到全局 window。

### 1.14 `paginator.js` shadow `<style>` — scrolled flow 显示原生滚动条（working tree）

- **行为**：只在 `flow="scrolled"` 时恢复 `#container` 的原生滚动条，并使用继承的 `--bd-read-sub` 主题色；paginated flow 继续隐藏滚动条。递进模式下滚动条反映当前章节，continuous 连卷模式下反映当前保留的连续视图。
- **原因**：真正的滚动容器是 paginator shadow DOM 内的 `#container`，宿主 Reader 外层 div 的 `overflow-y-auto` 无法控制它；原有基线 CSS 对所有 flow 统一隐藏了滚动条。
- **上游对照**：上游基线同样隐藏该滚动条；这是 Bookdock 的阅读交互调整。

## 2. vendored 基线专属机制（初始 vendored 自带，上游 main 没有，升级全部需要重放）

以下机制在 `a8e48f2` vendored 时就存在（上游从未有过），与 §1 的"补丁"区分——它们没有 `// bookdock:` 标记，只能按功能定位：

### 2.1 滚轮翻页/翻章（`paginator.js:1553-1604`）

- `#onWheel(e)`：scrolled flow → `#onWheelSnap`（章界跨越，"legacy TxtRenderer parity"——bookdock 自己的 TXT 阅读器遗产），paginated → `#onWheelPage`（整页）。
- 常量（`:486-491`）：`SNAP_DELTA_THRESHOLD = 150` / `SNAP_COOLDOWN = 600` / `PAGE_WHEEL_THRESHOLD = 40` / `PAGE_WHEEL_COOLDOWN = 200`。
- 侦听器挂 host 与每个 doc（`:674, 679`，`{ passive: true }`）。

### 2.2 iframe 内键盘翻页（`paginator.js:1606` `#onDocKey`）

- iframe 内 keydown 到不了顶层窗口，这里补 ArrowLeft/Right、PageUp/Down、空格（page 模式）。挂载于 `:683`。
- **scrolled 分支（2026-08-05）**：原实现 `if (this.scrolled) return`——滚动模式点击正文后焦点在 iframe，顶层窗口的按键处理器永远收不到，方向键切换章节完全失效。现改为 scrolled 流程下：
  - ArrowRight/Left 直接 `nextSection()/prevSection()`（与顶层处理器语义一致；continuous 模式下 nextSection 对已渲染视图只是滚动，天然快）；
  - ArrowDown/Up、PageDown/Up 用 `next/prev(round(size*0.92))` 显式滚动一屏（与底栏上下页按键同语义，页尾自然流入相邻章）——**不能依赖浏览器原生箭头滚动**：切章会销毁被聚焦的旧 iframe，焦点掉回（不可滚动的）文档后原生滚动就死了。可编辑目标守卫提前到公共位置。

### 2.3 continuous 无缝模式的视图管理

- `#views` + `#placeholders` Map、`#loadAdjacentBuffer`/`#fillInitialBuffer`/`#virtualizeDistantViews`；切换到连卷只按向下方向准备当前章节附近的一章，滚动稳定后按方向、剩余少于 2 个视口再加载一章；离视口超过 6 个视口的已渲染章节替换为同高度占位元素，接近时恢复，滚动高度不因释放 DOM 而改变；加载期间只保留最新滚动意图，向上优先恢复当前视口相交的占位章节，只有视口仍落在占位区时才逐个继续补齐，滚轮停在 `scrollTop=0`/最大值时也能触发边界加载；远距跳转才保留目标 ±2 邻域（`:1682-1683`）；
- `#getVisibleRange`（`:1463`）连续模式按**视口中心**判定主章节（`:1493` 处使用）；
- `#afterScroll` 的 anchor 以 fraction 保留（relayout 后按比例恢复，而非 Range）。
- **上游对照**：上游 main 的连续模式实现不同（无 wheel、无中心判定）。

### 2.4 页眉页脚信息栏三格化 + 字号可调（`paginator.js`）

- **提交**：F4（阅读信息栏可配置）
- **行为**：
  - `#header`/`#footer` 从单格改 **3 列 grid**（`grid-template-columns: 1fr 1fr 1fr`）；首格 `text-align: left`、末格 `text-align: right`、中格居中；格内 `padding: 0 10px`；
  - `makeMarginals(3, ...)`（`:983-984` scrolled / `:1015-1016` paginated）→ `heads`/`feet` 各 3 个文本元素；**scrolled flow 分支同样建 3 格**（原实现置 null 并清空）——页眉页脚固定在视口顶/底（grid row 1/3，内容在 row 2 滚动），可见性只由 `show-header`/`show-footer` 属性控制；
  - band 高下限 `--_header-band/--_footer-band: 28px` 规则（`:616-625`）scrolled flow 同样生效；
  - `setMarginals({header, footer, fontSize})` 接受**文本数组**（`[L, C, R]`，字符串自动包成单元素数组向后兼容）；`fontSize` 写 `--_marginal-font-size`（0=清掉回退 `.75em`）；`#setMarginalTexts()`（`:1029`）统一回填（relayout 重建元素后同样调用）；
  - `#headerText`/`#footerText` 初始化为 `['']`（`:458-459`）。
- **上游对照**：上游单格居中；三格化是 bookdock F4 专属。

## 3. 未改动文件（与上游基线一致）

`epub.js` / `epubcfi.js` / `progress.js` / `search.js` / `text-walker.js` / `fixed-layout.js` / `translator.js` / `tts.js` / `dict.js` / `vendor/*`——升级时可整体替换。

`reader-entry.js` 是 bookdock 自写入口（导出 `globalThis.FoliateReader`，供 `FoliateReader.ts` 动态 import），不属于上游文件。

## 4. 升级 foliate 操作流程

1. 以上游对应版本为基线整体替换未改动文件（§3）；
2. 对 §1 的 14 处补丁逐条重放（grep `bookdock:` 核对，优先迁移到上游新抽象，如 1.3 的搜索配置项）；
3. 对 §2 的 4 项基线机制按功能重放（无标记，靠行为测试验证：滚轮翻页、iframe 键盘、continuous 无缝翻章、三格信息栏）；
4. 跑阅读器相关测试 + 手动验证：搜索跳转锚点位置（28%）、想法虚线下划线、页眉页脚 padding=0 可见性、同 range 一划一想法渲染、页边距点击单次翻页；
5. 更新本清单的行号与上游版本号。

## 5. 相关文档

- 实现细节与坑：`docs/local/implementation/06-web-reader.md` §13（本清单的文档版，含设计意图）
- vendored 决策：`docs/local/adr/0009-foliate-js-vendored.md`
