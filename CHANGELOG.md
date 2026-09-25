# Changelog

All notable changes to Bookdock are documented here.

## [0.3.5] - Unreleased

### Highlights

- In-panel updates now show real phase progress and actionable, sanitized diagnostics, with task recovery after reopening About or reconnecting.
- Legado book sources now generate HTTPS URLs correctly behind TLS-terminating reverse proxies.

### Added

- Safe cancellation before an update switches versions, with temporary-file cleanup and a clear result that the old version remains active.
- A development-only update preview for trying progress, failure, cancellation, and recovery UI scenarios locally.

### Changed

- Update diagnostics now distinguish connection, response, download, extraction, verification, promotion, and startup health-check outcomes without combining them into a synthetic overall percentage.
- Legado source, login, import, cover, chapter, and EPUB resource links honor an exact `X-Forwarded-Proto: https` value while retaining the request host.

## [0.3.4] - 2026-09-25

### Highlights

- The library now uses numbered pages with a compact page selector, configurable page sizes, and a reorganized filter and display menu.
- Reading profiles now control chapter-title alignment, size, and spacing; TXT text layout follows reader settings while EPUB keeps its authored layout unless override is enabled.
- Book covers load through cached thumbnails, with the original image available to copy or download from book details.

### Added

- A library page selector with direct page entry, keyboard shortcut, and faster navigation across larger page ranges.
- Chapter-title controls for generated TXT headings and matching EPUB headings when book-layout override is enabled.
- Cached WebP cover thumbnails, generated for new covers and on demand for older books, plus original-cover copy and download actions.

### Changed

- Library pages load 24, 48, or 96 books at a time instead of extending a virtual list; the selected page is kept in the URL, and filters reset it to the first page.
- The library view menu separates filters from display options and groups cover appearance controls; reading selection, popovers, sidebar drawer, and floating controls received visual and interaction refinements.
- A local settings snapshot is restored at startup and synchronized with the query cache to reduce brief library-state changes while settings load.
- Reader theme colors and active book documents now stay aligned in dark mode, while interface wording and contrast were refined in both supported languages.

### Fixed

- A TOC click during reader startup or chapter loading now takes precedence over saved progress and highlights the selected entry immediately; navigation failures retain the selected entry for retry.
- Switching away from a two-section spread no longer leaves an adjacent chapter visible in non-continuous scrolling, and the later visible section identifies the current chapter.
- Reader sidebar panels retain their own scroll positions across switches, remounts, and refreshes; notes wait for the reader TOC before grouping by chapter.
- EPUB background images are preserved when applying reading themes, and TXT chapters can show the selected theme behind their generated content.
- Mixed upload results now describe successful, duplicate, and failed books accurately in both supported languages.

## [0.3.3] - 2026-09-23

### Highlights

- Owners can check and install releases from the About section, with automatic snapshots, health-gated restarts, and rollback when an update fails.
- Shelf and tag sidebars now support selectable sorting and pin-to-top, while library view defaults can be saved per user.
- Guest access is enforced as server-side read-only access, and reader themes and expired-session recovery now stay synchronized and recover cleanly.

### Added

- In-app release updates with release metadata, checksum verification, automatic database snapshots, launcher health checks, and rollback to the previous release.
- Five shelf/tag sidebar sort modes: manual, name, book count, recently added, and recently updated, with per-user direction preferences.
- About settings with runtime version information, release links, manual update checks, and copyable diagnostics.
- System, light, and dark reader theme modes, including live operating-system theme synchronization.

### Changed

- Shelf and tag membership timestamps are maintained by SQLite triggers, and pinned shelves/tags lead every sort mode without changing their membership timestamp.
- Book-list sort and grid/list defaults are now stored per user; explicit URL settings take precedence, followed by server settings, legacy local storage, and built-in defaults.
- Guest sessions are temporary and read-only: guest progress stays in the browser, unavailable actions are hidden or rejected server-side, and full TXT downloads are blocked.
- Username input is sanitized and uniqueness checks use normalized case- and width-insensitive values; password-setting endpoints now require at least eight characters while login remains non-empty-only.
- Settings were reorganized around shared cards, reading-timer controls moved to the statistics page, and the release workflow now runs the in-container update/rollback verification.

### Fixed

