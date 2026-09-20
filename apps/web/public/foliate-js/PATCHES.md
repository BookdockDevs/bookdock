# foliate-js 本地差异与重放清单

> 本目录的通用阅读核心以上游增强版 `foliate-js` 为源码基线。本清单只记录 Bookdock 有意保留的差异和宿主适配契约；不能用早期历史快照作为当前核心证据。
>
> 每个差异都必须写明上游版本、文件/符号、Bookdock 需求、为什么不能只放在适配层、影响范围和验证用例。更新上游基线时先按本清单逐条重放，再运行实现地图和格式兼容台账中的完整验证。

## 0. 可复现基线、许可证和文件范围

- Upstream parent commit：`4512f39859280b8c1f1e6fefa4f104f9e09c55e5`（2026-07-19，`fix(reader): gate concurrent programmatic captured page turns (#5211)`）。
- Upstream `foliate-js` submodule：`74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
- Upstream `foliate-js` package：MIT，作者 John Factotum，版权 `Copyright (c) 2022 John Factotum`，来源仓库 <https://github.com/johnfactotum/foliate-js>。
- 早期历史基线参考：`107f4fa74db0e7247c846c49d6211df3edf9887c`。它不是 Bookdock 当前主核心来源。
- `LICENSE` 保留 foliate-js 的 MIT 来源和历史 fork 说明；`vendor/zip.js`、`vendor/fflate.js` 继续保留各自上游许可证声明，上游清单中列出的 zip.js BSD-3-Clause、fflate MIT、PDF.js Apache 依赖也不能被删除。

本轮从上述上游 submodule 整体替换或核对了：

`epub.js`、`epubcfi.js`、`progress.js`、`search.js`、`text-walker.js`、`overlayer.js`、`footnotes.js`、`tts.js`、`view.js`、`paginator.js`、`fixed-layout.js`、`vendor/zip.js`、`vendor/fflate.js`，并补入上游 module graph 所需的 `fb2.js`、`comic-book.js`、`mobi.js`、`pdf.js`。`reader-entry.js` 是 Bookdock 的浏览器入口，`translator.js` 是 Bookdock 的文本翻译适配模块，两者不是上游同名源码文件。

上游包中的 `opds.js`、`dict.js`、`quote-image.js`、`uri-template.js`、`reader.js`、`ui/`、`tests/`、Rollup/包管理文件以及 `vendor/pdfjs/` 分发资产，均不属于 Bookdock 的 EPUB `reader-entry.js` 运行链：它们分别是 OPDS/词典/引文图片/产品界面/测试构建或 PDF 分发范围。它们不参与本项目的 EPUB 核心加载，也没有被伪装成已迁移的运行时文件；如果未来启用对应格式或产品能力，必须另行引入并登记来源。

运行时入口只有 `FoliateReader.ts` → `/foliate-js/reader-entry.js` → 上游 `View` → `foliate-paginator` 或 `foliate-fxl` 这一条阅读链。旧 `epubjs` 依赖已移除；没有第二套 renderer 运行时选择。

### 0.1 本轮基线整理结论（2026-09-18）

- 当前运行时基线仍固定为本节记录的 parent `4512f398` / submodule `74d8022c`；没有用未核对的外部新快照直接覆盖生产核心。
- 候选快照中的坏 XHTML、动态资源引用计数、脚本可测量布局、fixed-layout 位图 viewport 和媒体交互边界，已按 Bookdock 语义逐项重放为本地补丁；对应条目见 §2、§3 和本文件末尾的 media entries。
- `epub.js`、`view.js`、`paginator.js`、`fixed-layout.js` 的运行时职责、`reader-entry.js` 的浏览器 import graph、脚本默认拒绝和 manifest-first 资源策略均已明确；未登记的上游差异不得直接进入 `public/foliate-js/`。
- 目前未完成的不是“还有一套未接入的核心”，而是样本/浏览器验收、完整检查命令和 P2 级 EPUB3 扩展；这些不改变当前 authoritative baseline。

## 1. 上游基线的公共表面对照

| 文件 | 上游基线导出/公共表面 | Bookdock 处理 |
| --- | --- | --- |
| `epub.js` | `EPUB`、`getEpubMetadata`、`parseEpubMetadataFromXML`；sections、TOC、资源、CFI、media overlay | 保持上游解析模型，增加大小写/百分号路径、封面 XHTML/SVG、常见根路径封面和 manifest-first 的安全 ZIP 资源回退；脚本默认拒绝 |
| `epubcfi.js` | `isCFI`、`joinIndir`、`parse`、`collapse`、`compare`、`fromRange`、`toRange`、`fromElements`、`toElement`、`fake`、Calibre helpers | 保持导出；Bookdock 只在 CFI 适配处剥离类型后缀并对坏定位安全降级 |
| `progress.js` | `TOCProgress`、`PageProgress`、`SectionProgress` | 保持算法；零总大小和空章节返回有限结果；额外暴露分页视口页首 `startFraction`，供宿主与拖拽 seek 使用 |
| `search.js` / `text-walker.js` | `search`、`searchMatcher`、`textWalker` | 保持跨节点、regex、nearby-words；接受旧 `regex: true` 调用 |
| `overlayer.js` | `Overlayer` 和 highlight/underline/squiggly/strikethrough/outline 等绘制器 | 保持完整绘制器；增加 Bookdock idea 的 `dashedUnderline` |
| `footnotes.js` | `FootnoteHandler` | 保持事件模型；增加保守判定、目标提取、取消和临时 view 清理 |
| `tts.js` | `getSentences`、`TTS`；SSML、marks、range iterator | SSML 是主实现；旧 Bookdock 句段 facade 使用独立的 legacy 过滤/断句策略，供当前 Reader TTS adapter 平滑调用 |
| `view.js` | `ResponseError`、`NotFoundError`、`UnsupportedTypeError`、`makeBook`、`View`；load/relocate/search/annotation/media 事件 | 保持上游生命周期和 renderer 公共 API；增加 Bookdock 点击、CFI 后缀、章节页码契约、默认 Media Overlay class、TTS 和脚注接线 |
| `paginator.js` | `isViewVisibleInContainer`、`getDirection`、`computeBackgroundSegments`、`textureAwareBackground`、`Paginator` | 保持上游主分页器；增加 Bookdock 布局别名、页眉页脚、gutter、滚轮、continuous 历史语义和资源背景隔离 |
| `fixed-layout.js` | fixed-layout helpers、`FixedLayout` | 保持上游 fixed-layout；只移除 public 直载时无法解析的裸 polyfill import |
| `reader-entry.js` | Bookdock global bootstrap：`View`、`EPUB`、`Overlayer`、`FootnoteHandler`、zip APIs | 只负责浏览器直载和 global bootstrap，不复制 renderer |

## 2. 必须重放的本地差异

以下条目均以上游 submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4` 为对应版本。条目中的“为什么不能只放适配层”是保留核心补丁的必要条件；如果后续上游提供了等价公共 API，应删除本地分支并更新本清单。

### 2.1 覆盖层和搜索

