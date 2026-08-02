# Bookdock Architecture

> Last updated: 2026-08-02 · This document is the authoritative architecture blueprint; the code follows it. When an architectural decision changes, update this document first, then change the code.

---

## Design Principles

1. **KISS / first principles**: inline first; only extract into functions when logic repeats ≥3 times or a single block exceeds 50 lines. Avoid over-abstraction.
2. **Evolution over prediction**: reserve interfaces only where "expensive to refactor and definitely needed" (storage driver, error-class, album-of-mapping parsing, API versioning, multi-user schema); everything else is YAGNI.
3. **Contract first**: frontend and backend share a single source of truth for types + validation (`@bookdock/shared`) to eliminate drift.
4. **Cohesive extractable modules**: the server is organized by domain modules, key capabilities exposed via interfaces (StorageDriver, FormatRegistry); only extract packages (e.g. `@bookdock/db`, `@bookdock/storage`) when the same capability is genuinely needed elsewhere.
5. **Self-hosted first, privacy first**: data is byte backup-able; default single-process single-binary container; secrets from env.

---

## 1. Monorepo Overview

| package | role | primary stack |
|---|---|---|
| `@bookdock/shared` | pure types + zod validation + API contracts + error codes + constants, **zero runtime deps exc. zod** | TypeScript 5 |
| `@bookdock/server` | API service, data access, storage, format parsing | Hono 4 / Drizzle / better-sqlite3 / jose / nanoid |
| `@bookdock/web` | browser entry (SPA) | React 19 / Vite 8 / Tailwind 4 / TanStack Router / TanStack Query / Zustand |

**Package-splitting strategy**: do not pre-extract `@bookdock/db` / `@bookdock/storage`. The server is organized as cohesive modules + interfaces so future extraction is "move files + change imports" rather than a rewrite. Trigger for extraction: a second consumer (CLI / Tauri / Flutter) actually needs to reuse the capability.

---

## 2. `@bookdock/shared` Contract Design

`shared` is the single source of truth. Split by responsibility, barrel-exported.

```
packages/shared/src/
  index.ts         # re-exports only, no logic
  constants.ts     # BookFormat enum, sort fields, pagination caps, error-code string constants
  domain.ts        # domain model interfaces: Book / Shelf / Tag / ReadingProgress / User / Annotation / Settings
  contract.ts      # per-endpoint Request/Response shapes (DTOs), named {Action}{Resource}{Req|Res}
  schema.ts        # zod schemas (aligned with domain), shared validation
  errors.ts        # ErrorCode union + ApiErrorBody + error→HTTP status mapping
```

Conventions:
- **domain.ts** = database row shape (snake→camel resolved by Drizzle mapping). **contract.ts** = wire shape; the two are decoupled so fields can be hidden/renamed later.
- Error codes are string constants (`'BOOK_NOT_FOUND'`, etc.); HTTP status mapping is centralized in `errors.ts` and never scattered across routes.
- API paths are uniformly prefixed `/api/v1` (see §5).

**Current domain model**:
- `User(id, username, passwordHash?, role, disabled, createdAt, updatedAt?)`
- `Book(id, userId, title, author, format, filePath, coverKey?, size, meta, createdAt, updatedAt, deletedAt?)`
- `Shelf(id, userId, name, sortOrder, createdAt)`
- `ShelfBook(id, userId, shelfId, bookId, sortOrder?)` (M2M join via `book_shelves`)
- `Tag(id, userId, name)`
- `Settings(id, userId, key, value)`
- `InstanceSettings(key, value)` — instance-level KV, no userId (see ADR-12)
- `Annotation(id, userId, bookId, cfiRange, cfiAnchor?, type, color, style, text, note?, chapter?, createdAt, updatedAt)`
- `ReadingRecord(id, userId, bookId, date, durationSeconds)` — per-day per-book accumulated reading seconds; `date` is the client-local calendar day `YYYY-MM-DD` (sessions bucket to the start-day)

