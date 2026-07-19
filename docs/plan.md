# bookdock 开发计划

> 最后更新：2026-07-19 · 本文件只跟踪未完成工作，已完成项不再列出

---

## 技术选型（确立）

| 层 | 选型 | 备注 |
|---|---|---|
| 前端 | React 19 + Vite + TypeScript + Tailwind CSS 4 + shadcn/ui | CSR |
| 路由 | TanStack Router | searchParam schema 化 |
| 状态 | TanStack Query（服务端态）+ Zustand（客户端态） | |
| 后端 | Hono + TypeScript | |
| 数据库 | SQLite + Drizzle ORM | 多用户预埋 |
| 存储 | LocalFsDriver（接口先行，预留 S3/WebDAV） | |
| 鉴权 | JWT（jose）/ 可选单实例无密码模式 | AUTH_MODE=off |
| 包管理 | pnpm monorepo | |
| 测试 | Vitest（server unit + web component） | |
| 部署 | Docker multi-stage 单容器 | |

---

## 状态与优先级定义

| 标记 | 含义 |
|------|------|
| 🟢 Done | 已完成并合并 |
| 🟡 In Progress | 开发中 / Review 中 |
| 🔴 Not Started | 未开始 |
| ◐ Partial | 部分完成 |
| ● Blocked | 有外部依赖阻塞 |

| Phase | 定位 | 时间线 |
|-------|------|--------|
| P0 | 当前冲刺 — 立刻开干 | 1-2 周 |
| P1 | 近期待实现 — 核心体验缺口 | 2-4 周 |
| P2 | 中期规划 — 重要扩展 | 1-2 月 |
| P3 | 远期储备 — 排期不定 | 待定 |

---

## P0 — 当前冲刺

### Epic: 阅读状态区分

| 元数据 | 值 |
|--------|----|
| **优先级** | P0 |
| **状态** | 🔴 Not Started |
| **估算** | 2d |
| **依赖** | 无 |

**Scope**
- Book / BookListItem 类型增加 `readStatus: 'unread' \| 'reading' \| 'finished'`
- schema + migration 增加 readStatus 列，默认 'unread'
- BookCard 显示状态徽标 + 进度百分比
- 书库按状态筛选（Tab / Dropdown）

**Task**

| # | Task | Effort | Deps |
|---|------|:------:|:----:|
| 1 | shared: Book 类型加 readStatus | 0.5d | — |
| 2 | server: schema + migration | 0.5d | #1 |
| 3 | server: listBooks 支持 status 筛选参数 | 0.5d | #2 |
| 4 | web: BookCard 状态徽标 + 进度条 | 1d | #1 |
| 5 | web: 书库状态筛选 UI | 0.5d | #3 |

**DoD**
- [ ] tsc 无错误
- [ ] OxLint 通过
- [ ] server listBooks 单元测试覆盖 status 筛选
- [ ] migration 向下兼容（已有行默认 'unread'）

---

### Epic: 书籍下载前端按钮

| 元数据 | 值 |
|--------|----|
| **优先级** | P0 |
| **状态** | ◐ Partial |
| **估算** | 0.5d |
| **依赖** | 无 |

**备注**：服务端下载 API（`GET /:id/file`、`GET /:id/epub`）已就绪，只缺前端入口。

**Scope**
- BookCard / 书籍菜单增加「下载」按钮
- 点击下载原文件（EPUB/TXT）

**Task**

| # | Task | Effort |
|---|------|:------:|
| 1 | web: BookCard 添加下载按钮，调用 `a[download]` 或 API | 0.5d |

---

### Epic: 排序增强补全

| 元数据 | 值 |
|--------|----|
| **优先级** | P0 |
| **状态** | ◐ Partial |
| **估算** | 1d |
| **依赖** | 阅读状态 Epic |

**备注**：已有按 createdAt / title / author / size 排序，补剩余。

**Scope**
- 按阅读进度（percent）排序
- 按最近阅读（progress.updatedAt）排序
- server listBooks 支持对应 sort 参数
- LibraryHeader 下拉增加选项

**Task**

| # | Task | Effort |
|---|------|:------:|
| 1 | server: listBooks join progress 排序 support | 0.5d |
| 2 | web: LibraryHeader 增加排序选项 | 0.5d |

---

### Epic: 阅读页错误兜底 Fallback UI

| 元数据 | 值 |
|--------|----|
| **优先级** | P0 |
| **状态** | 🔴 Not Started |
| **估算** | 1.5d |
| **依赖** | 无 |

**Scope**
- Reader 组件增加 ErrorBoundary
- FoliateReader mount 失败时显示友好 fallback（书籍格式不支持 / 文件损坏）
- 给出操作入口：返回书库 / 重新上传

**Task**

| # | Task | Effort |
|---|------|:------:|
| 1 | web: Reader ErrorBoundary 组件 | 0.5d |
| 2 | web: FoliateReader mount 错误捕获 + fallback UI | 1d |
| 3 | web: 格式不支持时引导文案 | 0.5d |

---

## P1 — 近期待实现

### 📖 阅读体验

| 功能 | 估算 | 状态 | 备注 |
|------|:----:|:----:|------|
| 正则过滤规则（按正则隐藏/替换书中内容） | 2d | 🔴 | 设置面板加规则列表 |
| 阅读设置预设方案（一键套用命名配置） | 2d | 🔴 | 保存/加载入口 + 本地存储 |
| 阅读页性能优化（大章节虚拟滚动、减少重排） | 3d | 🔴 | |
| 标注点击定位闪烁反馈（页内跳转后高亮目标） | 1d | 🔴 | |
| 搜索结果高亮主题色 + 定位反馈 | 1d | 🔴 | 当前青色描边（引擎默认） |
| 翻页模式连续滚轮节流优化 | 1d | 🔴 | 40px/200ms 阈值 + 翻页队列体验 |
| 页眉页脚滚动模式交互对齐 | 0.5d | 🔴 | 考虑"仅翻页模式显示" |

