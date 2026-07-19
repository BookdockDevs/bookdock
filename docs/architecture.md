# bookdock 架构方案

> 最后更新：2026-07-19 · 本文是权威架构蓝图，代码实现以本文为准。架构决策变更时先改本文再改代码。

---

## 设计原则

1. **KISS / 第一性原理**：内联优先，重复 ≥3 次或单段 >50 行才抽函数；不过度抽象。
2. **演进优于预测**：只对「重构成本高且必定需要」的点提前留接口（存储驱动、格式解析、API 版本、多用户 schema），其余 YAGNI。
3. **契约先行**：前后端共享同一份类型 + 校验 schema（`@bookdock/shared`），消除漂移。
4. **可抽取的内聚模块**：服务端按域模块组织，关键能力以接口暴露（StorageDriver、FormatRegistry），第二消费者（CLI/Tauri）出现时再抽包。
5. **自托管优先、隐私优先**：数据落盘可备份；默认单进程单二进制容器；敏感配置走环境变量。

---

## 1. Monorepo 总览

pnpm workspace，3 个包：

| 包 | 角色 | 主要技术 |
|---|---|---|
| `@bookdock/shared` | 纯类型 + zod 校验 + API 契约 + 错误码 + 常量，**零运行时依赖（除 zod）** | TypeScript 5 |
| `@bookdock/server` | API 服务、数据访问、存储、格式解析 | Hono 4 / Drizzle / better-sqlite3 / jose / nanoid |
| `@bookdock/web` | 浏览器入口（SPA） | React 19 / Vite 8 / Tailwind 4 / TanStack Router / TanStack Query / Zustand |

**包拆分策略**：暂不预拆 `@bookdock/db`、`@bookdock/storage`。服务端以**内聚模块 + 接口**的组织方式，保证未来抽取是「移动文件 + 改 import」而非重构。抽取触发条件：出现第二个消费者（CLI / Tauri / Flutter）且确实需要复用该能力。

---

## 2. `@bookdock/shared` 契约设计

shared 是前后端唯一真相源。按职责拆文件，barrel 导出。

```
packages/shared/src/
  index.ts         # 仅 re-export，不含逻辑
  constants.ts     # BookFormat 枚举、排序字段、分页上限、错误码字符串常量
  domain.ts        # 领域模型接口：Book / Shelf / Tag / ReadingProgress / User / Annotation / Settings
  contract.ts      # 每个端点的 Request/Response 形状（DTO），命名 {Action}{Resource}{Req|Res}
  schema.ts        # zod schema（与 domain 对齐），前后端共用校验
  errors.ts        # ErrorCode 联合类型 + ApiErrorBody + 错误到 HTTP 状态映射
```

约定：
- **domain.ts** = 数据库行形态（snake → camel 由 Drizzle 映射后得到）；**contract.ts** = 线上报文形态，二者解耦，允许未来字段隐藏/重命名。
- 错误码用字符串常量（`'BOOK_NOT_FOUND'` 等），HTTP 状态集中在 `errors.ts` 映射，禁止散落在各路由。
- API 路径前缀统一 `/api/v1`（见 §5）。

**当前 domain 模型**：
- `User(id, username, passwordHash?, role, createdAt)`
- `Book(id, userId, title, author, format, filePath, coverKey?, size, meta, createdAt, updatedAt, deletedAt?)`
- `Shelf(id, userId, name, sortOrder, createdAt)`
- `Tag(id, userId, name)`
- `ReadingProgress(id, userId, bookId, cfi?, chapter?, percent, updatedAt)`
- `Settings(id, userId, key, value)`
- `Annotation(id, userId, bookId, cfiRange, cfiAnchor?, type, color, style, text, note?, chapter?, createdAt, updatedAt)`

---

## 3. `@bookdock/server` 模块化结构

按**领域模块**组织，每模块自包含 routes/service；跨模块基础设施放 `lib` 与 `middleware`。