(The `ReadingProgress` table was dropped in migration 0011; progress fields moved into the `books.progress` column.)

---

## 3. `@bookdock/server` Module Structure

Organized by **domain module**, each module is thin routes + service; cross-module infrastructure lives in `lib()` and `middleware/`.

```
apps/server/src/
  index.ts                 # only bootstrap: read config → open db → attach storage → assemble app → serve
  app.ts                   # compose the Hono app: global middleware + format parser registration + mount routes
  config.ts                # single config source: env → zod validation → Object.freeze
  env.ts                   # process.env read + zod validation
  db/
    schema.ts              # all Drizzle table definitions (see §4)
    client.ts              # better-sqlite3 + drizzle factory singleton (incl. runMigrations)
    migrations/            # drizzle-kit generated migrations (committed)
  storage/
    driver.ts              # StorageDriver interface (see §3.2)
    localfs.ts             # LocalFsDriver implementation
    index.ts               # pick driver by config
  formats/
    registry.ts            # FormatRegistry: dispatcher by extension/MIME
    epub.ts                # EpubParser (OPF/NCX/nav parsing + spine order)
    txt.ts                 # TxtParser (encoding detect + chapter heuristics)
  modules/
    auth.routes.ts          # JWT (jose), instance settings, /setup, /login, /logout, /register, /password
    books.routes.ts         # books CRUD + upload + cover
    shelves.routes.ts       # shelves CRUD + m2m book membership
    tags.routes.ts          # tags CRUD + m2m book membership
    progress.routes.ts      # reading position
    settings.routes.ts      # user-level KV
    annotations.routes.ts   # highlight/note/comment CRUD
    reading-records.routes.ts # duration upsert + aggregation
  middleware/
    error.ts               # AppError + errorHandler (ErrorCode → HTTP status)
    auth.guard.ts          # cookie/header token → verify → DB fresh user (role/disabled) → inject c.var.user; or guest
  lib/
    id.ts                  # nanoid(21) wrapper, prefixable (book_, user_, ...)
    password.ts            # scrypt hashPassword + verifyPassword
    txt-to-epub.ts         # in-memory EPUB ZIP generation for TXT
```

### 3.1 Module conventions
- **routes**: thin. Parse params → call service → wrap errors. No business logic.
- **service**: orchestrate, return domain objects or throw `AppError(code)`. Dependencies injected via function args (db, storage) for testability & extraction.
- Modules do **not** import each other's service; cross-module orchestration goes through shared db/storage instances.
- Tests live beside modules (`shelves.test.ts`, `tags.test.ts`) or centralized under `__tests__/` (books).

### 3.2 StorageDriver interface

```ts
export interface StorageDriver {
  put(key: string, data: Buffer | Readable): Promise<void>
  get(key: string): Promise<Readable>
  getRange?(key: string, start: number, end?: number): Promise<Readable>
  delete(key: string): Promise<void>
  exists(key: string): Promise<boolean>
  size(key: string): Promise<number>
  getUrl?(key: string): Promise<string>   // direct/presigned URL (S3)
}
```

Keys like `books/{bookId}/{filename}`, `covers/{id}.{ext}`. Current impl: `LocalFsDriver` (`DATA_DIR/files/`). S3/WebDAV implement the same interface and hot-swap without service changes.

### 3.3 FormatRegistry

```ts
export interface ParsedBook {
  meta: { title: string; author?: string; cover?: Buffer; bookmeta?: BookMetadata }
  chapters: { title: string; content: string; wordCount?: number }[]
}
export interface FormatParser {
  match(fileName: string, mime: string): boolean
  parse(data: Buffer | Readable): Promise<ParsedBook>
}
```

Registered in `app.ts` (EpubParser + TxtParser). Adding PDF/MOBI/CBZ means only "new Parser + register", no service changes.

