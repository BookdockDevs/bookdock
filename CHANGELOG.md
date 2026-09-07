# Changelog

All notable changes to Bookdock are documented here.

## [0.2.0] - Unreleased

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

### [0.2.0] - 待发布

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