```
apps/server/src/
  index.ts                 # 仅启动：读 config → 建 db → 挂 storage → 装 app → serve
  app.ts                   # 组装 Hono 实例：全局中间件 + 注册格式解析器 + 挂载路由
  config.ts                # 唯一配置来源：env → zod 校验 → Object.freeze
  env.ts                   # process.env 读取与 zod 校验
  db/
    schema.ts              # 全部 Drizzle 表定义（见 §4）
    client.ts              # better-sqlite3 + drizzle 工厂单例，含 runMigrations
    migrations/            # drizzle-kit 生成的迁移（入 Git）
  storage/
    driver.ts              # StorageDriver 接口（见 §3.2）
    localfs.ts             # LocalFsDriver 实现
    index.ts               # 按 config 选择 driver 单例
  formats/
    registry.ts            # FormatRegistry：按扩展名/MIME 注册解析器
    epub.ts                # EpubParser（OPF/NCX/nav 解析 + spine 排序）
    txt.ts                 # TxtParser（编码探测 + 分章启发式）
  modules/
    auth/                  # auth.routes + auth.service + lib/password + JWT(jose)
    books/                 # books.routes + books.service（编排 storage + formats + db）
    shelves/               # shelves.routes + shelves.service
    tags/                  # tags.routes + tags.service
    progress/              # progress.routes + progress.service
    settings/              # settings.routes + settings.service
    annotations/           # annotations.routes + annotations.service
  middleware/
    error.ts               # AppError 类 + errorHandler（ErrorCode → HTTP 状态）
    auth.guard.ts          # 解析 JWT 注入 c.var.user；AUTH_MODE=off 放行注入默认用户
  lib/
    id.ts                  # nanoid(21) 封装，支持前缀（book_ / user_ / shelf_ / ...）
    password.ts            # scrypt: hashPassword + verifyPassword
    txt-to-epub.ts         # 内存中生成 EPUB ZIP（meta XHTML + NCX + OPF + CSS）
  scripts/
    rebuild-txt-chapters.ts # 批量重分析已入库 TXT 的分章结果
```

### 3.1 模块约定
- **routes**：薄层。只做 参数解析 → 调用 service → 套 error 处理。不写业务判断。
- **service**：业务编排，返回领域对象或抛 `AppError(code)`。依赖通过函数参数注入（db、storage），便于测试与抽取。
- 模块之间**不直接 import 对方 service**；跨模块编排通过共享的 db/storage 实例完成。
- 测试文件同模块目录放置（`shelves.test.ts`、`tags.test.ts`）或集中在 `__tests__/`（books）。

### 3.2 StorageDriver 接口

```ts
export interface StorageDriver {
  put(key: string, data: Buffer | Readable): Promise<void>
  get(key: string): Promise<Readable>
  getRange?(key: string, start: number, end?: number): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  size(key: string): Promise<number>
  getUrl?(key: string): Promise<string>  // 直链/签名 URL（S3 场景）
}
```

key 形如 `books/{bookId}/{filename}`、`covers/{id}.{ext}`。当前实现 `LocalFsDriver`（基于 `DATA_DIR/files/`）；S3/WebDAV 实现同接口即可热插，service 不感知。

### 3.3 FormatRegistry

```ts
export interface ParsedBook {
  meta: { title: string; author?: string; cover?: Buffer }
  chapters: { title: string; content: string }[]
}
export interface FormatParser {
  match(fileName: string, mime: string): boolean
  parse(data: Buffer | Readable): Promise<ParsedBook>
}
```

注册表按入参分派。`app.ts` 启动时注册 `EpubParser` + `TxtParser`。新增 PDF/MOBI/CBZ 仅加 Parser + 注册，service 不改。

---

## 4. 数据库 schema（多用户预埋）

SQLite + Drizzle ORM。所有业务表带 `userId` 外键，单用户实例初始化一行「默认用户」。未来加多用户/权限/共享只需加新表与策略，不动既有列。

**当前 9 表**：

| 表 | 关键列 | 备注 |
|---|---|---|
| `users` | id(text PK), username(unique), passwordHash?, role, createdAt | role: owner\|member\|guest |
| `books` | id, userId FK, title, author, format(epub\|txt), filePath, coverKey?, size, meta(json), createdAt, updatedAt, **deletedAt** | deletedAt 用于回收站软删除 |
| `shelves` | id, userId FK, name, sortOrder, createdAt | |
| `book_shelves` | bookId FK(cascade), shelfId FK(cascade) | 复合主键 M2M |
| `tags` | id, userId FK, name | |
| `book_tags` | bookId FK(cascade), tagId FK(cascade) | 复合主键 M2M |
| `reading_progress` | id, userId FK, bookId FK, cfi?, chapter?, percent, updatedAt | 唯一索引(userId, bookId) |
| `settings` | id, userId FK, key, value(json) | 用户级 KV |
| `annotations` | id, userId FK, bookId FK, cfiRange, cfiAnchor?, type, color, style, text, note?, chapter?, createdAt, updatedAt | 唯一索引(userId, bookId, cfiRange) |

