# Changelog

All notable changes to Bookdock are documented here.

## [0.2.3] - Unreleased

### Highlights

- Refined the vendored reader baseline and book ingestion pipeline for EPUB compatibility, metadata extraction, TXT normalization, and generated TXT artifacts.
- Expanded TXT workflows with chapter-aware content append, automatic continuation prediction, per-book TOC customization, and live previews.
- Continued the library, book-details, settings, and responsive UI polish pass with stronger reader scrolling stability and clearer metadata workflows.

### Added

- TXT append from a file or pasted text, with overlap-aware chapter preview, selectable append start, progress scaling, and reader-cache invalidation after save.
- Per-book TOC previews and custom rules, including template copying, manual regex testing, hierarchy-aware chapter boundaries, and cancellable detected boundaries.
- Regression coverage for TXT parsing and append flows, TOC scoring and migration, book metadata workflows, reader continuous scrolling, and the updated UI.

### Changed

- Improved TXT chapter scanning by compacting unobserved hierarchy levels, preserving excluded leading text, and sharing merged chapter ranges with AI retrieval.
- Refined built-in TOC presets and migrated legacy seed orders and definitions while preserving user-owned rule data.
- Updated the reader's continuous-scroll loading and layout compensation for touch continuation, backward buffer recovery, and late font/image expansion.
- Polished book covers, metadata disclosure, classification controls, account management, reading-data settings, trash settings, and English/Chinese localization.

### Fixed

- Prevented unmatched parent TOC levels from artificially nesting otherwise flat TXT chapters.
- Preserved reading position and existing annotations when TXT content is appended, while rebuilding only the derived EPUB artifact and scaling progress to the new length.
- Reduced continuous-scroll jumps when preceding chapters are inserted or expand after their initial layout.

## [0.2.2] - 2026-09-14

### Highlights

- Added automatic reading in scroll mode with smooth scrolling and timed page turns, speed control, pause/resume, progress display, and coordination with TTS.
- Improved continuous-scroll loading and navigation stability when adjacent sections load or the reader moves across buffer boundaries.
- Continued the reader and library UI polish pass with responsive layouts, touch-friendly controls, themed surfaces, clearer overlays, and empty/error states.

### Added

- Automatic-reading sessions with selection-aware pausing, manual-navigation rebasing, and a dedicated progress indicator.
- Batch deletion for annotations from the reader notes panel.

### Changed

- Refined the existing TOC, search, notes, annotation export, reading-history, and statistics interfaces, including expandable long notes, clearer batch-selection controls, export previews, and localized duration/word-count display.
- Polished the existing book-detail and cover-editing screens, library selection flows, settings edit modes, and modal/flyout placement.
- Improved reader text-conversion synchronization for TOC labels and theme-aware search highlighting, plus popup and selection dismissal across pointer, keyboard, and iframe interactions.
- Updated English and Chinese localization and reader visual tokens for the revised presentation.

### Fixed

- Prevented continuous-scroll jumps and buffer races during adjacent-section loading and backward navigation.

## [0.2.1] - 2026-09-11

### Highlights

- Expanded the reader workspace with richer AI conversations, annotation and sharing flows, speech playback, text transformations, and seamless continuous scrolling.
- Improved library and settings management with responsive presentation, ordered tags, editable TOC presets, unified font management, and clearer recoverable feedback.
- Hardened account validation and failed-login protection for self-hosted users.

### Added

- Reader assistant context slots for selected text, selected paragraphs, and chapters, plus chapter reference chips, durable conversations, stale-history protection, and shared request contracts.
- AI chat from quoted selections, paragraph-aware selection handling, reader-font propagation, richer quote and idea previews, and consistent annotation/share limits and actions.
- Stable browser speech playback with selected voice languages and delayed voice-list refresh, plus an authenticated same-origin Edge TTS gateway with timeout, cancellation, framing, ordering, and shared contracts.
- Provider branding assets and icons for AI and TTS settings, including LM Studio detection.
- Seamless continuous scrolling with viewport-aware adjacent-section loading, reserved heights, edge wheel intent, retained placeholders, and distant-view virtualization.
- Stable point-patch range resolution across text nodes and shared web/server TXT export handling for patches spanning text runs.
- User-defined tag ordering with duplicate-name protection for tags and shelves.
- Stable built-in TOC preset identity, restore-missing-presets support, and an ordered pattern editor whose levels follow the visible rows.
- A unified system, built-in, and uploaded font catalog with per-user visibility, display names, ordering, and uploaded-font scope management.
- Configurable failed-login rate limiting through `AUTH_RPM`, shared validation limits for account credentials and user-owned names, inline error states, typed transient notifications, and a root error boundary.

### Changed

- Improved reader presentation and navigation on narrow screens, with more consistent touch interactions, selection lifecycle, history navigation, page titles, themed favicons, statistics, and settings editing.
- Refined book details, cover editing, context menus, shelf/tag counts, empty states, filters, responsive library styling, settings synchronization, and mobile row layout.
- Improved reader transformations, TXT exports, search/annotation behavior, sharing templates, quote actions, and user-visible text consistency across reading workflows.
- Refined reader assistant controls, context handling, model selection, restored sessions, and provider behavior without exposing secrets or hidden execution details.