1. **`overlayer.js` / `Overlayer.dashedUnderline`**
   - 需求：idea 标注需要虚线下划线，横排画在矩形底部，竖排画在右侧，默认 `stroke-dasharray="4 3"`、线宽 1.5、圆头。
   - 不能只放适配层：矩形拆分、SVG 生命周期和覆盖层清理由核心拥有，宿主不应复制绘制器。
   - 影响/验证：只影响 idea overlay；`foliate-overlayer.test.ts` 验证 SVG path、虚线和方向。

2. **`view.js` / `View.addAnnotation` search overlay**
   - 需求：搜索命中恢复为填充高亮（跟随 Bookdock 主题的 `--bd-search-highlight`），不能退化为 outline 框选；切换主题不重载书籍。
   - 不能只放适配层：搜索结果由 View 创建和销毁，颜色必须随核心 overlay 生命周期传递。
   - 影响/验证：只影响搜索临时标注；`foliate-view.test.ts` 验证 `Overlayer.highlight` 和主题色选项，Reader 搜索测试覆盖 nearby-words 与清理。

3. **`view.js` / `View.search` nearby-words 多 CFI**
   - 需求：一个 nearby-words 命中跨多个文本节点时保留多个 `cfis`，再由 View 逐个绘制并去重。
   - 不能只放适配层：范围拆分发生在核心搜索结果到 overlay 的转换阶段，适配层拿不到稳定的多个 Range。
   - 影响/验证：不改变普通命中；`foliate-view.test.ts` 验证两个子范围都产生 CFI。

### 2.2 Paginator 和 view 生命周期

4. **`paginator.js` / `View.expand` 空文档守卫**
   - 需求：ResizeObserver 在 iframe 尚未就绪或销毁后触发时直接返回。
   - 不能只放适配层：expand 是 iframe view 的核心异步回调，宿主无法阻止 renderer 内部 observer 触发。
   - 影响/验证：阻止切书、首开和卸载竞态报错；`foliate-paginator.test.ts` 和全量 Reader 生命周期测试覆盖。

5. **`paginator.js` / `Paginator` 的 `gutter`、`top-margin`、`bottom-margin` 别名和页眉页脚带**
   - 需求：Bookdock `horizontalPadding`、`verticalPadding` 和三格信息栏继续工作；padding 为 0 时页眉页脚仍至少保留 28px。
   - 不能只放适配层：这些值参与 shadow grid、列宽和 iframe layout，外部 CSS 无法可靠替代核心计算。
   - 影响/验证：page/scroll 两种 flow 和 vertical writing mode；paginator contract、Reader settings tests；核心 CSS 使用合法 `/* */` 注释，不使用会使声明静默失效的 `//`。

6. **`paginator.js` / `#scrollToRect` scrolled anchor**
   - 需求：搜索、标注、书签跳转把目标放在视口上方约 28% 处，保留上下文。
   - 不能只放适配层：目标 rect 到 scroll position 的换算必须和连续视图、边距、方向在同一核心坐标系完成。
   - 影响/验证：只影响 scrolled 定位；Reader search/annotation navigation tests 与浏览器定位验收。

7. **`paginator.js` / scrolled 原生 scrollbar**
   - 需求：真实 scroll container 是 shadow DOM 内 `#container`，scrolled flow 显示原生滚动条，paginated flow 不显示。
   - 不能只放适配层：宿主外层无法控制 shadow scroll container 的 scrollbar 和其内容尺寸。
   - 影响/验证：只影响滚动模式交互；paginator shadow style 检查，浏览器滚动条验收。

8. **`paginator.js` / 文档 CSS 布局变量**
   - 需求：向 XHTML 根节点提供 `--bd-page-margin-*`、`--bd-full-width/height`、`--bd-available-width/height`、`--bd-page-break-margin`，供 `duokan-bleed` 和旧分页 CSS 使用。
   - 不能只放适配层：变量值来自每次 columnize/expand 的真实 iframe 尺寸，必须在文档重排前写入。
   - 影响/验证：普通流图片、出血和旧 `page-break-after`；Reader style transform tests、复杂 CSS 浏览器验收。

9. **`paginator.js` / `#demoteUnfragmentableBoxes` 与 body static**
   - 需求：超高 `inline-block/inline-flex/inline-grid/inline-table` 降级为可分页 display，body 避免 absolute layout 造成 expand 循环。
   - 不能只放适配层：必须在核心测量并改写 document layout 后再计算页高。
   - 影响/验证：防止 WebKit 首页裁断；paginator tests 与不可拆分块样本验收。

10. **`paginator.js` / `getDirection` vertical-rl RTL**
    - 需求：正文首个有效子元素声明竖排时也能推断 writing mode；`vertical-rl` 按 RTL page progression。
    - 不能只放适配层：方向决定 paginator 的 flex、scroll property、CFI 目标和翻页方向。
    - 影响/验证：中文/日文竖排；方向单测与浏览器 fixed/reflow 验收。

11. **`view.js` / iframe/blob load readiness、srcdoc、导航边界和 click listener**
    - 需求：Blob 章节先以 `srcdoc` 加载，在 `about:srcdoc`/readyState/丢失 load 事件时有界等待；`#goTo` 拒绝越界；每个 renderer 只挂一个边距 click listener。
    - 不能只放适配层：iframe 文档 readiness、renderer view 数量和导航边界都属于核心生命周期，React 无法修复已错误解析的空白文档。
    - 影响/验证：首开、切章、切书和页边距点击；`foliate-reader-load.test.ts`、view tests，浏览器冷启动验收。

12. **`view.js` / CFI 类型后缀和 fragment fallback**
    - 需求：标注值允许用 `cfi|highlight`/`cfi|idea` 区分同 range overlay，解析前去掉后缀；内部链接完整 href 失败时仍尝试当前 section 的 fragment。
    - 不能只放适配层：View 负责 annotation navigation 和 link event，必须在 CFI/section resolve 前处理。
    - 影响/验证：标注类型共存、同章 `#id` 链接和坏 CFI 普通阅读降级；cfi overlap、annotation 和 view tests。

13. **`paginator.js` / per-section background 与 public controls**
    - 需求：按 iframe section 隔离 body/html background；保留 `no-preload`、`no-background`、`no-continuous-scroll`、`primaryIndex`、`containerPosition`、overflow getters 和 `pan()` 公共面。
    - 不能只放适配层：背景、视图回收和 scroll position 在核心 shadow DOM 内；宿主只能通过稳定 public API 控制。
    - 影响/验证：连续阅读章节背景、主题重写、手势 pan 和预加载；paginator contract/fixed-layout tests 与浏览器验收。

14. **`paginator.js` / 上游 View 的尺寸、字体、图片和 full-page 布局合并**
    - 需求：保留上游的 `columnCount`、`contentPages`、字体 ready 后重排、Safari zoom/resize 图片上限清理、`data-duokan-page-fullscreen`。
    - 不能只放适配层：这些值参与核心 View 的 render、iframe 尺寸和 fixed page 定位。
    - 影响/验证：字号/窗口重排、图片页和 Duokan 封面；fixed-layout/paginator tests 与浏览器验收。