`meta` 用 JSON 列承载「不确定会扩展」的字段（出版社/ISBN/语言/简介），避免频繁加列；稳定且高频查询字段才提成列。

### Drizzle 约定
- 所有 id 用 nanoid 字符串主键（`lib/id.ts` 统一），避免自增暴露数量、便于多端生成。
- 时间戳统一 INTEGER unix ms（排序/区间查询友好）。
- 仓库单点 `db/client.ts`（WAL + foreign_keys ON）；迁移由 `drizzle-kit` 管理，迁移文件入 Git。

---

## 5. API 设计

- **版本前缀**：所有路由 `/api/v1/...`。新增不兼容改动走 `/v2`，旧版保留至废弃。
- **鉴权**：默认 JWT（jose）。`AUTH_MODE=off` 则中间件放行，注入默认用户。公开路径：`/api/v1/auth/login`、`/api/v1/auth/setup`、`/api/v1/auth/setup-required`。
- **统一响应**：成功 `{ data: T }`；失败 `{ error: { code, message, details? } }`（见 §2 errors.ts）。
- **分页**：列表类用 `{ data, page, pageSize, total }`；查询参数经 zod 校验。
- **导出/集成**：OPDS、Calibre Web API、开放 API(v2+) 均作为额外路由模块挂载，复用 service 层，不污染 v1 资源路由。

### 路由总览

| Prefix | Module | 主要端点 |
|--------|--------|---------|
| `/api/v1/health` | — | `GET /` |
| `/api/v1/auth` | auth | `POST /login` `POST /setup` `GET /setup-required` `GET /me` |
| `/api/v1/books` | books | `GET /` `POST /` `GET /:id` `DELETE /:id` `POST /:id/restore` `DELETE /:id/permanent` `DELETE /trash` `GET /:id/file` `GET /:id/epub` `GET /:id/cover` `PUT /:id/membership` |
| `/api/v1/progress` | progress | `GET /:bookId` `PUT /:bookId` |
| `/api/v1/settings` | settings | `GET /` `PUT /` |
| `/api/v1/annotations` | annotations | `GET /?bookId=` `POST /` `PUT /:id` `DELETE /:id` |
| `/api/v1/shelves` | shelves | `GET /` `POST /` `PUT /:id` `DELETE /:id` |
| `/api/v1/tags` | tags | `GET /` `POST /` `PUT /:id` `DELETE /:id` |

---

## 6. `@bookdock/web` 结构