### Fixed

- Preserve continuous-scroll position when adjacent chapters load or late iframe layout expansion occurs; ignore no-op anchor recalculations and invalid transient fractions so loading a chapter cannot jump back to the current chapter start.
- Prevent mixed view/placeholder geometry failures while distant continuous-scroll sections are virtualized and restored.
- Preserve leading whitespace and line breaks in edited book descriptions, while still treating whitespace-only values as empty.

## [0.2.0] - 2026-09-08

### Highlights

- Expanded the Web reader into a more complete reading workspace with mobile-friendly library and reader layouts.
- Added a bounded, read-only AI reading workflow with provider profiles, retrieval, citations, durable history, retry, and cancellation.
- Added a Web TTS baseline for transformed text, chapter and selection playback, voice and rate controls, sentence highlighting, chapter continuation, and user-owned voice services.

### Added

- Author and series navigation using existing book metadata.
- Annotation export to Markdown, plain text, and CSV, with copy actions and reversible note sorting.
- EPUB footnote handling using the existing reader engine support.
- Structured server request logs with request context for self-hosted troubleshooting.
- Reader AI tools for bounded chapter reading, lexical retrieval, citations, persisted threads, and visible checkpoint restoration after refresh or SSE loss.

### Changed

- Improved responsive layouts, touch usability, reader navigation, and library organization workflows.
- Expanded reader AI settings and assistant controls while keeping provider secrets server-side.
- Hardened AI tool execution and generation lifecycle handling, including retry, cancellation, ownership checks, and bounded diagnostics.

### Operations

- Aligned the server, Web, and shared package versions to `0.2.0`.
- Prepared the single-container Docker deployment around a persistent `DATA_DIR` and the `/api/v1/health` health check.
- Replaced the historical migration chain with a clean database baseline for the 0.2.0 release.

### Upgrade notes

- The 0.2.0 database baseline does not provide an automatic upgrade path from 0.1.0.
- Before changing deployments, make a complete cold backup of `DATA_DIR`, including the hidden `.jwt-secret` file.
- This release does not include an in-app backup center or online restore.

## 中文

### [0.2.3] - 待发布

#### 主要更新

- 完善内置阅读器基线和书籍导入链路，改进 EPUB 兼容性、元数据提取、TXT 规范化以及 TXT 派生文件处理。
- 扩展 TXT 工作流，支持按章节追加内容、自动预测续接起点、按书自定义目录规则和即时预览。
- 延续书库、书籍详情、设置和响应式界面优化，并提升阅读器滚动稳定性与元数据编辑体验。

#### 新增

- 支持上传文件或粘贴文本追加 TXT 内容，提供基于重复内容的章节预览、追加起点选择、进度比例调整以及保存后的阅读器缓存失效。
- 支持按书预览目录和配置专属规则，包括从模板复制、手动测试正则、层级感知的章节边界以及取消误判的分章边界。
- 增加 TXT 解析与追加、目录评分和迁移、书籍元数据、阅读器连续滚动及界面更新的回归测试。

#### 变更

- 改进 TXT 分章：压平未命中的中间层级，保留被排除的前置正文，并让 AI 检索复用合并后的章节范围。
- 优化内置目录规则，并迁移旧版种子顺序和定义，同时保留用户自定义规则数据。
- 更新阅读器连续滚动加载和布局补偿，覆盖触控续接、向后缓冲恢复以及字体/图片延迟撑高。
- 优化书籍封面、元数据渐进展开、归类控件、账户管理、阅读数据设置、回收站设置以及中英文文案。

#### 修复

- 修复目录父级规则未命中时，普通 TXT 章节被错误嵌套的问题。
- 追加 TXT 内容时保留既有阅读位置和标注，仅重建派生 EPUB，并按新篇幅比例调整阅读进度。
- 减少连续滚动向前插入章节或章节首次布局后继续增高时的位置跳动。

### [0.2.2] - 2026-09-14

#### 主要更新

- 新增滚动阅读模式下的自动阅读，支持平滑滚动、定时翻页、速度调节、暂停/继续、进度显示以及与 TTS 的协作。
- 改进连卷滚动加载和导航稳定性，减少相邻章节加载或跨缓冲区导航时的位置跳动。
- 延续阅读器和书库界面优化，改进响应式布局、触控操作、主题表面、弹层以及空状态和错误状态。

#### 新增

- 自动阅读会话，支持选区感知暂停、手动导航重定位以及独立的进度提示。
- 阅读器笔记面板支持批量删除标注。

#### 变更

- 优化既有目录、搜索、笔记、标注导出、阅读记录和统计界面，包括长笔记展开、批量选择控件、导出预览以及时长/字数本地化显示。
- 优化既有书籍详情、封面编辑、书库选择、设置编辑模式以及模态框/弹出菜单定位的呈现。
- 改进目录文本转换与主题搜索高亮同步，并修正指针、键盘和 iframe 场景下的弹层关闭与选区生命周期。
- 更新中英文文案和阅读器视觉变量。