**Word counting** (`lib/word-count.ts`): one counter for all formats — each CJK char (incl. full-width punctuation, excluding ideographic spaces) counts 1, each run of latin letters/digits counts 1. EpubParser counts per chapter by reading the chapter XHTML from the zip and taking `textContent` via xmldom (never regex tag-stripping), deduplicated per file so TOC entries sharing one file count it once; TxtParser chapters are counted on the normalized text slices. Upload stores per-chapter `wordCount` in `meta.chapters` and the sum as `meta.wordCount`; books uploaded before this feature are lazily backfilled by the `GET /:id/chapters` service (re-parse from StorageDriver, same trigger pattern as `regenerateTxtBookContent`).

---

## 4. Database Schema (multi-user pre-wired)

SQLite + Drizzle. All business tables carry a `userId` FK. A single-user instance seeds one "default user" row. Future multi-user/permissions/sharing only adds tables + policy logic, never touching existing columns.

**Current tables** (9):

| Table | Key columns | Notes |
|---|---|---|
| `users` | id (text PK), username (unique), passwordHash?, role, disabled, createdAt, updatedAt? | role: owner\|member\|guest; disabled → deny |
| `books` | id, userId FK, title, author, format (epub\|txt), filePath, coverKey?, size, meta (json), createdAt, updatedAt, **deletedAt** | deletedAt soft-delete (回收站) |
| `shelves` | id, userId FK, name, sortOrder, createdAt | |
| `book_shelves` | bookId FK (cascade), shelfId FK (cascade) | composite PK, M2M |
| `tags` | id, userId FK, name | |
| `book_tags` | bookId FK (cascade), tagId FK (cascade) | composite PK, M2M |
| `settings` | id, userId FK, key, value (json) | unique (userId, key) |
| `instance_settings` | key (text PK), value | no userId (ADR-12) |
| `annotations` | id, userId FK, bookId FK, cfiRange, cfiAnchor?, type, color, style, text, note?, chapter?, createdAt, updatedAt, **deletedAt?** | unique (userId, bookId, cfiRange); soft delete |
| `reading_records` | id, userId FK, bookId FK (cascade), date (text), durationSeconds | unique (userId, bookId, date); upsert snapshot |
| `reading_sessions` | id, userId FK, bookId FK (cascade), date (text), startedAt, durationSeconds | per-session detail for hourly distribution |

`meta` is a JSON column for "may grow" metadata; frequently-queried stable fields are promoted to dedicated columns.

### Drizzle conventions
- All ids are nanoid strings (from `lib/id.ts`), never auto-increment ints → prevents count leaks, multi-client friendliness.
- Timestamps uniform INTEGER unix ms.
- Single `db/client.ts` (WAL + foreign_keys ON); migrations via drizzle-kit (committed).

---

## 5. API Design

- **Version prefix**: everything under `/api/v1/...`. Future breaking changes go to `/v2`.
- **Auth**: JWT (jose, HS256, 7d) delivered via HttpOnly Cookie `bd_token` (SameSite=Strict, Path=/); Bearer header also accepted (web client transition). CSRF: cookie is same-site only + API is JSON-only.
- **Guard**: verify → load **fresh user** from DB (30s short-TTL cache, invalidated on writes) → disabled → `ACCOUNT_DISABLED` (403); injected role is authoritative from DB. No token → inject default guest if `allowGuestAccess`, else 401.
- **Roles**: `owner` (instance admin), `member` (registered), `guest` (anonymous → default user). First boot must create owner via `/setup` (web guard redirects when `initialized=false`).
- **Instance settings**: `allowRegistration` / `allowGuestAccess` (default false), owner-edited via `PATCH /api/v1/auth/instance`, 5s module-level read cache. `AUTH_MODE` env removed.
- **Unified responses**: success `{ data: T }`; failure `{ error: { code, message } }` (see §2.1 in shared).

### Route overview