```
apps/web/src/
  main.tsx                 # 入口：挂载 AppProviders + RouterProvider
  router.ts                # TanStack Router 配置（routeTree）
  index.css                # Tailwind 入口
  routes/
    __root.tsx             # 根路由：全局错误边界 + 认证守卫
    RootComponent.tsx      # AppShell 布局（侧栏 + 顶栏 + Outlet）+ 初始化逻辑
    index.tsx              # GET / → Library（书库首页）
    login.tsx              # GET /login → Login
    setup.tsx              # GET /setup → Setup（首次引导）
    books.$id.tsx          # GET /books/$id → Reader（懒加载）
    settings.tsx           # GET /settings → Settings
  api/
    client.ts              # fetch 封装：baseURL=/api/v1、注入 Authorization、错误归一化
  features/
    auth/
      Login.tsx            # 登录页
      Setup.tsx            # 首次设置页
    library/
      Library.tsx           # 书库主页：列表/网格切换、侧栏筛选、上传
      hooks.ts             # TanStack Query hooks：useBooks / useUploadBook / 等
      state/library-state.ts # Zustand：筛选、视图模式、搜索词等瞬时 UI 状态
      components/
        BookCard.tsx        # 书籍卡片（封面/标题/作者/大小/操作菜单）
        BookCover.tsx       # 封面图片组件（含 fallback）
        BookMembershipDialog.tsx  # 归类弹窗（多选书架+标签）
        DeleteConfirm.tsx   # 删除确认弹窗
        EmptyLibrary.tsx    # 空书库占位
        LibraryHeader.tsx   # 顶栏：搜索、排序、上传按钮
        LibrarySidebar.tsx  # 侧栏：全部/书架/标签/回收站
        ShelfDialog.tsx     # 新建/重命名书架弹窗
        UploadSheet.tsx     # 上传抽屉（拖拽 + 文件选择 + 进度）
    reader/
      Reader.tsx            # 阅读器主组件：加载书籍 → 挂载渲染引擎 → 协调 UI
      types.ts              # 阅读器类型定义（ReadingMode、ReaderTheme 等）
      state/reader-state.ts # Zustand：阅读中瞬时状态（当前章节、目录展开、搜索词）
      renderers/
        FoliateReader.ts    # foliate-js 渲染引擎适配层（714 行，待拆分）
      hooks/
        useReaderRenderer.ts # 渲染引擎生命周期管理
        useAnnotations.ts    # 标注 CRUD hook
        useBookChapters.ts   # 章节列表
        useReaderApi.ts      # 基础 API 调用
      components/
        NavigationPanel.tsx  # 侧滑面板：目录 / 书签 / 搜索 / 笔记 四 tab
        ProgressStrip.tsx    # 底部进度条（章节/百分比/页码）
        ReaderHeader.tsx     # 顶部导航栏（返回/书名/工具栏按钮）
        SettingsPanel.tsx    # 阅读设置面板（字体/布局/显示/主题四栏）
        SettingsPopover.tsx  # 快速设置浮层
        ToolDock.tsx         # 左侧边缘工具栏
        SelectionToolbar.tsx # 划词弹出工具栏（高亮/划线/笔记）
        AnnotationPopup.tsx  # 标注编辑弹窗
        annotation-colors.ts # 标注颜色配置
        annotation-icons.tsx # 标注图标组件
    settings/
      Settings.tsx           # 全局设置页（账号/首选项）
  components/
    ui/                     # shadcn/ui 基元（代码所有权归项目，按需生成）
      Button.tsx
      Toast.tsx
    layout/
      AppShell.tsx           # 应用外壳：侧栏 + 顶栏 + 内容区
  stores/
    auth.store.ts            # Zustand + localStorage：token / user
    ui.store.ts              # Zustand + localStorage：主题 / 阅读偏好 / 自定义主题
    toast.store.ts           # Zustand：消息队列（自动 3s 消失）
  lib/
    utils.ts                 # cn() 等纯函数
    color.ts                 # 颜色工具（hex → RGB / 亮度计算）
    reading-theme.ts         # 阅读主题预设 + 自定义主题管理
    chinese.ts               # 简繁转换（opencc-js 封装）
  i18n/
    index.ts                 # t() + setDict()
    zh.ts                    # 中文词典（Dict 类型）
  providers/
    AppProviders.tsx          # Provider 组合（QueryClient / Theme / Router）
    SettingsSync.tsx          # 阅读设置双向同步（localStorage ↔ server settings API）
```

### 6.1 状态管理

| 状态类型 | 工具 | 存储位置 | 持久化 |
|----------|------|----------|--------|
| 服务端数据 | TanStack Query | Query cache | 缓存，非持久 |
| 认证信息 | Zustand | `auth.store.ts` | localStorage（token / user JSON） |
| UI 偏好 | Zustand | `ui.store.ts` | localStorage（主题 / 字体 / 布局等） |
| 阅读瞬态 | Zustand | `reader-state.ts` | 不持久 |
| 书库瞬态 | Zustand | `library-state.ts` | 不持久 |
| 消息通知 | Zustand | `toast.store.ts` | 不持久 |

### 6.2 阅读器架构

阅读器使用 **vendored foliate-js**（`public/foliate-js/`）作为渲染引擎，非 npm epubjs。`FoliateReader.ts` 为适配层，通过 dynamic import 加载 `reader-entry.js`，封装渲染/交互/标注生命周期。