15. **`paginator.js` / continuous mode behavior**
    - 对应版本：Upstream parent `4512f39859280b8c1f1e6fefa4f104f9e09c55e5`、`packages/foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`；历史行为对照为 Bookdock `v0.2.2` tag `a326427a12579b5914b0be2f5404c0234464d320`。
    - 符号：`#onWheel`、`#onWheelSnap`、`#onWheelPage`、`#onDocKey`、`#scheduleBackwardBuffer`、`scrollByViewport`、`scrollByPixels`、`snapWheelStep`；`FoliateReader.applyContinuousScroll` 的 `continuous`/`no-continuous-scroll` 属性切换。
    - 根因/需求：重基线的 paginator 没有迁回 v0.2.2 的 iframe wheel/keyboard 入口、跳章两阶段累计和连续边缘状态；adapter 直接写 `containerPosition` 又绕过了核心边界。另一个迁移遗漏是切换到长卷时只改属性、不启动最终状态下的 `#fillVisibleArea()`，造成“长卷已选中但仍单章”。自动阅读还曾在启动时移除 `snap-turn`，导致跳章模式到章尾既不累计切章也不返回停止信号。关闭模式只允许明确导航切章；跳章第一次到边界、再次同向达到阈值才切章；长卷向下追加、向上非对称回读/回收；滚动模式上下键跳视口、左右键切章。
    - 为什么不能仅放适配层：iframe 事件、section 边界、`#views` 装载/销毁、scroll compensation、主视图计算和模式属性回调都属于 paginator 的 shadow DOM 私有状态；在 React 适配层复制会形成第二套导航和阈值状态。
    - 影响范围：只改变 page/scrolled 的滚轮、iframe 键盘、continuous buffer、模式切换初始化和自动滚动边界；不改变 EPUB 内容、CFI、Range、搜索或标注数据。连续模式历史边缘补章仍只在到达保留窗口边缘并再次同向操作后触发；有 wheel 距离时只回放实际累积距离，没有可测 wheel 距离的触屏场景最多续接一个视口，避免加载完成后停在当前章顶部。显式章节导航不主动加载更上一章，待用户继续向上到历史边缘后再触发。`scrollByPixels` 返回 `false` 表示当前模式阻止继续自动移动，避免关闭模式在章尾无动作空转。
    - 验证用例：paginator/Reader/continuous-scroll/auto-reading 定向测试共 56 项通过；`pnpm test` 的 Server 482、Web 1029 项全量测试通过，`pnpm typecheck`、`pnpm lint`、production build 和 `node --check` 通过；浏览器已验证跳章边界和长卷向下 1→2→3 view 追加、向上不对称增长。自动阅读/键盘的完整实机验收仍标 `[B]`。

16. **`paginator.js` / `#container` full-width scroll surface**
   - 需求：正文和 scrolled 模式的真实滚动容器必须覆盖外层左右 gutter；宽窗口下两侧空白仍应接收滚轮，并由同一个容器参与居中/分页布局。
   - 不能只放适配层：`#container` 位于 shadow DOM 内，外层 Reader 无法把 gutter 的 wheel/scroll 事件转交给内部滚动面，也无法修正列宽计算。
   - 影响/验证：只影响 paginator 的 shadow grid 和 scroll hit area，不改变书籍正文 CSS；`foliate-paginator.test.ts` 验证两种 flow 使用 `grid-column: 1 / -1`，用户实机确认宽屏 page/scroll、滚轮和居中。

17. **`paginator.js` / `#trimDistantViews` 双向连续阅读窗口**
   - 对应上游：submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4` 的 `Paginator`，Bookdock 在其基础上补充双向窗口回收。
   - 需求：seamless 连卷向上阅读时，已完全远离视口的前置 section 也要回收；插入/删除前置 view 后必须补偿 scroll position，保持同一段正文停在视口原处。前置 view 插入前先保留稳定尺寸并让视口越过该保留槽，避免加载中的空 iframe 闪入视口；首次布局和后续字体/图片撑高都要纳入补偿。向上不是向下预加载的镜像：只有到达已保留窗口边缘并再次同向操作时才按需恢复更早 section。
   - 不能只放适配层：section view 的销毁、iframe unload、shadow scroll 坐标和连续 buffer 都由 paginator 私有状态共同维护，宿主只知道当前 public position，无法安全删除前置 view。
   - 影响/验证：只影响连续滚动的内存/布局窗口，不改变正文顺序、CFI 或非连续模式；`continuousScrollTrimBefore` contract test 覆盖距离阈值和活动 section 保留，`#scheduleBackwardBuffer` 与 `#loadAdjacentSection` 覆盖延迟边缘和插入补偿，浏览器已观察向下追加后向上不对称增加 view。