### 🗂️ 书库管理

| Epic / 功能 | 估算 | 状态 | 备注 |
|-------------|:----:|:----:|------|
| 书籍详情页 | 3d | 🔴 | 元数据 + 进度 + 书架/标签 + 操作入口 |
| 批量操作（多选后加入书架/标签/删除/下载） | 3d | 🔴 | |
| 作者/系列视图（按作者、系列聚合书籍） | 3d | 🔴 | 系列需新表 |
| 书架分组（参考微信读书"所属分组"） | 2d | 🔴 | |

### 🔍 搜索

| 功能 | 估算 | 状态 | 备注 |
|------|:----:|:----:|------|
| FTS5 全文搜索（书名 + 作者 + 正文） | 3d | 🔴 | |
| 搜索历史与建议 | 1d | 🔴 | |

### ⚙️ 运维

| 功能 | 估算 | 状态 | 备注 |
|------|:----:|:----:|------|
| 数据卷备份与恢复文档 | 0.5d | 🔴 | docker-compose data/ 挂载点 |

### 🏗️ 架构与重构

| 功能 | 估算 | 状态 | 备注 |
|------|:----:|:----:|------|
| FoliateReader.ts 拆分（selection / annotations / styles） | 2d | 🔴 | 714 行 |
| vendored foliate-js 本地修改点清单化 | 1d | 🔴 | 追踪上游更新 |
| paginator `#handleClick` 重复监听修复（foliate 上游） | 1d | 🔴 | 去重 |
| 简繁转换重锚（按 fraction 重锚 / 惰性分段转换） | 2d | 🔴 | 目前重写全部文本节点丢锚点 |

---

## P2 — 中期规划

### 📖 阅读体验

| 功能 | 备注 |
|------|------|
| 阅读统计（每日阅读时长、累计字数、热力图） | 需新表 reading_stats |
| 边看边改（TXT 本地标注/修改，不污染原文件） | |
| 排版方向竖排（纵書き） | |
| 书签排序 + 页内页角标记可视化 | |
| SelectionToolbar / AnnotationPopup 定位打磨 | 边界避让、动画、移动端适配 |
| 想法流程：点击"想法"后原位展开编辑气泡 | 目前跳到 AnnotationPopup |
| 笔记编辑体验（textarea 自动增高、Ctrl+Enter 保存） | |
| 笔记与划线视觉区分（笔记标记图标） | |

### 🗂️ 书库管理

| 功能 | 备注 |
|------|------|
| 书籍元数据管理（封面/作者/简介编辑 + 在线元数据抓取） | 豆瓣/Amazon/Google Books 刮削 |
| 批量编辑书名/作者/封面 | |
| 无封面占位图生成 | |

### 📄 格式引擎

| 功能 | 备注 |
|------|------|
| PDF 重排版支持 | |
| TXT → EPUB 自动生成目录 | |
| 更智能的 TXT 分章（多格式章节标题自动纠偏） | |

### 🖥️ 多端部署

| 功能 | 备注 |
|------|------|
| PWA 移动端适配优化 | |
| CLI 工具（批量导入、管理书架、导出备份） | |

### 🔌 集成与开放

| 功能 | 备注 |
|------|------|
| 导出/导入 JSON 备份（books + metadata + 进度） | |

### 🏗️ 架构与重构

| 功能 | 备注 |
|------|------|
| reader-state（zustand）与 ui.store 职责梳理 | 阅读内瞬时状态 vs 持久化偏好 |

---

## P3 — 远期储备

### 📄 格式引擎

- MOBI/AZW3 → EPUB 转换后阅读
- CBZ/CBR 漫画阅读

### 📖 阅读体验

- TTS 朗读（已知坑：连卷模式 `getContents()[0]` 取错章节）
- 划词翻译与内置字典

### 🖥️ 多端部署

- Tauri 桌面客户端（触发 `@bookdock/db`、`@bookdock/storage` 模块抽取）
- 浏览器扩展（网页一键推送）

### 👥 多用户 & 社交

- 多用户 + 权限细化（schema 已预埋）
- 共享书架 / 标签
- 书籍评论与评分

### 💾 存储与驱动

- S3/MinIO 存储驱动
- WebDAV / OneDrive / Drive 直连 / Alist

### 🔌 集成与开放

- OPDS 协议支持
- Calibre Web API 兼容
- Readwise / Notion 导出
- Webhook 事件推送
- 开放 API 文档（Scalar）
- RSS 新书上架订阅

### 🤖 AI 与高级功能

- AI 摘要 / 翻译 / 角色 / 剧情分析
- 阅读笔记知识图谱

### ⚙️ 运维

- 自动备份到对象存储（S3/MinIO）
- Calibre 库导入 / 同步
- 健康检查自恢复
- Helm Chart / K8s 模板
- 反代模板（Nginx / Caddy）
- 完整 i18n 多语言（目前仅中文）
- 性能监控与日志增强

---

## 附录

### 工时估算规则

| 单位 | 含义 |
|:----:|------|
| 0.5d | 半日（约 4h） |
| 1d | 整日（约 8h） |
| 2d+ | 建议拆分子任务 |

### 版本记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-07-19 | 重构 plan：P0-P3 三层优先级 + 12 类别，移除已完成项 | |