- Expired sessions now clear stale user caches and deduplicate concurrent recovery instead of exposing protected pages or producing duplicate redirects and error notifications.
- EPUB range loading retries recoverable failures, missing book title/author fields can be filled from filenames, and reader/TTS state transitions are safer for guest and authenticated users.

### Upgrade notes

- This is the first release containing the in-container updater. Existing deployments must perform one normal `docker compose pull` upgrade before using in-app updates; keep a complete backup of `DATA_DIR`, including `.jwt-secret`.

## [0.3.2] - 2026-09-22

### Highlights

- External clients can use operation-scoped access tokens with explicit permissions, lifecycle management, and safe cross-origin range access.
- Reader progress, TOC boundaries, annotation identity, and font fallback are more reliable across initial saves, duplicate chapter labels, cancelled chapters, and missing glyphs.
- Authentication transitions and reader loading now recover cleanly without exposing protected pages or producing duplicate redirects and error notifications.

### Added

- Operation-scoped `bd_` access tokens with hashed storage, expiration, enable/disable and delete operations, permission checks, token CORS, and redacted logging.
- Persisted annotation `chapterHref` metadata with a database migration so repeated chapter titles remain distinct in notes, exports, and AI ideas.
- Reader font fallback for CJK and symbol glyphs across system, CDN, and uploaded fonts.

### Changed

- Token authorization is limited to an explicit operation registry; range response headers are exposed for remote EPUB reads without adding credentialed cross-origin access.
- Reader progress seeding now uses the complete server response, TOC selection uses active chapter boundaries, and annotation grouping/export follows stable chapter hrefs instead of display labels.
- Web authentication revalidation keeps protected pages hidden, suppresses duplicate 401 redirects, and makes book action notifications identify the affected book.

### Fixed

- Saving the first reading progress no longer leaves the cache at `{ data: null }` when the server has already returned a complete progress record.
- The active TOC now loads the actual current directory boundaries; the first real chapter remains non-cancellable while later chapters can be cancelled and submitted correctly.
- Duplicate chapter labels no longer merge annotations, and missing CJK or symbol glyphs now fall back to an available font.

## [0.3.1] - 2026-09-20

### Highlights

- Improved reader startup and resume reliability: EPUB resource loading is more parallel and cache-aware, slow network states are visible without sticking, and invalid saved positions recover safely.
- Reader annotations, search navigation, and media handling are more stable across reflow, delayed iframe layout, chapter jumps, and deferred media loading.
- Share cards now adapt typography and layout to excerpt length, while the share editor is a single inline customization surface.

### Added

- Persisted raw EPUB chapter-text cache in browser IndexedDB with versioned namespaces and a bounded per-book LRU budget, plus bounded reader resource caching.
- Reader recovery controls for failed or slow iframe loading, invalid CFI fallback, retry, and start-over; explicit sidebar tabs and reading state restore safely.
- Deferred video/audio feedback with adaptive placeholders, readiness-aware controls, and retryable media errors.
- Active search-result highlighting, exact point-replacement jumps, stable chapter tracking, and improved replacement management UI.
- Server gzip/Brotli compression for eligible API/static responses while preserving range and binary-reader semantics.

### Changed

- EPUB loading reuses known archive sizes, bounds range reads, parallelizes resource URL resolution, and keeps heavy media off the initial text-rendering path.
- Annotation and bookmark positioning now preserves element-edge CFI ranges, orders annotations by numeric reading position, and survives iframe/layout stabilization and tab focus changes.
- Share card typography, CJK wrapping, footer anchoring, templates, and customization controls were redesigned; uncategorized library navigation now exits only when it becomes empty after a mutation.
- Reader search range mapping recognizes block boundaries and active-result state without treating transient highlights as annotations.
- Test and fixture data no longer relies on real book titles or private sample metadata.

### Fixed

- Mid-chapter bookmarks and annotations no longer collapse to the chapter start when CFI boundaries use element containers.
- Search ranges across paragraphs, delayed overlay layout, duplicate media play buttons, native loading controls, and media retry states are handled correctly.
- Saved reading positions are no longer overwritten by initial start-of-book relocations before restoration settles.

## [0.3.0] - 2026-09-20

### Highlights