18. **`FoliateReader.ts` / `scrollByPixels` 方向与可见内容 settle**
   - 对应上游：submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4` 的 paginator public `containerPosition`；Bookdock adapter 行为补丁。
   - 需求：自动滚动在 `scrollTop` 和 vertical writing 的负向 `scrollLeft` 上都按“向前”移动；由 paginator 统一决定 snap/continuous 边界是否跨 section；内容已触发 relocate 后立即结束导航 pending 指示器。
   - 根因：旧 adapter 直接修改 `renderer.containerPosition`，因此绕过 paginator 的 off/snap/continuous 边界契约并形成重复导航状态。
   - 不能只放适配层：滚动方向和跨 section 的触发属于 Bookdock 自动阅读与加载状态的组合契约，但 `containerPosition`/`relocate` 是核心唯一能确认的可见位置边界；把它们复制到 React 会产生第二套导航状态。
   - 影响/验证：只影响自动滚动、跨章 pending 和快速进度跳转，不改变手动页面翻页；`FoliateReader.scrollByPixels` 现在委托 paginator public `scrollByPixels`，保留旧 direct-write 仅作兼容 fallback。`foliate-reader-load.test.ts`、`navigation-pending.test.ts`、`click-area.test.ts` 与本轮 continuous/auto-reading 定向测试通过，浏览器 spinner/自动阅读完整确认仍标 `[B]`。

### 2.3 EPUB 资源和元数据

16. **`epub.js` / `Resources` 和 `EPUB` metadata/resource loader**
    - 需求：以上游 metadata/refines、XMP/元数据、XML entity、media overlay、srcset、XHTML cache、display-options XML 为主；同时允许 rootfile/MIME/property 大小写、百分号/相对路径和资源名大小写差异。
    - 不能只放适配层：manifest、spine、resource URL、encryption 和 cover candidate 是核心 book model，外部再解析会产生两套语义。
    - 影响/验证：EPUB2/3 metadata、NCX/nav、CSS/image/font/audio/video；`epub-compatibility.test.ts`、server EPUB tests、真实样书离线检查。

17. **`epub.js` / cover candidate、cover XHTML/SVG 和常见根路径 fallback**
    - 需求：优先 EPUB3 `cover-image`、EPUB2 legacy meta、guide、命名 raster/SVG；非法候选继续找下一个；cover XHTML 内的 `<img>/<image>` 和 `iTunesArtwork`/`cover.*` 可提取。
    - 不能只放适配层：封面候选与 manifest href 解析必须共享 EPUB 的 root path、MIME 和 loader。
    - 影响/验证：只影响封面，不改变章节顺序；server/web EPUB compatibility tests，真实样书封面字节和 MIME 检查。

18. **`view.js` / zip and directory loader case-insensitive lookup**
    - 需求：manifest href 与 zip entry 大小写不同、百分号路径或资源未列 manifest 时仍可尝试图片/字体加载；大小写冲突不猜测。
    - 不能只放适配层：上游 `Loader.loadHref` 在核心递归 CSS/XHTML 资源替换时直接查 entries。
    - 影响/验证：复杂 CSS、外部字体和资源路径；web EPUB compatibility test，真实样书资源图扫描。

19. **`epub.js` / `Loader.loadItem` 与 `Loader.loadHref` 缺失资源回退**
    - 对应版本：Upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 需求：CSS/XHTML 中引用了 manifest 声明但实际 ZIP entry 不存在的字体、图片或样式时，不把 `null` 包成伪 Blob，也不让缺失可选资源阻断章节；保留原引用作为浏览器可忽略的降级路径。常见未闭合 XHTML void 元素（例如 `br`、`img`）先修复后再走 XML 解析；manifest href 大小写不同但唯一匹配时使用 manifest 的真实路径和 MIME，大小写冲突的未声明资源继续拒绝猜测。
    - 不能只放适配层：缺失发生在核心递归资源替换的 `loadItem`/`loadHref` 之间；外部在文档生成后无法恢复 CSS、XHTML、图片和字体的统一资源生命周期。
    - 影响/验证：只影响资源缺失/损坏时的 fallback 与 XHTML 容错，不改变已存在资源的 Blob URL、缓存和引用计数；`epub-compatibility.test.ts` 覆盖 void 元素、唯一的大小写不敏感 manifest 匹配、歧义 archive fallback，后续补齐缺失字体/图片契约和真实样书资源扫描。

### 2.4 TTS、脚注和业务桥接

20. **`tts.js` + `view.js` / 上游 SSML TTS 与旧 Bookdock facade**
    - 需求：以上游 `getSentences`、SSML marks、`prepare`、`prevMark/nextMark` 为主；当前 Bookdock TTS adapter 仍需要 `start/end/from/currentDetail/collectDetails/highlightCfi` 的句段契约，因此通过 legacy constructor facade 接入，并让 `View.initTTS` 异步返回实例。
    - 不能只放适配层：句子 Range、SSML mark 和 document 生命周期由核心创建；适配层复制会导致 TTS 与 CFI/overlay 脱节。
    - 影响/验证：不改变新 SSML API；旧句段调用不显示意外高亮（`{ highlight: false }`）；`tts.test.ts`、Reader TTS tests，浏览器朗读验收。

21. **`footnotes.js` / `FootnoteHandler` 判定、提取、取消和 dispose**
    - 需求：显式 `epub:type=noteref`、`role=doc-noteref`、已知类名优先；superscript 只在目标有注释语义或可提取非空块时启用；支持 hidden aside、`li`、`.note`、`dt`+连续`dd`、跨章目标；请求带 requestId，可取消并清理临时 view。
    - 不能只放适配层：脚注目标需要核心 `View`、CFI/fragment resolve、before-render/render 事件和 iframe disposal，宿主无法安全替代。
    - 影响/验证：数字索引簇/backlink/不可提取目标回退普通 display；`footnotes-handler.test.ts` 五类用例，浏览器脚注验收。

22. **`view.js` / 正文 click-view 与脚注会话**
    - 需求：正文点击只发 `click-view`，由 FoliateReader 统一关闭脚注会话、消费点击并避免误翻页；不再调用旧的全局 `window.isFootNoteOpen` 空桩。
    - 不能只放适配层：点击坐标需要在 iframe/fixed-layout/scale 后统一映射，且必须与核心 link/selection guard 同一事件阶段。
    - 影响/验证：脚注关闭、页边距点击、选区/交互元素不误触发；Reader footnote/click tests。

23. **`progress.js` / `SectionProgress.getProgress` viewport-start fraction**
    - 对应版本：Upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 根因：分页器的 `pageFraction` 表示当前可视页尾，原 `fraction` 因此是“这一页读到哪里”；但 `View.goToFraction()` 的输入是要放到视口页首的全书坐标。Bookdock 直接把两者都当成同一个进度值，导致滑块显示位置和拖拽落点前后错开，页尾越大错位越明显。
    - 需求：保留上游 `fraction` 的页尾语义，同时暴露 `startFraction`；Bookdock 进度、恢复和拖拽统一使用视口页首。
    - 不能只放适配层：页首/页尾的差异只有核心 `SectionProgress` 同时掌握 section 字节权重和分页可视范围，适配层拿不到可靠的同一坐标。
    - 影响/验证：只影响进度显示、保存和按百分比跳转，不改变 CFI/章节内容；`foliate-progress.test.ts` 验证页首与页尾分离，ProgressStrip 使用同一数值，浏览器需验证拖到 25/50/75% 的实际落点。

24. **`FoliateReader.ts` / `applyStyles` 字体 fallback 与书籍字体覆盖**
    - 对应版本：Bookdock adapter against upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 根因：`overrideBookFont` 原本同时承担“应用阅读器字体”和“覆盖作者字体”两个职责；为修 TXT 又增加 `sourceFormat === 'txt'` 分支，结果 TXT 的行为依赖格式参数，且不能解决生成 CSS 已经声明固定字体族的问题。
    - 需求：没有作者字体声明时，Bookdock 字体通过 `html` 继承规则自然生效；只有打开“覆盖书籍字体”才用 `!important` 覆盖作者字体。TXT 生成样式必须保持 font-neutral，不把转换器默认值伪装成书籍 CSS。
    - 不能只放在 UI：字体级联发生在 iframe 文档内，合成 TXT 的固定声明也只能在生成源和核心样式注入边界消除；React 侧无法可靠区分“作者 CSS”和“转换器 CSS”。
    - 影响/验证：影响 TXT 默认字体和所有 EPUB 的作者字体尊重/覆盖边界，不改变字号、行距、段距；`txt-to-epub.test.ts` 验证生成 CSS 不声明字体，`foliate-reader-load.test.ts` 验证无覆盖时为 inherited fallback、有覆盖时保留强制规则，浏览器需分别确认 TXT/EPUB。

25. **`view.js` / `View.#handleClick` 标注命中阻断通用 click-view**
    - 对应版本：Upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 根因：标注点击和正文点击是同一个 iframe click 的两个监听路径。overlay 识别出想法后，核心原有的通用 `click-view` 监听仍继续发事件，Bookdock 随后同时打开想法列表并执行 chrome toggle，于是上下顶栏浮现。
    - 需求：在核心 `View` 发出 `click-view` 前先用同一 overlay hit-test；命中非搜索标注时只交给标注事件，搜索高亮仍保持普通阅读区点击行为。
    - 不能只放适配层：适配层收到 `annotationClicked` 时已经晚于核心 click dispatch，无法撤回已经发出的 `chromeToggle`，也无法可靠区分 iframe 内局部坐标和宿主坐标。
    - 影响/验证：只影响标注点击事件竞争，不改变标注绘制或搜索高亮；`foliate-view.test.ts` 验证标注/搜索/空命中三种分类，浏览器需确认点击想法只打开想法 UI、不浮出上下顶栏。