| Prefix | Module | Key endpoints |
|---|---|---|
| `/api/v1/health` | — | `GET /` |
| `/api/v1/auth` | auth | `GET /instance` `PATCH /instance`(owner) `POST /login` `POST /logout` `POST /setup` `GET /setup-required` `POST /register` `POST /password` `GET /me` |
| `/api/v1/users` | users | `GET /`(owner) `PATCH /:id`(owner) |
| `/api/v1/books` | books | `GET /` `POST /` `GET /:id` `DELETE /:id` `GET /:id/file` `GET /:id/cover` `PUT /:id/membership` `GET /:id/chapters` |
| `/api/v1/shelves` | shelves | `GET /` `POST /` `PUT /:id` `DELETE /:id` |
| `/api/v1/tags` | tags | `GET /` `POST /` `PUT /:id` `DELETE /:id` |
| `/api/v1/annotations` | annotations | `GET /`(?bookId=) `POST /` `PUT /:id` `DELETE /:id` |
| `/api/v1/progress` | reading | `GET /:bookId` `PUT /:bookId` |

**Progress storage**: per-book JSON file `progress/{bookId}.json`, shape `{ cfi?, chapter?, percent, fraction?, intervals?, updatedAt }`. `fraction` is the foliate book-wide position (0–1); `intervals` is the merged union of `[start, end]` fraction ranges the user has actually read — the web reader closes the current segment when a relocate jump exceeds `JUMP_THRESHOLD` (0.02) and reports `segmentStartFraction` on PUT. GET additionally returns `readFraction` (total union length, computed server-side). Legacy files without `intervals` are initialized to `[0, current fraction]` on the first new-format save.
| `/api/v1/settings` | settings | `GET /` `PUT /` |
| `/api/v1/reading-records` | reading | `POST /` `GET /summary` `GET /daily` `GET /by-book` `GET /hourly`(?from&to&tzOffset&bookId?) `GET /book/:bookId` |

---

## 6. `@bookdock/web` Structure

```
apps/web/src/
  main.tsx                 # entry: mount AppProviders + RouterProvider
  router.ts                # TanStack Router (routeTree)
  index.css                # Tailwind entry
  routes/
    __root.tsx             # root: global error boundary + auth guard
    index.tsx              # GET / → Library
    login.tsx              # GET /login → Login
    setup.tsx              # GET /setup → Setup (first-run wizard)
    books.$id.tsx          # GET /books/$id → Reader (lazy)
    stats.tsx              # GET /stats → Statistics
  api/
    client.ts              # fetch wrapper (baseURL=/api/v1, auth header, error normalization)
  features/
    auth/                  # Login/Setup pages, auth hooks, error-code→message
    books/                 # hooks, components (BookCard/BookCover/Dialog…)
    reader/                # Reader orchestration + FoliateReader adapter
    search/                # useSearch (TanStack Query), search params
    stats/                 # stats page + charts + hooks
  components/
    ui/                    # shadcn/ui primitives (owned by repo, op-needy)
      Button.tsx
      Dialog.tsx
      ...
  stores/
    auth.store.ts          # Zustand, token/user
    ui.store.ts            # Zustand, theme/reading prefs
```
(layout components etc. in features.)

### 6.1 State conventions
- **Server state**: TanStack Query hooks in `features/<mod>/hooks.ts`.
- **Client state** (per-book, auth, UI prefs): Zustand stores in `stores/`.
- **URL state** (searchParams, pagination, filters): TanStack Router searchParams schema.
- Never put API data in Zustand — Query cache is the single source of truth.