- Introduced the Legado book-source integration: Bookdock can serve its library to the Legado app with category browsing and search, rich-HTML chapter content with text replacements applied, EPUB images and media-overlay audio/video, and login-free scoped access keys.
- Added a personal Profile page with reading achievements and a currently-reading showcase, replacing the account section in Settings, plus an Integrations settings section with planned-integration previews.
- New governance controls: a per-user trash capacity cap with oldest-first auto-purge, an owner-set instance upload limit, and a per-user book-title auto-detection toggle (Auto-detect book titles).
- The reader now respects each book's own typography by default, EPUB TOC keeps its native nesting, and reading-position bookmarks survive layout changes reliably.
- Library batch operations gained per-action toasts with failed-item retry, and the whole client moved onto shared Modal/ConfirmDialog/SmartMenu surfaces with consistent, action-specific toast copy.

### Added

- Legado book source service under `/api/v1/legado`: source manifest, explore with a dynamic category page (section headings, sort selector, shelf and tag buttons; chosen sort persists), search, book info, TOC with volume detection, chapter content, covers, and in-book media resources. Settings gains an Integrations section with an enable switch, access mode (Sign in before use / Sign-in-free access), an Include illustrations and media toggle, copyable source URL, one-tap import, QR import, and source-link regeneration.
- Read-only scoped access keys (one active key per user; SHA-256 hash for authentication, an AES-256-GCM encrypted copy so the key can be viewed again later) for login-free Legado access, carried as a `?key=` parameter in the generated source URL, with 90-day / 1-year / permanent durations; automatically revoked when the service is disabled or the access mode changes. New `legado_access_keys` table (migration 0004).
- Legado renders content as rich HTML (`<usehtml>`): EPUB chapters keep inline styles and paragraph indentation, book details aggregate the synopsis plus file size / original file name / added and updated dates into the intro, and search/explore items carry kind and word-count badges with covers.
- Legado media: when Include illustrations and media is on, chapters embed images, media-overlay audio becomes tap-to-play cues, and videos open through Legado's player; covers and media are served from a cache-aware, path-traversal-guarded resource route.
- Profile page (`/profile`): hero card with avatar/username/member days, Reading Achievements stat cards, a Currently Reading continue-reading shelf, a home-settings dialog for per-module visibility and public-profile preferences (stored locally); avatar/username/password management moved from Settings.
- Auto-detect book titles: title and author extracted from noisy file names (noise brackets, author suffixes, site watermark tails) at upload and metadata reset; per-user toggle, default on.
- Trash capacity cap (Unlimited / 1–5 GB): exceeding it permanently deletes the oldest trashed books, checked on trash access and at boot.
- Owner-only instance upload limit: presets from 100 MB to 5 GB in Settings, validated server-side within 5 MiB–10 GiB, enforced on upload and TXT append; the public instance endpoint exposes the effective cap so anonymous visitors see the real limit before signing in.
- Library search now also matches format, description, series, subjects, publisher, ISBN, identifier, source, shelf, and tag names; added sort by upload time.
- Batch actions report per-action results, and failed items can be retried alone; a partial shelf-move failure now warns explicitly instead of looking successful.
- Integrations settings previews planned connectors (OPDS, KOReader sync, WebDAV & cloud drives) as disabled roadmap cards.
- Reader reading-position bookmarks persist via the canonical `contentCfi` location (renamed from `anchorCfi`), which stays accurate across scroll/resize re-layouts.

### Changed