26. **`paginator.js` / `#display`、`#goTo` 导航代际与可见性恢复**
    - 对应版本：Upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4` 的 `Paginator`。
    - 根因：切章时核心先把 shadow `#container` 设为 `opacity: 0`，但 `section.load`、前置预加载或 `scrollToAnchor` 任一步异常/长时间未决都没有统一的 `finally`；失败分支还把异常吞掉，前面清掉旧 view 后只能把空容器重新显示。连续快速跳转也没有“最新导航胜出”的代际检查，旧任务可能继续重定位或把新任务的内容留在隐藏状态。
    - 需求：连续滚动保持旧内容可见；分页/离散滚动仍可暂时隐藏，但失败必须恢复；目标加载前保留旧 primary，成功后再卸载；失败必须向适配层传播，让宿主提供重试；新导航开始后，旧任务不能再写 primary、anchor、overlayer 或 opacity，且旧任务创建的 view 要清理。
    - 不能只放适配层：opacity、primary view、section preload 和 scroll anchor 都是 paginator 私有状态，React 只能看到一个最终 relocate，无法撤销核心已经执行的 DOM 写入。
    - 影响/验证：影响进度跳转、快速前后章、首次打开和慢资源章节的空白/残留加载状态；不改变 CFI 或章节内容。`foliate-reader-load.test.ts`、`foliate-view.test.ts` 和 `navigation-pending.test.ts` 覆盖适配契约，浏览器需验证 25/50/75% 及快速往返不空白、不永久转圈，并确认失败后可在旧正文上重试。

27. **`FoliateReader.ts` + `ProgressStrip.tsx` / spine section 到 TOC label 映射**
    - 对应版本：Bookdock adapter against upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4` 的 `View.getProgressOf`。
    - 根因：服务端 `chapters` 是 TOC/正文分章，Foliate `sectionFractions` 是 spine 资源边界；一本书可以一个 XHTML 包含多个 TOC 节点，也可以有封面/卷节点，因此把同一个数组下标用于两者会显示“前一章”或把第九章高亮成第十章。真实样书已出现 776 个服务端章节与 121 个 Foliate sections。
    - 需求：seek 数学继续使用 Foliate section 字节坐标；拖动预览标签必须来自核心 `getProgressOf(sectionIndex).tocItem`，不能用服务端章节数组按下标猜测。
    - 不能只放在 React：只有核心知道当前 fraction 实际落在哪个 spine section、该 section 的 fragment/range 和 TOC 进度；适配层若重建一套区间会再次产生坐标漂移。
    - 影响/验证：影响进度条拖动中的章节提示和 TOC 语义，不改变实际 seek 坐标、服务端章节数据或目录点击；`ProgressStrip.test.tsx` 覆盖 section/TOC 数量不一致，`foliate-reader-load.test.ts` 覆盖核心映射，浏览器需确认拖动标签与落点章节一致。

28. **`txt-to-epub.ts` / `STYLE_CSS` 生成源去除固定字体族**
    - 对应版本：Bookdock generated-EPUB adapter against upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 根因：TXT 转 EPUB 模板原先写入 `Noto Serif SC, Source Han Serif SC, SimSun, serif`；即使阅读器关闭覆盖，浏览器也会优先命中这些显式字体，用户选择的 Bookdock 默认字体不会通过 `html` fallback 继承下来。
    - 需求：生成 XHTML 只保留 TXT 的结构、间距和颜色等产品排版，不写字体族；字体由阅读器统一提供默认 fallback，用户打开覆盖时再统一替换。
    - 不能只放在适配层：适配层若继续按 `txt` 强制覆盖，就会把格式判断写进通用 EPUB 核心，并掩盖未来其他生成格式的同一问题；消除错误声明才能让 CSS cascade 语义正确。
    - 影响/验证：只影响服务端生成 TXT EPUB 的字体来源，不改变正文、章节、封面和导出结构；`txt-to-epub.test.ts` 验证 `OEBPS/style.css` 不含 `font-family`，浏览器需确认新上传和升级后的存量 TXT 不打开覆盖也能应用当前阅读字体。

29. **`Reader.tsx` / 桌面 footer summon 热区保持可命中**
    - 对应版本：Bookdock host adapter against upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 根因：隐藏态 footer 的热区与 footer 本体共用 `footerVisible` 条件；footer 未显示时热区本身也是 `pointer-events: none`，因此永远收不到 `pointerenter`，`footerSummon` 无法从 `false` 变为 `true`。现场表现为进度条不出现或无法开始拖动。
    - 需求：桌面热区在隐藏态也必须接收指针进入，以触发 footer 显示；移动端无 hover，继续保持 inert，由中间点击固定 chrome。
    - 不能只放在 paginator：这是 React 宿主浮层的 hit-test/状态机问题，核心只负责阅读坐标，不知道 footer 的显示状态。
    - 影响/验证：只影响桌面进度条/底部控制的唤起，不改变阅读内容和布局样式；Reader 代码已修复，浏览器已确认热区可唤起并完成约 24/50/76% 拖动及下一章/上一章抽查，完整基线对照仍为 `[B]`。

30. **`books.service.ts` / `migrateTxtArtifacts` 迁移 0.2.2 存量 TXT 派生 EPUB**
    - 对应版本：Bookdock server migration for generated TXT EPUBs created by v0.2.2, with the generated-EPUB adapter against upstream `foliate-js` submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
    - 根因：0.2.2 上传 TXT 时只保留服务端生成的 `.epub`，数据库的 `format` 仍为 `txt`；旧 `OEBPS/style.css` 已把转换器默认字体写进 `body`。只改当前 `STYLE_CSS` 只能影响新上传，升级后旧 blob 仍会优先命中显式字体，因此用户必须打开“覆盖书籍字体”。
    - 需求：升级启动时按 `books.meta.txtArtifactVersion` 识别旧产物，读取已存 EPUB、移除仅由旧 TXT 转换器写入的固定字体声明，并用 `StorageDriver.put` 原子替换；新上传/re-toc 记录当前版本，迁移必须幂等。
    - 不能仅放在阅读器适配层：阅读器无法可靠区分存量 TXT 派生 CSS 与作者 EPUB CSS；按 `format` 在前端强制覆盖会重新把格式判断塞回通用核心，也会掩盖数据产物未升级的问题。服务端才拥有派生 artifact 的持久化边界和启动生命周期。
    - 影响/验证：只更新 TXT 派生 artifact 的 CSS 和 `books.meta`/size/updatedAt，不重建章节 XHTML，不改变书籍 ID、CFI、进度、标注或原始 `contentHash`；`books.test.ts` 覆盖字体声明移除、版本标记和二次启动跳过，升级运行日志报告 examined/migrated/skipped/failed，浏览器需确认 0.2.2 存量 TXT 无需打开覆盖即可应用阅读字体。

31. **`view.js` / relocate detail 的 `chapterLocation` 与 Media Overlay 默认 active class**
    - 对应版本：Bookdock `v0.2.2` 的 `View.#onRelocate` 与 `View.open` 兼容契约。
    - 需求：relocate detail 保留 renderer 页码 `{ current, total }`；没有 `media:active-class` 时使用 `-epub-media-overlay-active`，显式值优先。
    - 实现：在当前上游 `page/pages` public getter 上补回 `chapterLocation`，并在 Media Overlay 接线前填充默认 class；不恢复旧 `View` 生命周期或进度实现。
    - 影响/验证：恢复 Reader 的 `pageInChapter`/`chapterFraction` 输入，避免无 active class 的书在 `classList.add/remove` 失败；`foliate-view.test.ts` 覆盖两项契约。