```
public/foliate-js/
  reader-entry.js    # 入口（ FoliateReader.ts 动态加载）
  view.js            # 阅读视图管理
  epub.js            # EPUB 解析与渲染
  paginator.js       # 分页引擎（支持滚动/递进/连卷）
  search.js          # 章节内搜索
  tts.js             # TTS 朗读
  overlayer.js       # 标注叠加层
  epubcfi.js         # CFI 定位
  progress.js        # 进度跟踪
  footnotes.js       # 脚注处理
  text-walker.js     # DOM 文本遍历
  translator.js      # 翻译服务
  dict.js            # 内置字典
  fixed-layout.js    # 固定布局支持
  vendor/            # 第三方依赖（fflate, zip）
```

### 6.3 国际化

当前硬编码中文，但结构已支持切换（`i18n/index.ts` 的 `setDict()` + `t()`）。多语言计划：

1. 提取 `zh.ts` 中的 key 为独立 JSON
2. 新增 `en.ts` / 等
3. 由前端根据 `navigator.language` 或用户设置切换

---

## 7. 配置与环境

服务端单一 `config.ts`，zod 校验后 `Object.freeze`：

| 变量 | 默认 | 说明 |
|---|---|---|
| `PORT` | 3000 | 监听端口 |
| `DATA_DIR` | `./data` | 库与封面落盘根 |
| `DB_PATH` | `${DATA_DIR}/bookdock.db` | SQLite 路径 |
| `AUTH_MODE` | `password` | `off` / `password` |
| `JWT_SECRET` | — | AUTH_MODE=password 必填；缺则启动报错 |
| `DEFAULT_USERNAME` | `admin` | 单用户默认名 |
| `UPLOAD_MAX_BYTES` | `104857600` | 上传上限（100MB） |
| `STORAGE_DRIVER` | `localfs` | 预留；当前仅 localfs |

production 要求只暴露端口 + 挂载 `DATA_DIR` 卷；备份 = 打包 `DATA_DIR`。

---

## 8. 测试、Lint、类型

| 维度 | 方案 | 命令 |
|------|------|------|
| **测试** | Vitest（server unit + web component） | `pnpm test` |
| **Lint** | OxLint（根 `oxlintrc.json`） | `pnpm lint` |
| **类型** | tsc --noEmit（每包独立 tsconfig） | `pnpm typecheck` |
| **CI** | GitHub Actions（.github/workflows/ci.yml） | lint → typecheck → test |

- Server 测试：service 层单元测试（mock db/storage），routes 层集成测试（hono/testing）
- Web 测试：组件渲染测试（@testing-library/react），hook 测试（renderHook）
- 测试数据从 `@bookdock/shared` 领域类型构造，不重复定义

---

## 9. 部署与运维

- **Docker**：multi-stage。stage1 安装依赖 + 构建全部包；stage2 仅 `pnpm deploy` 产出 + prod 依赖。单容器、单端口。
- **docker-compose.yml**：挂 `./data:/data`，环境变量见 §7，首启日志打印默认密码。
- **健康检查**：`GET /api/v1/health` → `{ data: { ok: true } }`。
- **反向代理**：docs 提供 Nginx/Caddy 片段（非强制）。

---

## 10. 架构决策记录（ADR）

| 编号 | 决策 | 要点 |
|---|---|---|
| ADR-01 | TanStack Router 替换 react-router-dom | 类型安全 searchParams |
| ADR-02 | 暂不拆 @bookdock/db / @bookdock/storage | 内聚模块+接口替代预拆 |
| ADR-03 | DB schema 多用户预埋 | users 表 + userId 外键 |
| ADR-04 | StorageDriver / FormatRegistry 接口先行 | 热插存储与格式 |
| ADR-05 | API 统一 /api/v1 前缀 | 版本演进余地 |
| ADR-06 | nanoid 字符串主键 | 多端生成友好、不泄露数量 |
| ADR-07 | shadcn/ui 代码所有权 + 按需生成 | 不预装全量、可深度定制 |
| ADR-08 | JSON 列承载不确定字段 + 稳定字段提列 | 平衡扩展性与查询性能 |
| ADR-09 | foliate-js 代替 epubjs 作为阅读引擎 | vendored 到 public/，非 npm 依赖；更灵活的定制能力 |
| ADR-10 | annotations 表 + 完整 CRUD API | 在 P0 而非"后期"实现，保存即 cloud-sync-ready |