#### 修复

- 修复相邻章节加载和向后导航过程中的连卷滚动跳动与缓冲竞争问题。

### [0.2.1] - 2026-09-11

#### 主要更新

- 扩展阅读工作区，完善 AI 对话、标注与分享、语音朗读、正文变换和无缝连卷滚动。
- 改进书库和设置管理，加入响应式展示、标签排序、可编辑目录规则、统一字体管理以及更清晰的可恢复反馈。
- 加强自托管用户的账户校验和登录失败保护。

#### 新增

- 阅读助手支持选中文本、选中段落和章节上下文槽位，并加入章节引用 chips、持久化对话、旧历史保护和共享请求契约。
- 支持从引用选区发起 AI 对话，完善段落级选区处理、阅读器字体传递、引用与想法预览，以及标注/分享长度限制和操作顺序。
- 稳定浏览器系统朗读，支持指定声音语言和延迟声音列表刷新；新增带超时、取消、帧解析、顺序收集和共享契约的同源鉴权 Edge TTS 网关。
- 新增 AI/TTS Provider 品牌资源和设置图标，并支持 LM Studio 识别。
- 新增无缝连卷滚动，支持按视口加载相邻章节、预留高度、边界滚轮意图、保留占位和远处视图虚拟化。
- 统一跨文本节点的 point patch 范围解析，并让 Web 与 server TXT 导出支持跨文本运行的替换。
- 支持标签自定义排序，以及标签和书架的同用户重名保护。
- 支持内置目录规则稳定来源标识、缺失规则恢复，以及按可见行顺序确定层级的目录模式编辑器。
- 合并系统字体、内置字体和上传字体的统一目录，支持按用户控制可见性、显示名称、顺序和上传字体作用域。
- 通过 `AUTH_RPM` 配置登录失败限流，统一账户凭据和用户自建名称的校验限制，并加入页面内错误、类型化临时通知和应用根级错误边界。

#### 变更

- 改进窄屏阅读器展示和导航，统一触控交互、选区生命周期、历史导航、页面标题、主题图标、统计和设置列表编辑体验。
- 优化书籍详情、封面编辑、上下文菜单、书架/标签计数、空状态、筛选器、响应式书库样式、设置同步和移动端行布局。
- 改进正文变换、TXT 导出、搜索/标注、分享模板、引用操作，以及阅读流程中的用户可见文本一致性。
- 优化阅读助手控件、上下文处理、模型选择、恢复会话和 Provider 行为，不暴露密钥或隐藏执行细节。

#### 修复

- 相邻章节加载或 iframe 延迟布局展开时保持连卷滚动位置；忽略无变化的锚点重算和无效临时 fraction，避免加载新章节时跳回当前章开头。
- 修复远处连卷章节虚拟化和恢复过程中的视图/占位几何冲突。
- 编辑书籍简介时保留开头空白和换行，同时仍将纯空白内容视为空值。

### [0.2.0] - 2026-09-08

#### 主要更新

- 将 Web 阅读器扩展为更完整的阅读工作区，改进移动端书库和阅读器布局。
- 新增受限的只读 AI 阅读流程，支持 Provider 配置、检索、引用、持久化历史、重试和取消。
- 完成 Web TTS 基础能力，支持转换后文本、章节和选中文本播放、声音与语速控制、句子高亮、章节续播和用户自有语音服务。

#### 新增

- 使用现有书籍元数据进行作者和系列导航。
- 支持将标注导出为 Markdown、纯文本和 CSV，支持复制以及可逆的笔记排序。
- 使用现有阅读器引擎支持 EPUB 脚注。
- 新增带请求上下文的结构化服务器请求日志，便于排查自托管问题。
- 新增受限章节阅读、词法检索、引用、持久化线程，以及刷新或 SSE 断开后的可见检查点恢复。

#### 变更

- 改进响应式布局、触控操作、阅读器导航和书库整理流程。
- 扩展阅读器 AI 设置和助手控制，同时确保 Provider 密钥保留在服务器端。
- 强化 AI 工具执行和生成流程，包括重试、取消、所有权检查和有界诊断信息。

#### 运维

- 将 server、Web 和 shared package 的版本统一为 `0.2.0`。
- 围绕持久化 `DATA_DIR` 和 `/api/v1/health` 健康检查完善单容器 Docker 部署。
- 用 0.2.0 发布所需的全新数据库 baseline 替代历史迁移链。

#### 升级说明

- 0.2.0 的数据库 baseline 不提供从 0.1.0 自动升级的路径。
- 变更部署前，请对完整的 `DATA_DIR` 做冷备份，包括隐藏的 `.jwt-secret` 文件。
- 本版本不包含应用内备份中心或在线恢复功能。

## [0.1.0] - Historical

The initial published version of Bookdock. This entry is retrospective because the 0.1.0 release predates the structured changelog.

### 中文

Bookdock 的首次发布版本。本条目为历史补录，因为 0.1.0 发布时还没有维护结构化 changelog。