32. **`paginator.js` / navigation lock exception safety**
    - 对应版本：Bookdock `v0.2.2` 的 `#turnPage` 加锁/释放契约。
    - 需求：scroll、fill、相邻章节 `goTo` 或动画等待失败后，后续导航仍可执行。
    - 实现：`#turnPage` 和 `pan` 的锁释放统一放进 `finally`；不改变当前上游导航代际、continuous 或 snap-turn 语义。
    - 影响/验证：只影响异常导航后的可恢复性；`foliate-paginator.test.ts` 验证失败后第二次导航不会被永久短路。

33. **`tts.js` / legacy facade compatibility and SSML mark selector**
    - 对应版本：Bookdock `v0.2.2` legacy TTS sentence behavior plus current upstream SSML core。
    - 需求：`initTTS(false)` 继续跳过隐藏/ARIA/inert/CFI-inert 内容和局部链接，并保留旧标点/引号断句；新 SSML mark navigation 的属性 selector 必须完整闭合。
    - 实现：只在 legacy facade 内恢复旧节点过滤、Range 文本过滤和句段切分；SSML 主实现、marks、prepare 和 navigation API 保持上游结构。
    - 影响/验证：不改变新 SSML 语义；`tts.test.ts` 覆盖从当前位置、lookahead、隐藏内容和局部脚注链接。

34. **`epub.js` / script policy and manifest-first archive fallback**
    - 对应版本：Bookdock current security/product policy，兼容 v0.2.2 的默认脚本拒绝边界。
    - 需求：脚本默认不加载；未来设置项不得绕过核心策略。manifest 未列出的本地资源若实际存在于同一 ZIP，可经过规范化、无歧义查找后按扩展名推断 MIME 并加载；不存在的资源保留自然失败。
    - 实现：`EPUB`/`Loader` 默认 `allowScript = false`，可由未来受控核心策略显式传入；资源 fallback 统一检查精确/大小写安全 entry，覆盖 CSS、SVG、图片、字体、音视频及文档类型，不猜测冲突路径。每个 section 还暴露 `loadHref` 与 `observeDynamicResources`，分页版和 fixed-layout 版在 iframe 建立后挂载资源观察器，在 View/frame 销毁或移除时断开观察器并释放动态资源引用。
    - 影响/验证：脚本和资源 fallback 共用同一 Loader 生命周期、缓存和 Blob URL；默认脚本拒绝边界不变，动态资源只在显式开启脚本并实际写入 DOM 后才会被解析。`epub-compatibility.test.ts` 覆盖默认/显式脚本策略、漏列 CSS/SVG、缺失资源降级、唯一大小写匹配、void 标签修复和动态插入媒体。

35. **`paginator.js` / marginal grid dimensions**
    - 对应版本：当前上游 paginator 的 `#top` CSS grid 与 Bookdock 页眉/页脚信息栏。
    - 需求：页眉必须在第一页可见，页脚必须与正文物理分离；开启信息栏后，正文不能按全高排版再被信息栏覆盖，也不能生成隐式列。
    - 实现：`#top` 使用 header/content/footer 三行，`#header`/`#footer` 横跨完整宽度，`#container` 只占中间 row；顶部/底部用户边距由 shell 轨道只保留一次，`View` 以中间 viewport 的真实尺寸排版。基础主题背景由 `#top` 承担，分页章节背景层的 `#background` 只占中间 row，避免书源白色背景覆盖信息栏。三栏 L/C/R 固定，不随分页列数、竖排或 RTL 改变；移除第一页 `visibility` 隐藏逻辑。
    - 影响/验证：信息栏成为独立布局 chrome，page/scroll/continuous 共用同一几何契约；`foliate-paginator.test.ts` 固化三行、全宽、三栏和背景层约束，浏览器已确认黑色主题下 page 模式的页眉页脚不再出现白条。

36. **`paginator.js` / explicit page column count**
    - 对应版本：Bookdock page-columns setting 与 v0.2.2 paginator 的 non-zero `max-column-count` 语义。
    - 需求：设置为 1/2/3 栏时必须实际使用该列数；窄视口或较大的 `max-inline-size` 不能把显式的 3 栏静默降为 2 栏。
    - 实现：`max-column-count > 0` 直接决定 paginated spread 的 `columnCount`；仅非正值自动模式按可用宽度推导列数。
    - 影响/验证：显式列数会相应缩小每栏正文宽度，但不改变页面推进范围；契约测试覆盖 1/2/3 与窄视口，浏览器确认设置切换后的实际列宽。

37. **`paginator.js` + `fixed-layout.js` / scripted canvas layout and bitmap viewport fallback**
    - 对应版本：Upstream foliate-js candidate fixes `f71a084`（scripted layout）与 `a3816a8`（fixed-layout bitmap viewport）。
    - 根因：脚本在 `display:none` 的 iframe 文档加载阶段执行时，依赖容器尺寸的 canvas 会测到 `0x0`；浏览器为直接位图 spine 文档注入的 `width=device-width` viewport 也不是固定页面宽高，会遮挡自然图片尺寸回退。
    - 实现：Paginator iframe 改为 `visibility:hidden` 但保留布局盒，脚本可以测量真实容器；渲染前短暂隐藏以读取/应用布局，渲染后恢复可见。Fixed-layout 只接受同时拥有正数 width/height 的 viewport meta，否则继续使用 book viewport 或图片 `naturalWidth`/`naturalHeight`；`getViewport` 导出供契约测试复用。
    - 影响/验证：只影响 scripted EPUB 的 canvas 初始化和直接位图 fixed-layout 尺寸，不改变默认脚本拒绝策略；`foliate-fixed-layout.test.ts` 覆盖 synthetic image viewport，Paginator 相关契约继续通过，真实 IDPF/位图样书仍需浏览器回归。