- With Override Book Layout off, the reader keeps each EPUB's own line-height, indent, paragraph spacing, and alignment (no injected paragraph CSS); the override defaults now start off.
- Snap page-turn across chapter boundaries at the scroll clamp (foliate-js patch #44); the click that refocuses the window no longer double-turns a page, and the activation-click guard was broadened to more browser focus scenarios.
- Upload sheet and book details rebuilt on the shared Modal; the add-reading-record dialog and share card moved onto the same shared surfaces; duplicate-only uploads now warn instead of silently succeeding.
- Destructive confirmations standardize on the upgraded shared ConfirmDialog (backdrop blur, focus management, contextual warnings).
- Reader side menus and the selection bar unified on SmartMenu/MenuFlyout behaviors; the reader sidebar's hover-expand zone no longer overlaps the top header strip.
- Toast copy de-genericized across the app: delete/restore/purge, upload, batch, and settings-save toasts now name the affected book or the specific failure instead of a shared success/failure string; the stats page uses loading skeletons.
- Settings reorganized into Library and Upload groups; account entry in the header now opens the Profile page with a left click.
- Chinese UI copy consistency pass: the product is written 书坞 everywhere (profile member-days and public-profile hint included), hard-coded stats/WebDAV strings moved into i18n, metadata-save and read-status labels reworded.
- Reading-position bookmark detection uses CFI range intersection; the sidebar reopens to its remembered state after toolbar unlock.
- EPUB TOC now preserves the native nesting of NCX navMap and EPUB3 nested lists; stored chapter levels of existing books are upgraded lazily (the upgrade intentionally does not bump the book's update time).
- AI citation ordering now follows the cfiRange reading order so multi-cite answers list passages in book sequence.

### Fixed

- The library header's trash-cap indicator showed a malformed raw warning string with an empty size; it now renders the short cap label with the formatted limit.
- TXT multi-volume joins no longer mis-offset chapter boundaries when volumes are merged before parsing.
- Recovering a normalized TXT no longer duplicates the first-chapter title; a duplicated leading heading inside chapter content is now removed.
- A single malformed replacement regex no longer breaks TXT export or Legado chapter delivery (rules are isolated per-rule).
- The annotation highlight bubble no longer lingers or misplaces after selection changes, and the library sidebar's uncategorized row renders correctly in both list and grid modes.

## [0.2.4] - 2026-09-19

### Highlights

- Rebuilt the legacy text-transform feature into the unified text replacement module, with global pattern rules and book-local point patches, wired through reader search, AI visible content, and TXT/EPUB export.
- Expanded the reader media experience with a media-overlay pill with scrubbing, a dedicated image viewer, and deferred, theme-aware inline video.
- Overhauled trash, upload, and cover workflows: retention countdown details and a per-user trash master switch, resilient upload feedback, and durable placeholder cover colors that users can pin.

### Added

- Media overlay pill with dual-color progress, interactive scrubbing, text-cue synchronization, SMIL time tolerance, and mutual pause coordination with TTS, plus an image viewer and image context menu with zoom, pan, save, and copy actions.
- Per-user trash master switch: turning it off permanently deletes the current trash and bypasses the trash for later deletions; the trash now also shows deleted-days and purge countdown, total and freed sizes, server-side deleted-at sorting, and list/grid parity.
- Per-item upload retry, a sheet that stays resumable when closed mid-upload, localized row errors mapped from server codes, and a read-only instance upload limit (`uploadMaxBytes`) used for client-side pre-checks.
- Pinned placeholder-cover palettes picked from the edit dialog's cover overlay; the default palette now hashes the immutable book id, and the library list surfaces the pin without shipping full book meta.
- Book details show the original uploaded file name as a copyable row, and the library list response carries the total size of all matching books.

### Changed

- The text-transform module is now text replacement: pattern rules with global and per-book scopes, book-local point patches, per-book enablement overrides, validation with isolated regex execution, management dialogs, and a migration that preserves legacy transform data.
- Inline media decompress after text is on screen instead of during chapter preparation, videos gain themed wrapper cards with tap-to-play, and legacy cover-float and 0em table styles are normalized to prevent multi-column pagination overflow.
- Duplicate uploads merge requested tags into the existing book without silently moving its shelf, and the sheet reports the already-exists outcome.
- Stabilized reader lifecycle across book switches (loading, navigation, cached content, TOC state, bookmark anchors); started books now display an explicit 0% progress bar.
- Delete confirmations and toasts switch to permanent-delete wording while the trash switch is off.

### Fixed

- Shelf and tag sidebar counts no longer include trashed books.
- The upload sheet no longer closes on mouse release after a drop (Chrome's trailing `dragleave`), reopening shows a clean queue instead of stale completed rows, and drag-over highlighting is a subtle tone swap rather than a flashing border invert.
- Navigating to chapters that begin with tall images syncs TOC and marginal titles immediately by counting viewport-overlapping replaced elements.

## [0.2.3] - 2026-09-16

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

### [0.3.5] - 待发布

#### 主要更新

- 应用内更新现在显示各阶段的实际进度和可操作的脱敏诊断；重新打开「关于」或浏览器重连后仍可恢复任务状态。
- Legado 书源在 TLS 终止反向代理后也能正确生成 HTTPS 链接。

#### 新增

- 版本切换前可安全取消更新，服务端会清理临时文件，并明确显示旧版本仍在运行。
- 新增仅供开发环境使用的更新预览页，可在本地体验进度、失败、取消和页面重开场景。

#### 变更

- 更新诊断分别呈现连接、响应、下载、解压、校验、切换和启动健康检查结果，不再使用合成的总体百分比。
- Legado 书源、登录、导入、封面、章节和 EPUB 资源链接会识别精确的 `X-Forwarded-Proto: https`，并保留请求 Host。

### [0.3.4] - 2026-09-25

#### 主要更新

- 书库改为编号分页，提供紧凑的翻页控件、可选每页数量，以及重新整理的筛选和显示菜单。
- 阅读预设可调整章节标题的对齐、大小和间距；TXT 始终应用阅读排版设置，EPUB 仅在开启覆盖书籍排版时应用。
- 书籍封面使用缓存缩略图加载，并可在书籍详情中复制或下载原图。

#### 新增

- 书库分页支持直接输入页码、快捷键和跨较多页面时的快速跳转。
- 章节标题设置适用于生成的 TXT 标题，以及开启排版覆盖后与目录匹配的 EPUB 标题。
- 为新封面生成并缓存 WebP 缩略图，旧书封面则按需生成；书籍详情新增原图复制与下载操作。

#### 变更

- 书库以每页 24、48 或 96 本的方式加载，不再持续扩展虚拟列表；当前页保存在 URL 中，切换筛选条件时回到第一页。
- 书库视图菜单将筛选与显示选项分开，并集中管理封面外观；阅读器选中文本工具栏、提示浮层、侧栏抽屉和悬浮控件优化了外观与交互。
- 启动时恢复本地设置快照并同步查询缓存，减少设置加载期间书库状态的短暂变化。
- 深色阅读主题与当前书籍正文同步，界面文案与对比度也在中英文界面中得到调整。

#### 修复

- 阅读器启动或章节加载期间点击目录时，用户选择优先于已保存的进度并立即高亮；跳转失败时保留所选目录项以便重试。
- 双章节跨页显示时，以靠后的可见章节作为当前章节；切换到非连续滚动后不再残留相邻章节。
- 阅读器各侧栏面板在切换、重新挂载和刷新后保留各自的滚动位置；笔记按章节分组前会等待目录就绪。
- 应用阅读主题时保留 EPUB 原有背景图，生成的 TXT 章节可显示所选主题背景。
- 批量上传包含成功、重复和失败结果时，中英文提示都能准确描述各部分结果。

### [0.3.3] - 2026-09-23

#### 主要更新

- 管理员可在「关于」中检查并安装新版本；更新流程会自动创建快照、在重启后执行健康检查，失败时回滚到上一版本。
- 书架与标签侧栏支持多种排序和置顶，书库视图默认值也可以按用户保存。
- 访客访问由服务端强制为只读，阅读主题和过期会话恢复可以实时同步并稳定恢复。

#### 新增

- 应用内更新：支持读取发布元数据、校验校验和、创建数据库快照、由启动器执行健康检查，以及更新失败后的回滚。
- 书架/标签侧栏的五种排序：手动、名称、书籍数量、最近添加、最近更新，并支持按用户保存排序方向。
- 「关于」设置：显示运行时版本、发布链接、手动检查更新和可复制的诊断信息。
- 系统、浅色、深色三种阅读主题，并支持跟随操作系统主题实时变化。

#### 变更

- 书架与标签的成员变化时间由 SQLite 触发器维护；置顶项目在所有排序模式中优先显示，但不会改变成员变化时间。
- 书库排序与列表/网格视图默认值改为按用户保存；优先级为 URL 参数、服务端设置、旧版本地存储、内置默认值。
- 访客会话改为临时只读：阅读进度保存在浏览器本地，不可用操作会在界面隐藏并由服务端拒绝，访客不能下载完整 TXT 内容。
- 用户名输入会清理危险控制字符，唯一性检查按规范化后的大小写和全/半角形式处理；设置密码的接口最低要求 8 个字符，而登录仍只要求非空。
- 设置页统一使用共享卡片，阅读计时器控制移至统计页；发布工作流新增容器内更新/回滚验证。

#### 修复

- 过期会话恢复时会清理旧用户缓存并合并并发恢复请求，不再暴露受保护页面或产生重复跳转和错误提示。
- EPUB 分段读取会重试可恢复失败；缺失的书名/作者可从文件名补齐；访客和登录用户的阅读器/TTS 状态切换更加安全。

#### 升级说明

- 这是首个包含容器内更新器的版本。已有部署在使用应用内更新前，必须先正常执行一次 `docker compose pull`；请保留包含 `.jwt-secret` 的完整 `DATA_DIR` 备份。

### [0.3.2] - 2026-09-22

#### 主要更新

- 外部客户端现在可以使用按操作授权的访问令牌，并具备明确的权限、生命周期管理与安全的跨域分段读取能力。
- 阅读进度、目录边界、标注身份与字体回退在首次保存、重复章节标题、取消章节和特殊字符缺字场景下更加可靠。
- 认证状态切换与阅读器加载可以更干净地恢复，不再暴露受保护页面，也不会重复跳转或重复提示错误。

#### 新增

- 按操作授权的 `bd_` 访问令牌：哈希存储、过期、启用/禁用与删除、权限校验、令牌 CORS 和日志脱敏。
- 标注保存目录项的 `chapterHref`，并通过数据库迁移让重复章节标题在笔记、导出和 AI 想法中保持独立。
- 为系统字体、CDN 字体和上传字体补充 CJK 与符号字形回退。

#### 变更

- 令牌授权仅允许访问明确登记的操作；远程 EPUB 读取所需的 Range 响应头会被暴露，但不会增加带凭证的跨域访问面。
- 阅读进度缓存使用完整服务端响应，目录选择使用当前实际章节边界，标注分组与导出按稳定的章节 href 而不是显示标题处理。
- Web 认证重新校验期间隐藏受保护页面，抑制重复的 401 跳转，并让书籍操作提示明确指出受影响的书籍。

#### 修复

- 首次保存阅读进度后，即使原缓存是 `{ data: null }`，也不再丢失服务端已返回的完整进度记录。
- 当前实际目录会加载正确的章节边界；第一个实际章节仍不可取消，后续章节可以取消并正常提交。
- 重复章节标题不再合并标注，CJK 或符号缺字时也会回退到可用字体。

### [0.3.1] - 2026-09-20

#### 主要更新

- 优化阅读器启动与续读可靠性：EPUB 资源加载更并行、更充分利用缓存，慢网络状态不会黏住，失效的保存位置也能安全恢复。
- 阅读器标注、搜索跳转与媒体处理在重排、iframe 延迟布局、章节跳转和延迟媒体加载场景下更加稳定。
- 分享卡片会根据摘录长度自适应排版，分享编辑器改为单一的行内定制界面。

#### 新增

- 使用带版本命名空间的浏览器 IndexedDB 持久化 EPUB 原始章节文本，并按书籍限制 LRU 容量；同时补充有界的阅读器资源缓存。
- 阅读器初始化失败/缓慢加载、无效 CFI 的恢复提示，以及重试和从头开始控制；侧栏标签和阅读状态恢复也更加可靠。
- 延迟音视频的自适应占位、按媒体就绪状态显示的控件反馈，以及可重试的媒体错误状态。
- 当前搜索结果高亮、点替换后的精确跳转、稳定的章节追踪与更完善的替换管理界面。
- 为符合条件的 API 与静态响应启用 gzip/Brotli 压缩，同时保留 Range 与阅读器二进制资源语义。

#### 变更

- EPUB 加载会复用已知压缩包大小、限制 Range 入口读取、并行解析资源 URL，并将大型媒体移出初始正文渲染路径。
- 标注与书签定位保留元素边界 CFI，按数值阅读位置排序，并能跨 iframe/布局稳定阶段与标签页焦点切换保持有效。
- 分享卡片的字体、中文换行、页脚锚定、模板与定制控件全面调整；未分类书库视图仅在最后一本书因操作离开后才自动退出。
- 阅读器搜索范围映射识别块级边界与当前结果状态，不再把临时搜索高亮误当作标注。
- 测试与演示夹具不再依赖真实书名或私有样例元数据。

#### 修复

- CFI 边界落在元素容器上时，章节中部书签和标注不再错误折叠到章节开头。
- 跨段落搜索范围、延迟的覆盖层布局、重复媒体播放按钮、原生加载控件和媒体重试状态处理不再错乱。
- 保存的阅读位置在续读完成前不再被初始跳转到书首的进度写入覆盖。

### [0.3.0] - 2026-09-20

#### 主要更新

- 新增开源阅读（Legado）书源集成：书坞可将藏书作为书源接入开源阅读 APP，支持分类浏览与搜索、应用文本替换后的富文本章节、EPUB 插图与媒体同步音频/视频，并提供免登录的范围化访问凭证。
- 新增个人主页：阅读成就统计与「当前阅读」书架替代了设置中的账号区块；设置新增「集成」分区，并附后续集成路线图预览卡片。
- 补齐空间与命名治理：回收站容量上限（超限自动清理最早书籍）、实例级上传大小限制（仅管理员可设）、书名自动识别开关。
- 阅读器默认尊重书籍自身排版，EPUB 目录保留原生层级，阅读位置书签在版面变化后可稳定恢复。
- 批量操作提供逐项结果提示与失败项单独重试；全端统一使用共享弹窗与菜单组件，提示文案具体化。

#### 新增

- 开源阅读书源服务：书源清单、动态发现页（分组标题、排序选择器、书架与标签按钮，排序选择会保留）、搜索、书籍详情、含分卷识别的目录、章节正文、封面与书内媒体接口；设置「集成」分区含启用开关、访问方式（登录后使用/免登录访问）、包含插图与媒体开关、书源地址复制、一键导入与扫码导入、链接重新生成。
- 免登录访问凭证：每用户一条有效凭证（SHA-256 哈希用于鉴权，另存 AES-256-GCM 加密副本以便随时再次查看），以 `?key=` 参数编入生成的书源地址，可选 90 天 / 1 年 / 永久有效期；停用服务或切换访问方式时自动吊销。新增 `legado_access_keys` 表（迁移 0004）。
- 开源阅读内容以富文本（`<usehtml>`）呈现：EPUB 章节保留内联样式与段首缩进；书籍详情简介聚合内容简介与文件大小/原始文件名/添加与更新时间；搜索与发现列表携带分类、字数徽标与封面。
- 开启「包含插图与媒体」后，章节内嵌图片，媒体同步音频支持点按播放，视频调起开源阅读播放器；封面与媒体由带缓存、防路径穿越的资源路由提供。
- 个人主页：含头像、昵称与入驻天数的头部卡片，阅读成就统计卡，「当前阅读」续读书架，主页设置弹窗（模块展示与公开主页偏好，保存在本地）；头像/昵称/密码管理自设置迁入。
- 书名自动识别：上传与重置元数据时从文件名剥离噪声括号、作者后缀与站点尾巴，提取书名与作者；按用户启用，默认开启。
- 回收站容量上限（不限/1–5 GB）：超限时按删除时间从最早开始永久清理，在打开回收站与启动时检查。
- 仅管理员可设置的实例上传上限：设置界面提供 100 MB–5 GB 预设，服务端在 5 MiB–10 GiB 范围内校验，对上传与 TXT 追加强制生效；公开实例接口暴露实际上限值，未登录访客也能看到真实限制。
- 书库搜索扩展匹配格式、简介、丛书、主题、出版社、ISBN、标识符、来源、书架与标签名；新增按上传时间排序。
- 批量操作按动作分类提示结果，失败项可单独重试；书架移动部分失败会明确警告而不再看似成功。
- 设置「集成」分区以禁用态卡片预览规划中的连接能力（OPDS、KOReader 同步、WebDAV 与网盘）。
- 阅读位置书签改以规范化的 contentCfi 定位（自 anchorCfi 更名），在滚动/窗口缩放引发的重排后依然准确。

#### 变更

- 关闭「覆盖书籍排版」时，EPUB 保留自身行高、缩进、段距与对齐，不再注入覆盖样式；覆盖开关默认改为关闭。
- 连续滚动模式支持在章节边界吸附翻页（foliate-js 补丁 #44）；重新聚焦窗口的首次点击不再翻两页，且该防误触保护扩展覆盖更多浏览器聚焦场景。
- 上传面板与书籍详情重构为共享弹窗；添加阅读记录弹窗与分享卡片同样迁移到共享弹窗框架；重复上传会给出提醒而非静默成功。
- 所有危险操作确认统一迁移至增强版通用确认弹窗（背景虚化、焦点管理、情境警告）。
- 阅读器侧边菜单与取词栏统一到共享菜单组件行为；侧栏悬停展开区域不再与顶部工具条重叠。
- 全端提示文案具体化：删除/恢复/彻底删除、上传、批量与设置保存的提示都会点名受影响的书籍或具体失败原因；统计页改用加载骨架屏。
- 设置重组为「书库」与「上传」两组；顶部账号入口改为左键直接进入个人主页。
- 中文文案一致性梳理：应用名统一为「书坞」（含入驻天数与公开主页提示），统计与 WebDAV 卡片等硬编码文案接入本地化，元数据保存与阅读状态文案重述。
- 书签定位改用 CFI 范围相交判定；工具栏锁定解除后侧边栏恢复上次展开状态。
- EPUB 目录保留 NCX 与 EPUB3 原生嵌套层级，已入库旧书的章节层级在打开时惰性升级（升级不会改动书籍的更新时间）。
- AI 引用按 cfiRange 阅读顺序排列，多段引用的答案按书中先后呈现。

#### 修复

- 书库顶栏回收站容量提示此前渲染出残缺的警告原文与空数值，现改为简短上限标签加格式化容量。
- TXT 多卷合并不再因拼接偏移导致章节边界错位。
- 修复 TXT 规范化文本恢复时重复首章标题的问题；章节正文开头与章节标题重复的首行标题现会被去除。
- 单条损坏的正则替换规则不再导致 TXT 导出或开源阅读章节整体失败。
- 取词后高亮气泡不再残留或错位；书库侧栏「未分类」行在列表与网格两种形态下渲染正确。

### [0.2.4] - 2026-09-19

#### 主要更新

- 将原有正文变换模块重构为统一的文本替换功能，支持全局规则与书内点替换，贯通阅读器搜索、AI 可见正文与 TXT/EPUB 导出。
- 扩展阅读器媒体体验：支持拖拽进度条的媒体同步悬浮球、独立的图片查看器，以及延迟解压、贴合主题的内嵌视频。
- 全面完善回收站、上传与封面流程：保留期倒计时与回收站用户级总开关、更可靠的上传反馈，以及可持久化、可自选的占位封面配色。

#### 新增

- 媒体同步悬浮球，支持双色进度轨道、拖拽跳转、文本线索同步、SMIL 时间容错以及与 TTS 的互斥暂停；新增图片查看器与图片右键/长按菜单，支持缩放、拖移、保存和复制。
- 回收站用户级总开关：关闭时永久删除现有回收站内容，后续删除绕过回收站；回收站同时新增删除天数与清理倒计时、总大小与清空可释放空间、按删除时间服务端排序，以及列表视图对齐。
- 上传支持单条重试、中途关闭后可继续、按服务端错误码本地化的行内错误，并展示只读的实例上传大小上限（`uploadMaxBytes`）用于客户端预检。
- 占位封面配色可在编辑弹窗的封面浮层中钉选；默认配色改为按不可变的书籍 id 哈希，改名不再变色；书库列表接口以轻量字段透出钉选值。
- 书籍详情展示可复制的原始上传文件名，书库列表响应附带全部匹配书籍的总大小。

#### 变更

- 正文变换升级为文本替换：规则支持全局/按书作用域、模式与点位匹配类型、按书启用覆盖、带隔离执行的正则校验、管理对话框，以及保留旧变换数据的迁移。
- 内嵌媒体改为正文呈现后再解压，视频获得贴合主题的卡片式外框与点击播放，并规范化旧式封面浮动与 0em 表格样式，避免多栏分页溢出或塌陷。
- 重复上传会将所选标签合并进已有书籍但不再静默移动书架，并明确提示"已存在"结果。
- 提升切书场景下阅读器生命周期稳定性（加载、导航、缓存内容、目录状态、书签锚点）；已开始阅读但无进度的书籍显示明确的 0% 进度条。
- 回收站开关关闭时，删除确认与提示文案切换为永久删除语义。

#### 修复

- 修复书架和标签侧边栏计数包含已回收书籍的问题。
- 修复上传面板在拖放松开后意外关闭（Chrome 多余的 `dragleave`）、重新打开时残留已完成条目，以及拖入时高亮对比过强闪烁的问题。
- 修复跳转至以高图开头的章节时目录与页眉标题不同步的问题（可视范围计算纳入跨越视口的替换元素）。

### [0.2.3] - 2026-09-16

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