### 6.2 Reader
- Rendering engine is vendored **foliate-js** (`public/foliate-js/`, not npm epubjs). `FoliateReader.ts` adapts the vendored engine: dynamic `import()` of `reader-entry.js`, manages reader lifecycle (render, pagination, annotations, progress). See `docs/local/reader/` for vendoring notes.
- Creature devices: chapter list, TOC nav, progress persist to `books.progress` + `annotations`.
- Reader sidebar has three tabs: TOC, notes, and stats (数据). The stats tab shows per-book reading stats sourced from `GET /reading-records/book/:bookId` (totalSeconds + full daily records, no pagination), derived client-side by pure functions in `features/reader/stats/`; opening the tab flushes the in-progress reading timer first so the numbers include the current session. Below the daily-duration chart it also renders a 24-hour distribution module from `GET /reading-records/hourly` with the optional `bookId` filter (from = book start date, to = today), skipped when the book has no records. A "已读字数" card shows `readFraction × meta.wordCount` (from `GET /progress/:bookId` + book detail), formatted as `X.X万字` for ≥10000, with a `全书 N` sub-line; the card shows `-` when word counts are not backfilled yet.

---

## 7. Config & Env

Single `config.ts`, zod-validated then `Object.freeze`:

| Env | Default | Notes |
|---|---|---|
| `PORT` | 3000 | listen port |
| `DATA_DIR` | `./data` | storage root for library & covers |
| `DB_PATH` | `${DATA_DIR}/bookdock.db` | SQLite path |
| `JWT_SECRET` | — | if unset: generate random hex, persist to `${DATA_DIR}/.jwt-secret` and reuse; env overrides |
| `DEFAULT_USERNAME` | `admin` | default owner username |
| `UPLOAD_MAX_BYTES` | `104857600` | max upload (100MB) |

Prod exposes only the port + `DATA_DIR` volume. Backup = tarball `DATA_DIR`.

---

## 8. Testing / Lint / Types

| Discipline | Command |
|---|---|
| unit/integration (Vitest, hono/testing) | `pnpm test` |
| OxLint (root `oxlintrc.json`) | `pnpm lint` |
| tsc --noEmit per package | `pnpm typecheck` |
| CI (lint → typecheck → test) | GitHub Actions |

---

## 9. Deployment

- **Docker**: multi-stage. Build all packages in build stage; final stage has only `pnpm deploy` output + prod deps (incl. better-sqlite3 native binary for linux). Single container, single port, mounts `DATA_DIR`.
- **docker-compose.yml**: mount `./data:/data`, env per §7, first-run prints default password.
- **Health**: `GET /api/v1/health` → `{ data: { ok: true } }`.

---

## 10. Architecture Decision Records (ADR)

Each ADR is a short standalone file. They live in `docs/local/adr/` (private working notes, archived with the design docs).

| # | Decision | File |
|---|---|---|
| ADR-01 | TanStack Router over react-router-dom | `docs/local/adr/0001-tanstack-router.md` |
| ADR-02 | Don't extract @bookdock/db / storage packages yet | `docs/local/adr/0002-no-db-storage-extraction.md` |
| ADR-03 | Multi-user schema pre-wired | `docs/local/adr/0003-multi-user-schema.md` |
| ADR-04 | StorageDriver / FormatRegistry interfaces first | `docs/local/adr/0004-storage-format-interfaces.md` |
| ADR-05 | Unified `/api/v1` version prefix | `docs/local/adr/0005-api-v1-prefix.md` |
| ADR-06 | nanoid string primary keys | `docs/local/adr/0006-nanoid-primary-keys.md` |
| ADR-07 | shadcn/ui code ownership, on-demand generation | `docs/local/adr/0007-shadcn-codeset.md` |
| ADR-08 | JSON columns for unstable fields, columns for stable ones | `docs/local/adr/0008-json-column-for-volatile-fields.md` |
| ADR-09 | foliate-js replaces epubjs as reader engine | `docs/local/adr/0009-foliate-js-vendored.md` |
| ADR-10 | annotations table + full CRUD in P0 | `docs/local/adr/0010-annotations-table-write.md` |
| ADR-11 | HttpOnly cookie JWT + guard fresh DB user | `docs/local/adr/0011-http-only-cookie-jwt.md` |
| ADR-12 | instance_settings has no userId (exception) | `docs/local/adr/0012-instance-settings-no-userid.md` |