38. **`view.js` / standalone image click bridge**
    - 对应版本：Upstream foliate-js `iframe-open-media` interaction boundary，适配 Bookdock 的 `click-view` page-turn handling。
    - 需求：正文独立 `img` 与 SVG `image` 点击不能误触翻页；链接、按钮、脚注引用等交互元素必须保留原语义，并向宿主提供 section、CFI、资源地址、alt/title 和图片类型。
    - 实现：`View.#handleClick` 在通用 click-area 计算前识别独立图片（含点击 SVG 容器时向上/向下定位子 `image`），发出 `open-media` 事件并跳过 `click-view`；SVG `image` 的 href 以标准 xlink 命名空间/属性与 iframe `baseURI` 解析为绝对地址，杜绝 `NS` 命名空间未定义的异常；`FoliateReader` 转成 `imageClicked`，`useReaderRenderer` 提供宿主回调边界。图片位于链接或其他控件内时继续由原有 link/control handler 处理。
    - 影响/验证：只改变独立图片点击的事件路由和 SVG 资源地址，不改变普通链接/控件行为；`foliate-view.test.ts` 覆盖 SVG 封面点击事件派发，查看器、缩放、保存和复制由 React 宿主层实现。

39. **`view.js` / inline media interaction and error bridge**
    - 对应版本：Bookdock host boundary for native EPUB audio/video controls.
    - 需求：静态 `<audio>`/`<video>` 及其 `source`/`track`/`poster` 资源必须保留浏览器原生控件；点击媒体不能触发阅读器翻页；资源解码失败不能阻断章节正文。
    - 实现：`View.#handleClick` 将 audio、video、object、embed 和 iframe 视为交互控件，不发出 `click-view`；`View.#handleMedia` 用文档捕获监听覆盖静态和脚本动态插入的媒体 `error` 事件，转成带 section、kind 和 source 的 `media-error`；`FoliateReader` 转发为 `mediaError`，Reader 以非阻塞 toast 提示。资源替换和 Blob 引用释放继续由 Loader 与 frame 生命周期负责。
    - 影响/验证：不创建自定义播放器，不改变 `controls`/`source`/`track`/`poster` 语义；静态媒体 fixture 与真实编码播放仍需浏览器回归。

40. **`view.js` / standalone image context-menu bridge**
    - 对应版本：Bookdock host boundary for image context-menu and long-press actions.
    - 需求：独立正文图片的桌面右键和移动端长按必须进入宿主菜单；链接、按钮和脚注引用内的图片不得截断原控件语义，也不得触发阅读器翻页。
    - 实现：`View.#handleContextMenu` 复用图片资源/CFI 解析，阻止默认菜单并发出 `open-media-menu`，携带顶层 viewport 坐标；对 touch/pen 增加 500ms pointer 长按和移动阈值，并与浏览器 `contextmenu` 事件去重；`FoliateReader` 转成 `imageContextMenu`，React 菜单复用查看器的 Blob 保存/PNG 复制动作。
    - 影响/验证：菜单只提供查看、保存、复制，不创建系统分享或图片集合；Escape、点击空白和切书会关闭菜单，真实触屏长按仍需浏览器回归。

41. **`epub.js` / Loader 顶层资源引用计数和 `loadContent()` 重复引用**
    - 对应版本：Upstream foliate-js `Loader.ref` 与 `loadItemXHTMLContent` 修复，按 Bookdock 当前 section/frame 生命周期重放。
    - 根因：没有 parent 的顶层 section load 共享一个 `undefined` 子引用桶，多 View 同时打开同一章节时可能跳过第二次计数并提前 revoke；`loadItemXHTMLContent()` 又会在 `section.load()` 后额外占用一个永不释放的引用。
    - 实现：无 parent 时每次 `ref()` 都独立增加计数；`loadItemXHTMLContent()` 优先复用已有缓存 URL，不再重复调用 `loadItem()`。
    - 影响/验证：只改变同一 EPUB 多 View、脚注 popup 和 section 内容读取的 Blob 生命周期，不改变资源路径或脚本权限；需补多 View/footnote 与重复 `loadContent()` 的定向测试，真实切章内存回收仍待验收。

42. **`epub.js` / deferred heavy media (video/audio) loading for instant text rendering**
    - 对应版本：Bookdock chapter fast text rendering and async media boundary.
    - 需求：含大型视频或音频的 EPUB 章节必须优先秒开显示正文文本；重媒体的解压不得阻塞章节 XHTML 解析，媒体后台并发载入，前端提供加载态视觉反馈，且排版尺寸完全锁定、零布局抖动。
    - 实现：`loadReplaced` 中遍历 `[src]` 时识别 `video`、`audio`、`source`、`track`，将待解析地址转存至 `data-bd-deferred-src` 并跳过首屏阻塞解压；宿主 `normalizeEpubDocumentImages` 针对 `data-bd-deferred-src` 注入深色高对比毛玻璃胶囊加载指示器（`.bd-video-spinner` 与 `.is-media-loading`），在正文完成当前渲染任务后通过 `section.loadHref()` 后台异步解析 Blob 注入 `src`；章节 iframe 按整章高度布局，因此不再以 `IntersectionObserver` 作为媒体启动条件；`view.js` 忽略尚未绑定真实 `src` 的 deferred media 空标签，避免浏览器对空 `source` 的 error 事件造成媒体加载失败误报。卡片容器根据封面海报/视频真实比例自适应排版，去除写死的 `16:9`（仅在空占位时回退），支持播放按钮严格幂等去重；在媒体处于加载态（`.is-media-loading`）、加载失败（`.is-media-error`）以及胶囊淡出期间，播放按钮完全隐藏（`display: none !important; opacity: 0; visibility: hidden`）；全面禁用与屏蔽浏览器内核原生居中覆盖播放键（`video::-webkit-media-controls-overlay-play-button` 等），且在媒体未就绪前不挂载 `controls` 属性，彻底杜绝浏览器原生居中黑色圆形播放按键与加载胶囊发生叠放冲突；加载失败时呈现可点击重试的错误胶囊（`.bd-video-error-badge`）。
    - 影响/验证：首屏文本立即渲染，视频/音频异步就绪；多比例（超宽屏、正方形）媒体无裁切与留灰；单测验证 `loadContent()` 跳过媒体阻塞，DOM 正确标记 deferred-src、自适应占位类名与重试机制。

43. **`paginator.js` / `getVisibleRange` viewport detection on tall images and replaced elements**
    - 对应版本：Upstream foliate-js `paginator.js` `getVisibleRange` DOM visibility detection.
    - 根因：`getVisibleRange()` 中 DOM TreeWalker 的 `acceptNode` 原先仅在元素整体完全处于视口内时（`left >= start && right <= end`）返回 `FILTER_ACCEPT`。当章节开头包含超出视口高度的超长插图/大图时（如高度 1600px 超过视口 800px），`right <= end` 判定为 false；同时因为 `<img>` 是叶子/替换元素，没有子文本节点，TreeWalker 会跳过该元素导致在当前视口内找不到任何可见节点，返回折叠 range（`range.collapsed === true`）。外层判定 `range.collapsed` 直接跳过该章节，导致目录（TOC）跳转后章节正文虽已呈现，但高亮与页眉章节名始终不更新，直到用户向下滚动越过长图并露出正文文本。
    - 实现：在 `paginator.js` 的 `getVisibleRange` 中优化叶子与替换元素（`img`、`image`、`svg`、`video`、`canvas`、`audio`、`object`、`embed`、`iframe`、`hr` 或无子节点元素）的视口相交判定：只要与当前视口重叠（`right >= start && left <= end`），即使单张图片尺寸超出视口也予以接收；构造 Range 时，若起点/终点为元素节点，使用 `setStartBefore` / `setEndAfter`，杜绝空/折叠 Range。
    - 影响/验证：解决了章节开头长图时目录与页眉更新被阻断的问题，不影响普通图文排版与分页计算；`foliate-paginator.test.ts` 覆盖超高大图与叶子元素的视口识别契约。

44. **`paginator.js` / `scrollByViewport` 跳章模式边界切章**
    - 根因：跳章（`snap-turn` + 非 continuous）模式下滚轮在 `#onWheelSnap` 有双段累计切章、自动阅读在 `scrollByPixels` 有边界推进，但离散导航入口 `scrollByViewport`（点击翻页区、上下方向键/PageDown、底栏上下页按钮经由 `FoliateReader.scrollByPages` 全部落在这里）在章尾被 `#renderedViewSize` 钳位后直接 return——`no-continuous-scroll` 下缓冲区只含当前章，钳位即"到底"，导致点击和键盘都无法切到下一章。
    - 实现：`scrollByViewport` 目标与当前位置差 ≤0.5（被钳位）时，若处于 `#snapTurn` 且非 `#continuous` 且未在切章中，复用 `#onWheelSnap` 同款路径 `#adjacentIndex(direction)` + `#goTo({ index, anchor: 0/1 })` 直接切章。离散一键 = "下一章"意图，不做轮询式累计阈值；关闭模式与长卷行为不变。
    - 影响/验证：只影响 scrolled + snap 模式在章节边界的离散导航；jsdom 无布局无法驱动该路径，`node --check` 与全量测试保持通过，浏览器实机验证章尾点击/方向键切章、章首反向、以及关闭/长卷模式无回归。

45. **`epubcfi.js` / `nodeToParts` 元素容器边界的子索引丢失**
    - 根因：Range 边界容器是元素时（`getVisibleRange` 在视口顶恰好压在段落边界时走 `setStartBefore(from)`，startContainer 变成父元素 + 子索引），`nodeToParts` 把子索引挂在偶数元素步的 `offset` 上，而 `partToString` 按规范只对文本步输出 offset——子索引在 CFI 字符串里被丢弃，反解析后落在父元素开头。TXT 转制件每章是少数大段落，滚动模式吸附翻页让视口顶频繁对齐段边界，书签/进度 cfi 因此被钉到章顶（跳转去章顶、与章内任意视口位置产生 ribbon 误匹配）。
    - 实现：`nodeToParts` 开头拦截"元素容器 + 非空 offset"：下钻到 `childNodes[offset]` 以 offset 0 编码（指向子元素之后即越过末尾时，编码最后一个子节点的末尾）；空元素无子节点时退化为纯元素步。文本容器路径不变。
    - 影响/验证：影响所有 `fromRange` 产物（书签、视口范围定位、任何元素边界 Range）；`epubcfi-element-container.test.ts` 覆盖 setStartBefore/setEndAfter/空元素往返解析，cfi-overlap 与全量 Web 测试保持通过。历史数据中已丢失位置的 `,/4,...` 形态 CFI 无法恢复，需要用户重建书签。

## 3. Bookdock 宿主适配（不属于第二套核心）

这些行为保留在 `apps/web/src/features/reader/renderers/FoliateReader.ts`，不再复制进旧 renderer：

- server Range、HEAD、缓存、失败回退和文本/章节预取；
- 页面宽度、gutter、边距、行距、段距、字体、主题、书籍 CSS 覆盖和简繁转换；
- page/scroll/continuous/snap-turn、滚轮、iframe 键盘、click area、页眉页脚三格信息栏；
- CFI、fraction、章节进度、覆盖区间、跨端恢复和 re-toc 失效策略；
- 搜索/选择/标注/脚注/翻译/TTS 生命周期、popup guard、取消和错误降级；
- Reader/React/server mount、unmount、切书、网络错误和通知。

验证这些适配时必须使用上游 public API 或 Bookdock 明确的兼容入口，不读取 renderer 私有字段。`reader-entry.js` 只做浏览器直载 bootstrap；`translator.js` 只做 Bookdock 翻译服务适配。

## 4. 上游基线机制（不是本地补丁，但不能误删）

下列机制来自 Bookdock 在初始 vendored 快照中已有的产品行为，现已在上游 paginator/view 基础上保留或重接：

- paginated/scrolled wheel 与 iframe keyboard；
- continuous adjacent buffer、anchor、向上插入补偿、视图回收边界和异步 fill；
- 三格页眉页脚、字体大小、字段组合、时间刷新和 28px band；
- Bookdock server Range/cache/prefetch 与 renderer 的错误回退。

它们不是“旧核心仍在运行”的证据；它们的当前实现必须始终落在本清单 §2 的核心补丁或 §3 的 FoliateReader 适配层。

## 5. 升级流程

1. 核对上游 parent/submodule 和许可证；
2. 对 §1 文件逐个检查导出、公共属性、方法和事件；
3. 对上游核心文件整体替换，再按 §2 重放本地差异；
4. 检查 `reader-entry.js` 的 browser import graph，不把裸 npm import 带入 public 目录；
5. 运行 web/server 全量测试、typecheck、lint、production build 和所有 vendored JS `node --check`；
6. 用真实 EPUB 检查 metadata、TOC、封面字节/MIME、章节、CSS、图片、字体和坏资源降级；
7. 最后由用户做浏览器基线对照；浏览器验收不能替代前六步。

## 6. 本轮验证证据（2026-09-14）

- Upstream baseline：parent `4512f39859280b8c1f1e6fefa4f104f9e09c55e5`，submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`。
- Historical baseline: Web core contract：117 test files / 1009 tests passed；server：32 test files / 480 tests passed。
- Current round regression: Web 117 test files / 1025 tests passed；server：32 test files / 481 tests passed。The desktop footer summon hit area was verified in code after tracing its hidden-state pointer-event path; browser drag verification remains `[B]`.
- 2026-09-15 repair pass: the four focused Web test files passed 19/19 after restoring chapterLocation, navigation-lock cleanup, Media Overlay default class, legacy TTS compatibility, SSML selector closure, default script denial, and manifest-first archive fallback.
- 2026-09-15 browser repair pass: with both `show-header` and `show-footer`, the paginator kept an 874px full-width scroll surface and rendered the 28px marginal bands without the former left-half layout collapse.
- Web production build、server build、typecheck、lint passed；vendored JavaScript syntax check passed。
- Sample EPUB（本地未入库的大体积真实书样本）：archive ~17 MB；OPF `OEBPS/content.opf`；server parser 776 chapters；first spine chapter `OEBPS/Text/cover.xhtml`，first non-cover TOC entry `版权声明`；cover ~1.5 MB, JPEG signature and `image/jpeg`.
- Sample resource scan：manifest 791 items；2/2 CSS loaded；9/9 declared images loaded；CSS references include 5 missing font files, 5 missing decorative images and missing `regular.css`—these are explicit optional/missing-resource fallback cases in the sample, not parser failures.
- Browser visual/interaction comparison with upstream baseline remains `[B]` and must be performed by the user.
