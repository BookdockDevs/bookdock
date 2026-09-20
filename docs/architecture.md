# Bookdock Architecture

> Last updated: 2026-09-19 · This document is the authoritative architecture blueprint; the code follows it. When an architectural decision changes, update this document first, then change the code.

---

## Design Principles

1. **KISS / first principles**: inline first; only extract into functions when logic repeats ≥3 times or a single block exceeds 50 lines. Avoid over-abstraction.
2. **Evolution over prediction**: reserve interfaces only where "expensive to refactor and definitely needed" (storage driver, error-class, album-of-mapping parsing, API versioning, multi-user schema); everything else is YAGNI.
3. **Contract first**: frontend and backend share a single source of truth for types + validation (`@bookdock/shared`) to eliminate drift.
4. **Cohesive extractable modules**: the server is organized by domain modules, key capabilities exposed via interfaces (StorageDriver, FormatRegistry); only extract packages (e.g. `@bookdock/db`, `@bookdock/storage`) when the same capability is genuinely needed elsewhere.
5. **Self-hosted first, privacy first**: data is byte backup-able; default single-process single-binary container; server-held secrets are encrypted at rest and never exposed to the browser.

---

## 1. Monorepo Overview

| package | role | primary stack |
|---|---|---|
| `@bookdock/shared` | pure types + zod validation + API contracts + error codes + constants, **zero runtime deps exc. zod** | TypeScript 5 |
| `@bookdock/server` | API service, data access, storage, format parsing | Hono 4 / Drizzle / better-sqlite3 / jose / nanoid |
| `@bookdock/web` | browser entry (SPA) | React 19 / Vite 8 / Tailwind 4 / TanStack Router / TanStack Query / Zustand |
| `@bookdock/extension` (planned) | first-party browser extension: local reader + Bookdock instance connector | React / Vite / browser extension APIs |

**Package-splitting strategy**: do not pre-extract `@bookdock/db` / `@bookdock/storage`. The server is organized as cohesive modules + interfaces so future extraction is "move files + change imports" rather than a rewrite. Trigger for extraction: a second consumer (CLI / Tauri / Flutter) actually needs to reuse the capability. The planned extension is a separate app in this workspace, not a second entry point inside `@bookdock/web`; it may justify a narrowly scoped reader-core extraction once the second consumer is real.

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
- `User(id, username, passwordHash?, role, disabled, avatarKey?, createdAt, updatedAt?)` — `avatarKey` is the content-hash addressed avatar blob key (`<hh>/<sha256>.<ext>`, stored at `avatars/<key>`); physical file ref-checked across users before delete, same pattern as fonts/books
- `Book(id, userId, title, author, format, filePath, coverKey?, size, meta, createdAt, updatedAt, deletedAt?, shelfId?)` — `shelfId` is the book's single shelf (FK `shelves.id`, `ON DELETE SET NULL`); `null` = 未分类 (a legitimate state). A book belongs to at most one shelf.
- `Shelf(id, userId, name, sortOrder, createdAt)` — `name` is unique per user after trimming surrounding whitespace
- `Tag(id, userId, name, sortOrder)` — user-defined order for the library sidebar; new tags are appended and the list endpoint returns this order; `name` is unique per user after trimming surrounding whitespace
- `Settings(id, userId, key, value)` — the `ui` value may include per-user `fontPreferences` keyed by stable system/builtin/uploaded font ids and a `fontOrder` list of those ids; these preferences control display name, visibility, and display order without turning non-file fonts into database rows. The `library` value carries library-management preferences (`{ normalizeTitle? }`; omitted = on): while on, a book whose title would fall back to the file name is normalized at upload/metadata-reset time (`lib/book-title.ts` strips noise brackets, site suffixes and author markers, prefers leading `《X》`, and backfills an empty author), so `books.title` stays the single derived-at-write source. `GET /settings` also injects the effective instance-level `uploadMaxBytes` (owner-editable via `instance_settings`, falling back to the `UPLOAD_MAX_BYTES` env default) for client-side display and pre-check; `settingsUpdateSchema` strips it from PUT bodies so it is never persisted.
- `InstanceSettings(key, value)` — instance-level KV, no userId (see ADR-12)
- `Annotation(id, userId, bookId, cfiRange, cfiAnchor?, type, color, style, text, note?, chapter?, createdAt, updatedAt)`
- `TextReplacement(id, userId, bookId?, matchType, pattern?, replacement?, enabled, applyTo, ...)` — user-global pattern rules and book-local point patches share one table; per-book pattern overrides live in `text_replacement_overrides`. Pattern rules use Legado-compatible matching semantics: literal matching is exact by default, regular expressions are case-sensitive by default and may opt into case-insensitive matching with inline flags such as `(?i)`. Point patches remain exact snapshot anchors and always target content.
- `TextReplacementOverride(id, userId, bookId, replacementId, enabled, createdAt, updatedAt)` — per-book enablement for replacement rules.
- `Font(id, userId, scope, family, fileName, format, contentHash, size, createdAt)` — uploaded fonts; `scope: user|instance` (instance = owner-shared, visible to all users); physical file content-hash deduped, ref-counted on delete (see ADR-13). The web font catalog also exposes stable system and CDN-builtin entries; user-level display-name/enabled overrides and display ordering live in `Settings.ui.fontPreferences` and `Settings.ui.fontOrder` so users can hide or reorder any font without deleting shared assets.
- `TocRule(id, userId, seedKey?, name, enabled, sortOrder, patterns, createdAt, updatedAt)` — user-owned TXT chapter presets; `seedKey` identifies product-provided presets for safe backfill and restore, while `patterns` stores one configured level per array position. TXT scanning compacts unobserved levels to contiguous output depth for the current book, so a missing parent pattern cannot force all matched child headings to remain nested.
- `books.meta.tocExcludedChapterIds` — per-book TOC boundary overrides. These stable `ch-<offset>` ids suppress selected detected boundaries without changing the global preset; rebuilding merges the suppressed boundary's text into the preceding chapter, with the synthetic leading `序章` handled as a merge into the first real chapter. `tocExcludedLeadingText` preserves that leading text's source order across EPUB recovery.
- EPUB uploads preserve the source TOC hierarchy when the EPUB has an NCX or EPUB3 navigation document: parsed chapter levels are persisted in `books.meta.chapters[].level`, and the Legado projection derives its supported volume markers from those levels. Legacy EPUB rows are upgraded lazily on their first chapter-list read by re-parsing the stored EPUB once; the migration only changes derived chapter metadata and never rewrites book content.
- `books.meta.coverPaletteId` — user-pinned placeholder-cover palette, validated against shared `COVER_PALETTE_IDS` (Morandi tones). Unset falls back to a deterministic hash of the immutable `books.id`, so renaming never repaints the cover; the pin is decorative and ignored while a real `coverKey` image exists. The list endpoint extracts the key via `json_extract` into `BookListItem.coverPaletteId` so grid cards render the pinned color without shipping full meta. Picking happens in the edit dialog's cover overlay (palette popover) and saves through `bookUpdateSchema` with the rest of the draft; there is no in-UI revert-to-auto.
- TXT append is a two-step preview/commit flow. The preview parses the candidate text with the book's effective TOC rule, predicts a continuation point from the last 1–3 existing chapter nodes (including volume/chapter hierarchy), and returns every candidate boundary so the user can override the prediction. Commit accepts the selected normalized-text offset, discards only the candidate prefix before that boundary, then rebuilds the derived EPUB; the existing prefix remains byte-for-byte structurally stable so its CFI, bookmarks, and annotations stay valid. On success, the web mutation updates and invalidates both the library detail cache and the reader's `['book', bookId]` cache so a subsequent reader entry uses the new `updatedAt`-versioned file URL immediately.
- `ReadingRecord(id, userId, bookId, date, durationSeconds)` — per-day per-book accumulated reading seconds; `date` is the client-local calendar day `YYYY-MM-DD` (sessions bucket to the start-day)

Reading position fields live in the `books` row; progress history and interval data live in storage files under `DATA_DIR`.

### Reader book-style boundary

The reader separates book-native text layout from renderer safety rules. When
`overrideBookLayout` is off, the EPUB/TXT document remains authoritative for
text-level properties such as line height, paragraph spacing, indentation,
letter spacing, and alignment; the reader does not inject paragraph-level
`!important` declarations or remove leading paragraph whitespace. When it is
on, those properties and the reader's extended compatibility rules are
applied. Page geometry (content width, gutters, columns, and viewport
padding), theme synchronization, and safety compatibility for overflowing
media, fixed-width legacy content, and unsupported pagination remain
renderer-controlled in both modes. Font family remains independently
controlled by `overrideBookFont`.

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
    migrations/            # current-schema baseline plus future forward migrations
  storage/
    driver.ts              # StorageDriver interface (see §3.2)
    localfs.ts             # LocalFsDriver implementation
    index.ts               # pick driver by config
  formats/
    registry.ts            # FormatRegistry: dispatcher by extension/MIME
    epub.ts                # EpubParser (OPF/NCX/nav parsing + spine order)
    txt.ts                 # TxtParser (encoding detect + chapter heuristics + effective level normalization)
  modules/
    auth.routes.ts          # JWT (jose), instance settings, /setup, /login, /logout, /register, /password, /username
    books.routes.ts         # books CRUD + upload + cover + TOC preview/rebuild + TXT append
    shelves.routes.ts       # shelves CRUD + batch move books in/out of a shelf
    tags.routes.ts          # tags CRUD + m2m book membership
    progress.routes.ts      # reading position
    settings.routes.ts      # user-level KV
    tokens.routes.ts        # operation-scoped access tokens: create/edit/enable/disable/delete (ADR-24)
    annotations.routes.ts   # highlight/note/comment CRUD
    avatars/                # user avatar upload/delete + immutable content-hash file serving
    fonts/                  # custom font upload/list/delete/scope + immutable file serving; web merges these rows with the stable system/builtin catalog and user font preferences
    reading-records.routes.ts # duration upsert + aggregation
    ai/                   # Chat LLM gateway, user configuration, reader context, and bounded read-only tools
    tts/                  # user-owned AI voice services and server-side speech gateways
  middleware/
    error.ts               # AppError + errorHandler (ErrorCode → HTTP status)
    request-context.ts     # API request ID propagation and structured access log
    auth.guard.ts          # cookie/header token → verify → DB fresh user (role/disabled) → inject c.var.user; or `bd_` access token + registry permission check; or guest
    token-cors.ts          # CORS scoped to `Authorization: Bearer bd_...` requests, plus preflights that declare it
  lib/
    logger.ts              # dependency-free JSON logger with level filtering and safe fields
    id.ts                  # nanoid(21) wrapper, prefixable (book_, user_, ...)
    password.ts            # scrypt hashPassword + verifyPassword
    txt-to-epub.ts         # in-memory EPUB ZIP generation for TXT
```

### 3.1 Module conventions
- **routes**: thin. Parse params → call service → wrap errors. No business logic.
- **service**: orchestrate, return domain objects or throw `AppError(code)`. Dependencies injected via function args (db, storage) for testability & extraction.
- Modules do **not** import each other's service; cross-module orchestration goes through shared db/storage instances.

### 3.2 Reader TTS playback

The reader keeps TTS navigation separate from audio acquisition. A session owns an ordered
lookahead queue of visible-DOM segments, starts from the first fully visible candidate in the
current viewport, prepares up to three online audio items concurrently, and only commits the
next reader segment when it is about to play. Online audio is decoded into
Web Audio buffers, then the current and next prepared items are scheduled on a shared
AudioContext with a small rate-scaled sentence gap, so a prepared sentence can start without
another network request or a per-sentence media-element restart. System speech keeps the session in its playing state while the short inter-sentence gap is bridged, so the controls remain enabled and stable between utterances. Pause, resume, stop, and rate changes preserve the active
session; rate changes restart from the current sentence when already-scheduled timings need to
be rebuilt. Lookahead uses the foliate TTS iterator's read-only `collectDetails` operation and
never moves the reader viewport. User jumps or invalidation abort the session generation and
discard its queue, while the per-session client cache may retain decoded buffers for reuse.
System speech must not cancel the new utterance as part of every `speak` call: cancellation is
owned by explicit stop/replace operations, because mobile Web Speech implementations can report
an immediate cancellation when `cancel()` is followed by `speak()` in the same turn. Voice
enumeration follows the browser's `voiceschanged` lifecycle and applies the selected voice's
language when available, with the browser's default voice kept as a fallback when a platform
reports no voices. Edge TTS is acquired through the authenticated same-origin
server gateway, which hides the unstable consumer WebSocket protocol from browsers and allows
the server to provide a complete audio response. The web client does not open the consumer
WebSocket directly; native Android/iOS TTS remains outside the web deployment and requires a
platform bridge in a future client.
EPUB3 Media Overlay is treated as book media, not as a synthetic-TTS voice. A media-overlay section
parses SMIL `par` entries into ordered text ranges and exposes the referenced publisher audio to an
inline reader media control. The control is shown in the current reading surface when the current
section has a valid Media Overlay audio resource, uses the browser's native audio controls, and
keeps its Blob URL scoped to the renderer lifetime. It does not require opening the TTS panel.
Playback ownership is shared with TTS and auto-reading: starting inline book media stops the other
reader playback owner, while starting TTS or auto-reading pauses/stops the inline media control.
Missing fragments or unsupported sections hide the control and degrade to ordinary reader behavior
instead of blocking the book.
The TTS session remains responsible for synthetic speech only. Its panel must not expose Media
Overlay as a voice/source choice; book media has its own page-level playback entry point. The
existing Media Overlay cue adapter and clip client may still be reused by a future synchronized
read-aloud mode, but that capability must not change the interaction boundary of the ordinary TTS
panel.
R09 does not include word-level timing, persistent/offline audio, background/media-session
playback, sleep timers, pitch-preserving time-stretching, or multi-role narration; these remain
explicit follow-up capabilities rather than implicit promises of the baseline.

### 3.3 Reader auto-reading playback

Auto-reading owns a single cancellable movement loop for the reader viewport: smooth mode uses
pixel increments and paginated mode uses the reader's existing next-page navigation. It remains
the active playback owner while the user adjusts the reading position. A user scroll, page turn,
chapter jump, or seek invalidates only the pending automatic movement and lets the manual action
settle; the next automatic movement starts from the latest reader position without changing the
session to paused or idle. Explicit pause/stop, an end-of-book condition, an unrecoverable error,
hidden document visibility, layout-affecting settings, or TTS takeover still ends or pauses the
automatic loop according to the session state machine. Speed changes apply to the next movement
without pausing. Switching between smooth and timed movement is also a live playback-parameter
change: it cancels the old loop, keeps the session running, and starts the new loop from the
current reader position. This rebase behavior keeps user navigation and automatic movement in one
reader position model and avoids a second persisted progress format. Starting a non-collapsed text
selection is different from navigation: it immediately transitions auto-reading to paused and
requires an explicit resume, so the selection toolbar can be used without the viewport moving
under it. When a click dismisses an active text selection, the renderer consumes the paired
click-to-turn/chrome-toggle event as part of the dismissal, so one gesture cannot both close the
selection UI and change reader position or chrome visibility.
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

**Word counting** (`lib/word-count.ts`): one counter for all formats — each CJK char (incl. full-width punctuation, excluding ideographic spaces) counts 1, each run of latin letters/digits counts 1. EpubParser counts per chapter by reading the chapter XHTML from the zip and taking `textContent` via xmldom (never regex tag-stripping), deduplicated per file so TOC entries sharing one file count it once; TxtParser chapters are counted on the normalized text slices. Upload stores per-chapter `wordCount` in `meta.chapters` and the sum as `meta.wordCount`; uploads persist chapter metadata and word counts before the book becomes readable.

---

## 4. Database Schema (multi-user pre-wired)

SQLite + Drizzle. All business tables carry a `userId` FK. A single-user instance seeds one "default user" row. Future multi-user/permissions/sharing only adds tables + policy logic, never touching existing columns.

**Current tables** (23):

| Table | Key columns | Notes |
|---|---|---|
| `users` | id (text PK), username (unique), passwordHash?, role, disabled, avatarKey?, createdAt, updatedAt? | role: owner\|member\|guest; disabled → deny; avatarKey = content-hash blob key under `avatars/`, ref-checked before physical delete |
| `books` | id, userId FK, title, author, format (epub\|txt), filePath, coverKey?, size, meta (json), createdAt, updatedAt, **deletedAt**, **shelfId?** | deletedAt soft-delete (回收站), master-switched by per-user `trash.enabled` (default on): while off, `DELETE /books/:id` calls `deleteBook` directly and trash endpoints (`?trash=1`, restore, empty) return `TRASH_DISABLED` (403); flipping the switch off permanently deletes the user's current trash rows. auto-clean purges rows older than per-user `trash.autoCleanDays` (0=never/7/30, default 30), then a capacity pass: while the user's trash total exceeds `trash.maxTrashBytes` (0/omitted=unlimited; presets 1/2/5 GB), the oldest-deleted rows purge first until back at or under the cap, so a single over-cap book survives no later than the next sweep; both rules share the same triggers — full scan for all users at startup (fail-silent) + lazy per-user scan on `GET /books?trash=1`; purge reuses `deleteBook` (ref-counted blob deletion). shelfId FK → shelves (SET NULL): single-shelf membership, NULL = 未分类; `GET /books?shelfId=<id>` filters by shelf, `shelfId=none` filters uncategorized books |
| `shelves` | id, userId FK, name, sortOrder, createdAt | name is unique per user after trimming; deleting a shelf sets its books' shelfId to NULL (books become 未分类, never deleted) |
| `tags` | id, userId FK, name, sortOrder | name is unique per user after trimming; sortOrder is rewritten from the submitted full tag id list; the library sidebar and active library heading use the selected tag's name |
| `book_tags` | bookId FK (cascade), tagId FK (cascade) | composite PK, M2M |
| `settings` | id, userId FK, key, value (json) | unique (userId, key); keys: `ui` (reader/UI prefs plus `fontPreferences` display-name/enabled overrides and `fontOrder`), `trash` (`{ autoCleanDays, maxTrashBytes?, enabled? }`; omitted `enabled` = on, PUT merges partial updates and purges the trash when disabling), `library` (`{ normalizeTitle? }`; omitted = on, file-name title normalization at upload/reset), `integrations` (`{ legado?: { enabled?, authMode?: 'login'|'accessKey' } }`; omitted `enabled` = off), `ai` (encrypted user AI provider configuration) |
| `legado_access_keys` | id, userId FK, tokenHash, createdAt, expiresAt?, revokedAt? | one per user; token hash only, read-only Legado source access; rotating the key replaces the hash and immediately invalidates the previous secret |
| `access_tokens` | id, userId FK (cascade), name, permissions (json), tokenHash (unique), tokenLast4, createdAt, expiresAt?, disabledAt? | operation-scoped tokens for external clients (ADR-24); one row per issued token, plaintext never stored, `expiresAt` NULL = permanent, `disabledAt` NULL = enabled; deleting the row is the only terminal state (no `revokedAt`) |
| `instance_settings` | key (text PK), value | no userId (ADR-12); auth policy keys plus `uploadMaxBytes` (effective upload cap; absent = `UPLOAD_MAX_BYTES` env default) |
| `annotations` | id, userId FK, bookId FK, cfiRange, cfiAnchor?, type, color, style, text, note?, chapter?, createdAt, updatedAt, **deletedAt?** | unique (userId, bookId, cfiRange); soft delete |
| `text_replacements` | id, userId FK, bookId?, matchType, pattern/replacement?, isRegex, applyTo, enabled, metadata fields | pattern rules are user-global; point patches require a book and always target content; `applyTo` is `content`, `title`, or `both`; per-book pattern enablement is stored separately |
| `text_replacement_overrides` | id, userId FK, bookId FK, replacementId FK, enabled, createdAt, updatedAt | unique (bookId, replacementId); existence means a book-specific override |
| `reading_records` | id, userId FK, bookId FK (cascade), date (text), durationSeconds | unique (userId, bookId, date); upsert snapshot |
| `reading_sessions` | id, userId FK, bookId FK (cascade), date (text), startedAt, durationSeconds | per-session detail for hourly distribution |
| `fonts` | id, userId FK, scope (user\|instance), family, fileName, format, contentHash, size, createdAt | uploaded font assets only; unique (userId, contentHash); file at `fonts/<hash>` in storage, ref-counted delete; system/CDN-builtin entries are catalog definitions rather than rows |
| `toc_rules` | id, userId FK, seedKey?, name, enabled, sortOrder, patterns (json), createdAt, updatedAt | unique (userId, seedKey); stable seed keys identify restorable built-in presets without taking ownership away from the user |
| `tts_services` | id, userId FK, name, provider, baseUrl?, model?, defaultVoice?, options (json), encryptedSecrets?, createdAt, updatedAt | multiple user-owned AI voice services; credentials are encrypted at rest and never returned; built-in system/Edge engines are not rows; guest accounts cannot configure or use user AI services |
| `ai_threads` | id, userId FK, bookId FK (cascade), title, settings (json)?, createdAt, updatedAt | per-user, per-book persisted AI conversation; settings store the thread's reading-scope, read-tool, and assistant-mode snapshot, while new threads copy the user-level latest conversation settings; title is local metadata and contains no generated provider content |
| `ai_messages` | id, userId FK, threadId FK (cascade), role, content, context (json)?, retry (json)?, citations (json)?, revisionGroupId?, revision, isSelected, createdAt, aborted | user-visible prompt/answer plus bounded book-source metadata; assistant revisions share a user-turn group and only the selected revision enters the active conversation; context stores the direct receipt and per-request chapter-level scope/tool/model/mode snapshot, while citations store only chapter/offset/excerpt references; neither stores secrets, system prompt, reasoning, or raw tool payload |
| `ai_message_events` | id, userId FK, threadId FK (cascade), messageId FK (cascade), sequence, type, phase?, name?, chapterIndex?, resultChars?, citationId?, createdAt | bounded provider-neutral event summaries attached to a visible message; stores only tool lifecycle metadata and citation references, never arguments, raw results, provider artifacts, hidden prompts, or reasoning |
| `ai_generation_runs` | id, userId FK, threadId FK (cascade), targetMessageId? FK, state, stateRevision, checkpointSeq, checkpointText, checkpointEvents (json)?, checkpointUsage (json)?, diagnostics (json)?, errorCode?, errorMessage?, createdAt, updatedAt, terminalAt? | durable lifecycle for one chat generation; active states are `preparing`/`requesting`/`streaming`/`waiting_tool`, terminal states are `completed`/`failed`/`cancelled`/`interrupted`; checkpoint and diagnostics fields contain only bounded visible text, normalized tool summaries, safe timing/budget/count metadata and usage, never raw provider payloads, secrets, hidden prompts or reasoning |
| `ai_book_indexes` | id, userId FK, bookId FK (cascade), sourceVersion, status, progress, embeddingStatus, embeddingProvider?, embeddingModel?, embeddingDim?, chunkCount, error?, createdAt, updatedAt | one derived lexical-index record per user/book; `progress` is a 0–100 user-visible build progress value, optional semantic state is tracked separately, and stale source/config fingerprints are never treated as ready |
| `ai_chunks` | id, userId FK, indexId FK (cascade), bookId FK (cascade), chapterIndex, chapterId, chapterTitle, startOffset, endOffset, text, createdAt | reusable bounded book-text units for FTS and later embeddings; source text is not chat history |
| `ai_chunk_embeddings` | id, userId FK, indexId FK (cascade), chunkId FK (cascade), bookId FK (cascade), model, dimension, vector, createdAt | optional per-index Float32 embedding blobs; the parent index stores the provider/model/dimension fingerprint, and all three must match before semantic results are used |
| `ai_chunks_fts` | chunkId, userId, bookId, chapterIndex, chapterTitle, text | SQLite FTS5 derived index; synchronized by `ai_chunks` triggers and never used without ownership filters |

`meta` is a JSON column for "may grow" metadata; frequently-queried stable fields are promoted to dedicated columns.

### Drizzle conventions
- All ids are nanoid strings (from `lib/id.ts`), never auto-increment ints → prevents count leaks, multi-client friendliness.
- Timestamps uniform INTEGER unix ms.
- Single `db/client.ts` (WAL + foreign_keys ON); migrations via drizzle-kit (committed). The 0.2.0 release intentionally starts a new database baseline and does not support upgrading 0.1.0 data. The 0.2.1 release keeps that baseline and adds one forward migration for the tag order and TOC seed metadata.
- The release migration path is append-only and fully represented by Drizzle metadata: a `v0.2.0` database applies `0001_release_0_2_1.sql`, `0002_text_replacements.sql`, `0003_text_replacement_scope.sql`, and `0004_legado_access_keys.sql`, while fresh databases apply the baseline followed by those forward migrations. Startup also retains narrow idempotent guards for local databases whose consolidated migration ledger is ahead of the physical schema; they repair only known columns, indexes, and text-replacement schema details, never rebuilding or deleting user data.

---

## 5. API Design

- **Version prefix**: everything under `/api/v1/...`. Future breaking changes go to `/v2`.
- **Auth**: JWT (jose, HS256, 7d) delivered via HttpOnly Cookie `bd_token` (SameSite=Strict, Path=/); Bearer header also accepted (web client transition). CSRF: cookie is same-site only + API is JSON-only.
- **Login protection**: failed credential attempts use a process-local 60-second sliding window keyed by client address + trimmed username. `AUTH_RPM` (default 5, max 120) returns `AUTH_RATE_LIMITED` (429) with `Retry-After`; validation errors, successful logins, and disabled-account responses are not counted. The window resets on process restart and is not shared across replicas.
- **Setup concurrency**: the first owner write rechecks initialization inside a SQLite transaction so concurrent `/setup` requests can create at most one password user; a later request receives `FORBIDDEN`.
- **Guard**: verify → load **fresh user** from DB (30s short-TTL cache, invalidated on writes) → disabled → `ACCOUNT_DISABLED` (403); injected role is authoritative from DB. No token → inject default guest if `allowGuestAccess`, else 401.
- **Access tokens (ADR-24)**: external clients (companion browser extension, later bots and scripts) authenticate with a user-issued token instead of instance credentials. The format is `bd_` + 32 random bytes base64url, and only its sha256 hash plus the last four characters are ever stored. The guard keeps `bd_src_` on its existing Legado branch and resolves every other `bd_` token against `access_tokens` (unknown or expired → `UNAUTHORIZED` 401; disabled → `FORBIDDEN` 403), then runs the same fresh-user check, so disabling or deleting the owner stops the token immediately and the cascade delete removes it. Authorization is **operation-level**: the registry in `packages/shared/src/access-tokens.ts` is the single source of truth mapping each permission to explicit `METHOD /path` patterns, and any endpoint absent from it is unreachable with a token (no wildcards) — which is also how owner-only surfaces stay closed. `GET /api/v1/auth/me` needs no permission and doubles as the client connection test. `/api/v1/tokens` offers create (the plaintext is returned once, in that response only), edit, enable/disable and delete, scoped to the caller's own tokens; guest sessions are rejected outright and there is no owner-level switch or per-user count limit. Changing a password does not delete tokens.
- **Token-scoped CORS**: CORS headers are emitted only for requests carrying `Authorization: Bearer bd_...` — the request origin is reflected with `Vary: Origin`, methods and request headers come from a fixed allowlist (including `Range` for remote EPUB reads), file response headers needed by range readers (`Accept-Ranges`, `Content-Range`, `Content-Length`, and `Content-Disposition`) are explicitly exposed, preflights are cached via `Access-Control-Max-Age`, and `Access-Control-Allow-Credentials` is never sent. Same-origin session requests carry no `Origin` at all, so the Web client gains no new cross-origin surface. A CORS preflight can never carry `Authorization`, so a preflight that declares `authorization` in `Access-Control-Request-Headers` is answered as well; the real response still only becomes readable cross-origin when a valid token is presented.
- **Roles**: `owner` (instance admin), `member` (registered), `guest` (anonymous → default user). First boot must create owner via `/setup` (web guard redirects when `initialized=false`).
- **Instance settings**: `allowRegistration` / `allowGuestAccess` (default false), owner-edited via `PATCH /api/v1/auth/instance`, 5s module-level read cache. AI configuration is user-owned and edited from the reading settings; the `settings.ai` value stores up to 12 named provider profiles, the active Chat profile id, an optional independent Embedding profile id, protocol-specific endpoint/model fields, one user-curated `models` catalog per profile, an independently encrypted API key per profile, bounded user-editable quick-command templates, and bounded user-authored assistant modes, and the user-level `lastUsedConversationSettings` snapshot for the next new AI thread. The settings and reader surfaces consistently call these presets “quick commands”. Their editor exposes the supported `{SELTEXT}`, `{SELPARA}`, and `{CHAPTER}` context slots as cursor-insertable controls with concise behavior descriptions; the literal slot text remains in the visible/persisted user prompt and is resolved at request time only when its context value exists. The corresponding Reader-visible source remains attached as context once, so the provider does not receive a second copy through the direct context wrapper. Model discovery is a server-side draft operation: the provider response is a candidate list only, and the browser persists only models explicitly added by the user. The active Chat model must come from that added catalog; model selectors never fetch or expose the provider's full catalog. Chat and Embedding share the same added model catalog; embedding-capable entries are identified by explicit provider metadata when available and otherwise by the shared conservative model classifier (for example, `embedding`/`embed` model ids), and the retrieval gateway selects the configured/first matching added entry without a second model field in the settings UI. Provider capability metadata is preserved when returned by a provider, while inferred capabilities are treated as hints and unknown capabilities are not presented as unsupported. Quick-command templates are presentation-level input presets only. The server always includes an invariant core system prompt with safety, source-boundary, tool-truthfulness, and citation rules; the built-in `助理` mode and user-authored modes supply optional mode instructions that are appended before that core. User-selected tool sets, reading boundaries, ownership, size limits, and other gateway controls remain enforced by the server independently of mode prompt text. User-authored modes can be edited or deleted through the same mode editor; the built-in `助理` mode can also be edited, while its fixed id cannot be deleted and its name/prompt can be restored to defaults. The provider catalog includes OpenAI-compatible, Anthropic, Gemini, and Ollama protocol adapters plus presets for common compatible providers. The catalog also declares whether a provider requires an API key, so local providers and hosted providers share one contract without duplicating auth rules in the UI. Connection tests remain server-side draft operations, so provider keys never enter the browser's persistent state. Members may use only the catalog default endpoint for their selected provider; custom endpoints remain Owner-controlled to prevent the AI gateway from becoming an open proxy. Chat threads persist a reading scope and user-selected read-tool defaults; the default `to_here` scope includes all chapters through the current server reading-progress chapter, including the entire current chapter, while `current_chapter` includes only the current chapter and `full_book` removes the chapter boundary. Chat requests may carry a bounded per-request tool allowlist selected by the user for that request; when omitted, the thread snapshot is used. The server validates names against the read-only registry before exposing or executing tools and does not apply a hidden scene-based tool filter. Chat context may also carry at most eight explicit chapter references whose text is produced by the current Reader-visible transformation pipeline; explicitly selected chapters are user-authorized direct context and do not widen server-initiated AI tool access. The server still enforces ownership, size and context budgets before forwarding them. Chat requests are limited to one active request per user and a configurable `AI_RPM` sliding window (default 6); both protections are enforced before provider calls. Environment variables remain optional headless defaults. `AUTH_MODE` env removed.
- **AI context budgeting**: direct Reader context uses a high safety envelope instead of a small fixed selection limit; one provider-independent input budget covers system instructions, current Reader context, conversation history, and appended read-only tool rounds. The gateway keeps the most recent complete turns, re-trims older history after tool results are appended, and rejects an intrinsically oversized current request with a validation error before the provider call. Provider/model context-window failures remain provider errors until model metadata can drive a more precise budget.
- **Durable AI generation run (P0.1)**: every `/ai/chat` request creates one user- and thread-scoped `ai_generation_runs` row before the first provider call. The lifecycle is `preparing → requesting → streaming → waiting_tool → streaming → completed`; any active state may end in `failed`, `cancelled`, or `interrupted`. `targetMessageId` identifies the assistant message being generated and may be null only during the initial `preparing` transition. The current one-active-chat-request-per-user rule remains authoritative, backed by a partial unique index over active states and checked again by the service.
  - State transitions use expected `state` + `stateRevision` compare-and-set; every successful transition increments `stateRevision`. A stale writer must receive a transition conflict and must not overwrite a newer state. Active rows cannot have `terminalAt`; terminal rows must have it. The explicit user stop maps to `cancelled`, provider/request aborts and browser disconnects map to explainable `interrupted` reasons, and startup recovery maps leftover active rows to `interrupted` with a server-restart reason.
  - `checkpointSeq` is monotonic and checkpoint updates are accepted only for the owned run while it is active and only when the sequence is newer. The future checkpoint writer coalesces pending stream snapshots and persists only the latest bounded visible assistant prefix, bounded normalized tool-call/result summaries, and necessary usage. A finalization transaction must close the checkpoint writer, write the authoritative assistant message/context/citations/retry data, and transition the run to its terminal state; late stream writes cannot resurrect a terminal message or run.
  - Every run read or mutation filters by `userId` and verifies the owned thread and book. `GET /ai/threads/:id` exposes the latest bounded run projection needed to restore a reader, `POST /ai/runs/:id/cancel` performs an owned CAS cancellation, and `/ai/chat` returns the run id in its initial metadata/header. This first version restores the visible checkpoint and terminal reason after refresh or SSE loss; it does not attempt to resume an interrupted provider stream across processes.
- **Normalized AI events (P1.1)**: the provider gateway translates tool lifecycle notifications and source references into a small provider-neutral event union. Text deltas remain ephemeral SSE data and the final visible text remains authoritative in `ai_messages.content`; normalized events are bounded summaries attached to the finalized assistant message. Tool events contain only name, phase, bounded chapter/result metadata, and citation ids; citation events contain only a persisted citation id. Raw arguments/results, provider artifacts, hidden prompts, and reasoning are never stored. The same normalized event shape is used in run checkpoints and message history, while ownership is checked by `userId`, `threadId`, and `messageId`.
- **Evidence-backed citation integrity (P1.5)**: only citations returned by an executed read-only book or note tool enter the assistant citation registry. The registry is append-only for one generation, tool results receive a bounded citation-number manifest for the provider, and final assistant content keeps only markers actually referenced by the answer, renumbers them contiguously, and removes unsupported `[n]`/`【n】` markers before persistence. Book-search citations carry offsets for the exact query, or the first query term when a multi-term query is not contiguous, if that text occurs in the returned chunk; a semantic-only result with no query term match retains a bounded chunk anchor because no exact text is available. The web renderer also hides unresolved markers during streaming, so a model hallucinating a citation cannot create a clickable or visually valid source. Direct user-provided Reader context remains context, not a citation.
- **Context plan (P1.2)**: before each provider request, the gateway records a bounded plan in the request receipt: core system and mode prompt sizes, current request size, direct Reader context size, history budget, retained history size/count/turns, dropped history size/count/turns, source-result budget and any trimmed tool-result characters, provider-input character estimate, truncation reasons, the effective reading boundary, and the opaque Reader-visible text version when supplied. The plan is diagnostic metadata only; it never stores selected text, raw history, system prompt content, or tool payloads. Planning order remains `ownership + reading boundary → visible text version validation → direct context/tool retrieval → character budget and history selection → provider protocol conversion`; token estimation and LLM compression remain future work until real provider window pressure justifies them.
- **Retrieval quality and generation diagnostics (P1.4)**: lexical and semantic retrieval keep bounded candidate provenance—retrieval source, candidate counts, ranks, final selected count, and embedding fallback reason—while the public result score remains the existing lexical score or RRF score. Hybrid ranking remains deterministic RRF; no second reranker or remote indexing service is introduced. Each durable generation run stores a bounded operational summary covering provider/model, request count, time-to-first-token, total duration, context-budget counts, tool activity, and retrieval aggregates. These diagnostics are for troubleshooting and quality iteration only; they never store book text, prompts, credentials, reasoning, or raw provider/tool payloads.
- **Non-destructive assistant revisions (P1.3)**: regeneration reuses the matching persisted user turn instead of deleting it, keeps the previous assistant answer as an unselected revision, and creates the new answer as the selected revision in the same turn group. The latest completed assistant turn may expose its revisions through a bounded read/select projection; selection is transactional and changes only the selected answer for that turn. Active thread history, message counts, and the current Reader view expose only selected revisions. Full historical branch switching remains out of scope for the reading product.
- **Read-only AI core boundary (S0/S1 target)**: the chat runtime is intentionally limited to provider-backed conversation, exact provider transcript replay, bounded read-only book tools, lexical-first retrieval with optional embeddings, evidence-backed citations, durable history, retry, and normalized progress events. `save_as_idea`, note/highlight creation, memory search/write, and other write tools are deferred capabilities; they must not be added to the tool registry, provider schemas, request allowlist, or current implementation phases. Those capabilities are out of scope for the active AI core.
- **Read-only tool execution policy (S2 target)**: every exposed tool declares `parallelSafe`, `timeoutMs`, and a result-size limit in one server-side registry. The user-selected thread/request tool set is the provider's complete visible tool set; the gateway validates it against that registry before building provider schemas and checks the same registry again before execution. There is no hidden scene-based tool filter. Independent read-only calls from one provider response may execute concurrently within a small fixed bound, but their tool-result messages are appended in provider call order. Read tools use a 120-second default per-call timeout, while the enclosing provider run keeps its shorter overall wall-clock budget. Cancellation aborts all in-flight calls; a tool timeout becomes a bounded tool error for the model and does not silently widen the next request's budget.
- **Provider error contract (implemented)**: provider HTTP failures, connection failures, and timeouts are normalized at the gateway boundary. User-visible messages may include only a short sanitized provider diagnostic; raw response bodies, credentials, prompts, and headers never cross the API or enter run history. The normalized error carries provider status and a retryability decision so a 4xx configuration/request error is not presented as an unconditional retry, while 429/5xx/network/timeout failures remain retryable.
- **Unified responses**: success `{ data: T }`; failure `{ error: { code, message } }` (see §2.1 in shared).
- **Legado book-source adapter**: Bookdock exposes a read-only `/api/v1/legado` facade over the current user's `Book` records, chapter metadata, and chapter content. It does not crawl or mirror external sites. `GET /api/v1/legado/source.json` is intentionally public because it contains only the importable source definition; search, detail, TOC, chapter, cover, and media requests remain behind the normal auth guard or a scoped Legado access key. The generated source uses `/api/v1/legado/login` as a public login bridge, a dynamic `Cookie` header from the source CookieStore, and `enabledCookieJar` so the Reading/Legado app can establish the same HttpOnly-cookie session before reading. The bridge re-sets an existing `bd_token` on the WebView response before redirecting to `/login?legado=1`; the shared `/login` SPA route performs the existing `/auth/me` session probe even though it is public, and redirects an already authenticated client to `/` so reopening a valid login URL never presents a misleading login form. The Legado-marked login flow uses a full same-origin navigation after login so WebView cookies reach the source CookieStore. The facade preserves the unified `{ data: T }` response shape except for the raw top-level JSON array required by Legado source import. Search is catalog-scoped: its keyword matches title, author, format, shelf and tag names, and selected book metadata such as description, series, subjects, publisher, identifiers, and source; it deliberately does not scan chapter bodies. Search results include the stored book description, newline-separated `kind` labels, formatted `wordCount`, and the replacement-aware `latestChapterTitle`; Legado renders `kind` and `wordCount` as badges and the latest title in its result row. Book detail maps `kind` to newline-separated short badges for the format, assigned shelf, and tags without server-side labels; Legado's local reading status remains the source of truth, and `wordCount` remains a separate native Legado badge. The detail `intro` uses Legado's `<usehtml>` wrapper with escaped text, explicit blank lines, and full-width paragraph indentation so section headings stay aligned instead of being auto-indented by Legado's plain-text formatter; format is represented by the badge and is not duplicated in the intro, while file size remains in the book-information rows. The TOC response retains Bookdock's numeric `level`, derives `isVolume` for any node followed by a deeper level, and leaves chapter titles unpadded because Legado uses `isVolume` for volume styling rather than title whitespace. Volume nodes use Legado's title-plus-index sentinel URL so the client treats them as directory headings instead of fetching them as chapter content. TOC titles and chapter content are projected through the requesting user's effective replacement rules at response time; generated TXT content also drops one leading paragraph only when it exactly repeats the chapter heading or its parsed subtitle, because Legado renders the chapter title independently. TXT normalized-text recovery serializes an empty volume node as only its title before joining items; otherwise each volume adds two offset characters and later chapters begin too early. The original Book APIs remain unchanged. EPUB point patches use the stored section href and text-node offsets, while generated TXT EPUBs use their deterministic chapter hrefs.
- **Legado access keys**: Users may generate a separate read-only source key instead of signing in from Legado. The only durations are 90 days, one year, and permanent; issuing a new key revokes the previous key immediately. The plaintext key is returned only at generation time and is sent by the imported source as a bearer header, never persisted in plaintext. Key-authenticated requests are accepted only by the read-only Legado facade, are checked for expiry/revocation, the current `enabled` and `authMode` settings, and current user status, and cannot reach ordinary Bookdock write APIs. Switching the integration off or switching from access-key mode to login mode revokes the existing key immediately; the request guard also rejects legacy keys while access-key mode is disabled. On Legado routes, an explicit `bd_src_` bearer/query key takes precedence over any Bookdock session cookie, so a stale access key cannot appear to work by falling back to a different login session. The web settings query is paused while the mode mutation is pending and its cached key is removed before settings refetch, so toggling modes cannot display or re-fetch a stale key. Login-based sources remain the default and continue using CookieStore; key-based sources disable the login bridge and cookie jar. The source identity remains stable per user so rotating a key updates the existing source instead of creating an unbounded duplicate, while the generated import URL must be imported again after rotation.
- **Legado detail provenance metadata**: The adapter follows the Web book-detail view's metadata order: format stays in the native Legado badge, while file size, the original uploaded filename from `Book.meta.fileName`, and the added date from `Book.createdAt` are included in the `<usehtml>` information rows. The last-updated date is included only when `Book.updatedAt` differs from `Book.createdAt`, avoiding a duplicate timestamp for a fresh upload.
- **Legado dynamic explore**: The source enables Legado discovery with a JavaScript-generated control surface. The current user's shelves and tags are separated by full-width headings named “书架” and “标签”; shelf and tag controls are loaded from an authenticated `/api/v1/legado/explore/config` response every time the discovery surface is refreshed, so they do not require source re-import. The generated JS resolves `java` and `source` from the explore callback context first, then falls back to the standard Legado bindings, matching community source patterns across app versions. The two adjacent sort selectors for field (`title`, `createdAt`, `updatedAt`) and direction (`asc`, `desc`) appear before the direct all-books link, making their global scope clear. Buttons open paginated, replacement-aware book-list projections through authenticated `/api/v1/legado/explore/all`, `/shelves/:id`, and `/tags/:id` endpoints. The sort controls apply to all three result scopes and keep the existing pin-first ordering in effect. They do not affect search results or the order of shelf/tag controls. The source stores the selected sort state in the source variable; Legado's own discovery refresh rebuilds the generated rows and is the recovery path when the first render happened before login. Configuration failures are surfaced as a visible error heading instead of being mistaken for an empty library. The generated source carries a monotonic `lastUpdateTime` and a version marker in `exploreUrl`; re-importing the same `bookSourceUrl` updates rules while Legado's CookieStore remains keyed to that unchanged URL. It does not expose reading status as a server badge or create fake book entries.
- **Reader AI controls**: the reader separates three lifecycles in the UI. Explicit selection/chapter attachments apply only to the next request, appear as removable chips above the composer only while present, and are added from the composer attachment button. The chapter-reference picker preserves TOC nesting and lets users collapse parent sections without changing selections. Reading scope is a three-state thread setting exposed beside the AI panel title; a new thread copies the user's latest conversation settings rather than a book-specific default; clicking cycles `to_here → current_chapter → full_book → to_here`, with a visible warning when full-book access is selected. Read tools are user-controlled thread settings selected independently from a composer tools menu; every enabled tool is sent to the model, and no scene-based filter silently removes it. User-facing tool names use consistent action-oriented labels, and future allowlisted capabilities such as web search extend this menu rather than the attachment or scope controls. Existing-thread scope/tool/mode changes are debounced and persisted immediately through the thread endpoint and update the user-level latest conversation settings; opening a historical thread only restores its saved snapshot. The device also remembers the active thread and unsent composer draft per user and book: prompt text and explicit chapter-reference indexes survive reader remounts, while scope/tools/mode come from the active thread or the user-level latest conversation settings. Selected-text snapshots, open menus, streaming state, and tool progress remain ephemeral. Server thread state overrides the local draft when a remembered thread is restored. Composer controls use one icon weight and a shared subtle open-state background. The AI panel and composer respond to their sidebar containers rather than the viewport: the header tightens only its padding and action gaps at the adjustable lower limit while keeping the title on one line; the composer uses all available panel width, keeps the mode/model selector group bounded at wider sizes with the send action anchored to the trailing edge, compresses secondary brand decoration at narrow sizes, and gives the selectors their own row at the lower limit so controls never overlap or collapse into irregular gaps. The already-mounted AI panel warms the thread list and known local model-brand assets before their menus open, while query invalidation remains responsible for freshness instead of forcing a request on every history-menu click. Answer Basis is reconstructed from persisted receipt and citations, stays collapsed by default, and exposes source jumps, effective scope, usage counts, model, and mode without exposing system prompts, hidden reasoning, or raw tool payloads.
- **Reader AI message presentation**: the current assistant mode is the title-bar primary control, replacing the static panel title; the default `助理` and user-authored role names use the same bounded title slot and open the existing mode menu. Because the mode menu is space-constrained, every mode row exposes an icon-only edit button with an accessible label; it opens the shared mode editor, where the name and instruction can be updated. Custom modes expose a text delete action with confirmation, while the built-in `助理` mode exposes a text restore-default action and cannot be deleted. The composer footer is reserved for next-request attachments, read tools, the model selector, and send/stop. User and assistant messages share the same rounded bubble structure, spacing, and text scale; the assistant uses a lighter surface rather than a separate bordered card. Streaming thinking/tool status is rendered as a transient status treatment, while copy, retry, and save-as-idea actions live in a message action row outside the assistant bubble. User messages may show a compact summary of direct context sent with that request (selection, preceding text, or explicit chapter references); this summary never exposes the text itself and does not replace Answer Basis. The latest assistant answer in a restored thread remains retryable through a bounded `AiRetryRecipe` saved with its paired user message; the recipe contains the original user-supplied context and the selected mode prompt/request settings needed to reproduce that turn, never hidden reasoning, provider secrets, or raw tool payloads. Answer Basis remains collapsed and otherwise unchanged until narrow-panel and mobile testing justifies a separate presentation decision.
- **Request diagnostics**: `request-context` runs before `authGuard` on `/api/v1/*`, accepts a validated `X-Request-ID` or generates `req_<nanoid>`, echoes it on every API response, and writes one `http.request.completed` JSON record per non-successful-health request. `errorHandler` writes the single `app.unhandled_error` record for unexpected exceptions; logs never include query strings, bodies, credentials, usernames, or book content.

### Route overview

| Prefix | Module | Key endpoints |
|---|---|---|
| `/api/v1/health` | — | `GET /` |
| `/api/v1/auth` | auth | `GET /instance` `PATCH /instance`(owner) `POST /login` `POST /logout` `POST /setup` `GET /setup-required` `POST /register` `POST /password` `POST /username` `GET /me` |
| `/api/v1/legado` | books / Legado adapter | `GET /source.json` and `GET /login` (public source definition/login bridge); `POST /access-key` (authenticated generation/rotation); `GET /search` `GET /explore/config` `GET /explore/all` `GET /explore/shelves/:id` `GET /explore/tags/:id` `GET /books/:id` `GET /books/:id/cover` `GET /books/:id/resource` `GET /books/:id/chapters` `GET /books/:id/chapters/:index` (authenticated or scoped-key, read-only projections for Reading/Legado) |
| `/api/v1/users` | users | `GET /`(owner) `PATCH /:id`(owner) |
| `/api/v1/avatars` | avatars | `POST /`(multipart, jpeg/png/webp/gif ≤ 2MB) `DELETE /` `GET /<hh>/<sha256>.<ext>` (immutable content-hash blob) |
| `/api/v1/books` | books | `GET /` (supports title/author search plus exact metadata filters `author` and `series`) `POST /` `GET /:id` `DELETE /:id` `GET /:id/file` `GET /:id/cover` `PUT /:id/shelves` (set single shelf, `{shelfId: string|null}`) `GET /:id/shelves` `PUT /:id/tags` `GET /:id/tags` `GET /:id/chapters` `POST /:id/toc-preview` `POST /:id/re-toc` `POST /:id/append-preview` `POST /:id/append` |
| `/api/v1/shelves` | shelves | `GET /` `POST /` `PUT /:id` `DELETE /:id` `POST /:id/books` (batch move in) `DELETE /:id/books` (batch move out) |
| `/api/v1/tags` | tags | `GET /` `POST /` `PUT /:id` `PUT /order` `DELETE /:id` |
| `/api/v1/fonts` | fonts | `GET /` `POST /` `PATCH /:id/scope`(owner) `DELETE /:id` `GET /:id/file` |
| `/api/v1/replacements` | replacements | pattern and point-replacement CRUD plus per-book enablement |
| `/api/v1/toc-rules` | toc-rules | `GET /` `POST /` `PUT /:id` `DELETE /:id` `PUT /reorder` `POST /seed` |
| `/api/v1/annotations` | annotations | `GET /`(?bookId=) `POST /` `PUT /:id` `DELETE /:id` |
| `/api/v1/progress` | reading | `GET /:bookId` `PUT /:bookId` |

**Progress storage**: per-book JSON file `progress/{bookId}.json`, shape `{ cfi?, chapter?, chapterIndex?, percent, fraction, intervals, updatedAt }`. `chapterIndex` is the zero-based chapter position from the current book TOC and is persisted for server-side consumers such as AI spoiler bounds; AI applies this boundary at chapter granularity, so the whole current chapter is available and later chapters are not. `fraction` is the foliate book-wide position (0–1); `intervals` is the merged union of `[start, end]` fraction ranges the user has actually read — the web reader closes the current segment when a relocate jump exceeds `JUMP_THRESHOLD` (0.02) and reports `segmentStartFraction` on PUT. GET additionally returns `readFraction` (total union length, computed server-side).
| `/api/v1/settings` | settings | `GET /` `PUT /` |
| `/api/v1/tts` | tts | `GET /providers` `GET/POST /services` `POST /services/test` `GET/PUT/DELETE /services/:id` `GET /services/:id/voices` `POST /services/:id/test` `POST /speech` (server-side provider gateways) |
| `/api/v1/ai` | ai | `GET /providers` `GET /status` `GET/PATCH /config`(active Chat/Embedding profiles, prompt templates, and assistant modes) `POST/PATCH/DELETE /profiles` `POST /models` `POST /test` `GET/POST /threads` `GET/PATCH/DELETE /threads/:id` `GET /runs/:id` `POST /runs/:id/cancel` `GET /retrieval/status` `POST /retrieval/index` `POST /retrieval/index/cancel` `DELETE /retrieval/index` `POST /retrieval/search` `POST /chat` (server-side multi-provider Chat LLM gateway; provider metadata includes key requirements; status exposes only the active profile's non-sensitive model options, enabled quick prompts, and assistant modes for the reader picker; model discovery/test are non-persistent draft operations; existing-profile drafts identify their profile so saved secrets are never borrowed by new profiles; retrieval status exposes user-visible lexical/embedding progress and the embedding provider/model fingerprint, and its derived index can be cancelled, rolled back, cleared, and rebuilt on demand; chat may use an allowlisted, bounded read-only tool set for the owned book, accepts bounded Reader-visible chapter references and the selected assistant-mode prompt, persists user-visible messages and bounded retry recipes by thread, and exposes only bounded generation-run/checkpoint projections) |
| `/api/v1/reading-records` | reading | `POST /` `GET /summary` `GET /daily` `GET /by-book` `GET /hourly`(?from&to&tzOffset&bookId?) `GET /book/:bookId` |

AI retrieval indexes are derived per user and per book. A reader-triggered index request may carry bounded chapter text produced by the reader's visible transformation pipeline, together with its transformation fingerprint; the server keeps ownership and chapter metadata authoritative while using the supplied text for chunk offsets. Reader chat carries the same opaque transformation fingerprint through its context, so `search_book` and `get_chapter_content` must use an exact matching visible index and must not silently fall back to source text; an unbuilt visible index returns an explicit unavailable result for the model to explain. Semantic query embedding has a short bounded timeout and falls back to lexical retrieval, while an explicit user/request abort still cancels the whole operation. Server-only callers may use the source-book fallback, which is intentionally not represented as transformed visible text. For chat, the server derives an effective chapter interval from the requested reading scope and persisted progress before any provider request: `to_here` includes chapters through the current progress chapter, `current_chapter` includes only that chapter, and `full_book` includes the complete TOC. The client chapter index can identify direct context but cannot widen this interval; every TOC, chapter, book-search, and note-search tool execution rechecks the interval. Explicit chapter references remain bounded user-authorized direct context and are recorded separately in the receipt.

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
    profile.tsx            # GET /profile → current user's profile
    login.tsx              # GET /login → Login
    setup.tsx              # GET /setup → Setup (first-run wizard)
    books.$id.tsx          # GET /books/$id → Reader (lazy)
    stats.tsx              # GET /stats → Statistics
  api/
    client.ts              # fetch wrapper (baseURL=/api/v1, auth header, error normalization)
  features/
    auth/                  # Login/Setup pages, auth hooks, error-code→message
    profile/               # Current user's profile shell and account editing
    books/                 # hooks, components (BookCard/BookCover/Dialog…)
    reader/                # Reader orchestration + FoliateReader adapter + TtsController + AutoReadingController
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
- **Editable settings lists**: settings-page lists that support reordering (TOC rules, quick commands, and fonts) keep drag handles and edit/delete actions hidden in normal mode. A compact two-state edit control enters a temporary editing mode; the active mode exposes the handles and row actions, stages the reordered list locally, and the same control exits the mode and commits one ordered update. Add/restore actions are disabled while a list is being edited, and a failed commit keeps editing mode open so the user can retry.
- **TOC rule pattern editor**: within one TOC preset, each pattern row represents exactly one directory level. The row order is canonical and simultaneously defines ascending levels (`1..N`) and matching order; the editor derives these numbers from position instead of exposing a separate priority field. A single regex may contain alternatives for multiple heading forms at the same level. Saving normalizes the submitted pattern levels to the visible row positions, and the request contract requires the submitted levels to remain continuous and unique.
- **Settings row controls**: normal rows place the enable/disable switch at the trailing edge; edit mode keeps the switch first and reveals edit/delete actions to its right, so the action group remains stable and aligned across editable lists.
- **Settings list counts**: compact list counts appear immediately after the module title as a muted numeric suffix, and are omitted when the count is zero; the list body and empty state remain responsible for their own explanatory text.
- **Font catalog**: the settings page and reader font pickers merge system, CDN-builtin, and uploaded entries. Without a saved order, this is the default order; a user's `Settings.ui.fontOrder` then reorders the stable ids and any newly available ids are appended. Stable per-user display-name/enabled overrides stay in `Settings.ui.fontPreferences`; opening a picker mounts public builtin CSS in the main document so each font name can render in its own face, while the reader iframe continues to receive the selected font's CSS separately. Font rows use only source and, for uploaded fonts, scope badges; file format, size, and disabled state are not repeated as badges in the list. In the settings list, the builtin load/download control sits immediately to the right of the rendered font name, before source/scope badges and the trailing enable switch; it is replaced by a spinner while loading and disappears after the font is ready.

### 6.1.1 User feedback and transient notifications

The web client distinguishes three user-feedback surfaces:

- **Toast**: a transient global notification for a completed action or an immediately actionable problem.
- **Inline error**: a persistent error rendered beside the page, panel, or field that failed to load or validate, with a local retry or correction path when available.
- **Task status**: persistent progress and final outcome for work that can outlive the initiating interaction, such as uploads and AI index builds.

Not every notification is a toast. Toasts must not be the only status for page-load failures or ongoing work. The transient notification host is mounted once at the application root and owns presentation concerns such as stacking, dismissal, timing, accessibility, and responsive placement. Notification producers provide a typed intent with a severity, translation key, interpolation parameters, optional action, and optional deduplication identity; they do not provide ad hoc visual classes or raw backend error text.

Notification state is ephemeral client state: it is not persisted, is independent from TanStack Query cache, and is cleared when the authenticated session changes. Toast styling uses the application semantic theme and must not inherit per-book reading-theme variables. Success and informational notifications are polite status updates; errors and warnings remain discoverable long enough to be read and expose an explicit dismissal or recovery action when one exists.

### 6.2 Reader
- Rendering engine is vendored **foliate-js** (`public/foliate-js/`, not npm epubjs). `FoliateReader.ts` adapts the vendored engine: dynamic `import()` of `reader-entry.js`, manages reader lifecycle (render, pagination, annotations, progress). See `docs/local/reader/` for vendoring notes.
- Reader media interaction stays split at the iframe boundary: vendored `view.js` recognizes standalone raster `img` and SVG `image` clicks, suppresses the generic page-turn event, and emits structured media metadata; it also routes standalone image context-menu/long-press gestures to the host, with a pointer long-press fallback for touch/pen and deduplication against browser `contextmenu`. `FoliateReader` forwards the section/CFI/source/alt payload to the host. Images inside links, buttons, footnote references, or other interactive controls retain the control's existing semantics. The host-side viewer provides fullscreen fit-to-viewport viewing, bounded zoom, wheel/double-click zoom, mouse drag, touch pinch/pan, Escape/backdrop close, download of the current Blob-backed resource, clipboard copy (normalized to PNG when required), and a compact context menu for view/save/copy. Image navigation, system sharing, and broader resource-management UI remain later capabilities.
- Inline EPUB audio/video stays native and non-blocking: the vendored core prioritizes instant text rendering over heavy media decompression. During chapter XHTML preparation, heavy video and audio sources are deferred into `data-bd-deferred-src`, allowing chapter text to render without waiting for multi-megabyte binary decompression from the EPUB archive. Once rendered, `FoliateReader` resolves the Blob URLs asynchronously via `section.loadHref()` and uses adaptive `.bd-video-wrapper` sizing: media with a poster or source preserves its natural ratio, while empty placeholders fall back to a minimum 16:9 card. Loading feedback waits for media readiness, native and custom controls do not overlap during loading, and failed media exposes a retryable error state without interrupting text rendering. The vendored core preserves controls, source, track, and poster semantics and suppresses reader page-turn handling when a media element is clicked. The Loader owns static and dynamic media Blob URLs and releases them with the section/frame lifecycle; React does not create a second media cache or custom player for this baseline.
- The vendored EPUB core is based on the reproducible upstream foliate-js baseline (revision snapshot `4512f39859280b8c1f1e6fefa4f104f9e09c55e5`, submodule `74d8022c3700ea76088afd58c3ae6dabfcaf2cc4`). Bookdock-specific behavior belongs in the adapter or an explicitly recorded `bookdock:` patch in `PATCHES.md`. The scoped compatibility refresh is closed for markup/resource recovery, dynamic resource lifecycles, scripted layout, fixed-layout bitmap sizing, image interaction, native inline media boundaries, and Media Overlay host wiring; each is recorded against the authoritative vendored snapshot. Future upstream updates must replace the core as a whole and replay this patch ledger before changing the runtime baseline.
- EPUB content is untrusted input: scripted content is denied by default at the core resource policy, and iframe sandboxing remains defense in depth. A future user/per-book permission setting may choose a different default or per-book override only after a separate threat-model and capability review; the core must still deny dangerous capabilities regardless of that setting, and URL parameters are not the product control surface. Resource resolution is manifest-first, with a bounded fallback to unambiguous, normalized entries that actually exist inside the same EPUB archive; missing or ambiguous entries must not become fabricated Blob URLs, and fallback must not bypass the script policy. When scripts are explicitly allowed, section-level dynamic resource observation remains owned by the core Loader and is attached/detached with the renderer iframe lifecycle rather than reimplemented in React.
- Reader content caching is versioned by the `/file` URL (`bookId` plus `updatedAt`). React Query caches book metadata and reader API data; the reader keeps bounded parsed-EPUB, chapter-text, and cross-mount binary-resource LRUs for the current session. Raw EPUB chapter text is also persisted in IndexedDB under the versioned book namespace with a 20 MiB per-namespace LRU budget; storage failures degrade to the network path. Binary cache entries store source data rather than permanent object URLs, so each view can create and revoke its own URLs without repeating ZIP decompression. In-flight entries are not considered warm until they resolve successfully; failed or missing entries never suppress loading feedback. No cache is unbounded, and a full page refresh clears the in-memory reader caches.
- Reader lifecycle is generation-scoped: only the active reader instance may publish readiness, TOC, relocation, navigation-pending, or error events to React. Switching books resets ephemeral reader state (including TOC and sidebar visibility) before the new view can publish content, so a previous book cannot appear while the next one is loading. Saved-progress restoration gates writes until initial navigation settles, falls back from invalid CFIs to fractional progress, and exposes retry/start-over recovery for failed initialization.
- Text replacement is a shared, bounded execution pipeline rather than a per-DOM-node string helper. Pattern rules operate on a section text stream that can span inline markup while preserving the surrounding DOM structure; title rules operate on chapter/TOC title strings, and point patches operate only on content snapshots. The shared compiler normalizes the supported Legado inline flags before execution, validates replacement references, and runs potentially expensive regular expressions in an isolated worker with a hard timeout so a pathological rule cannot freeze the reader or server request. Rendering, match counts, search, AI visible-corpus generation, and TXT export must consume the same replacement semantics.
- Reader positions have separate persistence semantics: the progress `cfi` may remain a layout-oriented `chapter:index:fraction` coordinate in scrolled mode so resume and coverage restore the viewport proportion, while `ReaderLocation.contentCfi` is the raw EPUB CFI produced from the live visible Range. New highlights, ideas, and bookmarks persist that one content CFI in `cfiRange`; `cfiAnchor` is compatibility metadata, not a second navigation coordinate. Bookmark activation uses CFI range containment/overlap rather than string equality, so responsive reflow does not clear the marker. `FoliateReader.display` navigates annotations by their content CFI; existing fraction-based bookmarks remain a legacy fallback and are not migrated.
- The selection toolbar keeps AI chat and quick commands as separate actions: AI chat carries the Reader-visible selection into the composer without sending, while the adjacent quick-command action opens a compact anchored menu and sends the chosen template immediately. The AI composer has no persistent slash button; typing `/` at the beginning of an otherwise empty prompt opens the enabled, ordered command picker above the composer, filters it as the user types, and selecting a command only prefills the prompt. An unmatched slash query renders a compact localized no-result state and remains sendable as an ordinary message. `{SELTEXT}`, `{SELPARA}`, and `{CHAPTER}` remain literal in the input and user message; at request time, each token is replaced only when its current Reader-visible value exists, otherwise the token is left unchanged. A source used by a token is not duplicated in the provider's direct context wrapper, while the message still shows that source as a quote above the prompt. Selection-toolbar and slash-menu entry points create the same quick-command invocation; they differ only in immediate-send versus draft behavior. The AI panel exposes temporary attachments, thread reading scope, and thread tool selection as separate controls; messages render a collapsed Answer Basis from persisted receipt and final citations, with source jumps and usage details available on demand but no system prompt, hidden reasoning, or raw tool payload. Tool hits remain internal while a generation is active; only after the final answer is complete are citation markers validated, renumbered, and matched to the citations actually referenced by that answer, so Answer Basis does not appear early or list unused search hits.
- Desktop reading-area taps dismiss an open sidebar only while the sidebar dock is unlocked; a locked open sidebar remains independent from the top/bottom reading chrome. Touch drawers remain dismissible from the reading area. The desktop sidebar width is device-local, uses the same 200–640 px bounds while dragging and restoring, and therefore preserves every reachable width across reader sessions. The top header and bottom progress strip use the same 300 ms translated-position transition, including Tailwind 4's individual `translate` property rather than relying on the shorthand `transform` property.
- Reader page marginals (the optional book title/chapter/progress information bars, distinct from the React reading controls) are layout chrome outside the content viewport. The vendored paginator owns one three-row shell: the theme background spans the shell, optional full-width header/footer rows surround the `#container` content/scroll viewport, and page-specific background segments are confined to the middle content row. Header and footer rows must never share a grid area with `#container`; the paginator measures and paginates against the middle-row viewport so marginal text cannot overlap book content or be painted over by a chapter background. Their visibility is controlled only by the `show-header`/`show-footer` attributes, and the first page is not a special hidden state. `FoliateReader` owns only the three-slot text composition and font preference; it does not position or size the bars. The three physical L/C/R slots remain stable across page count, flow, vertical writing, and RTL so book direction cannot move UI chrome unexpectedly. In paginated mode, a positive `max-column-count` is an explicit user-selected column count, not a soft maximum: the paginator must use 1/2/3 exactly, even when the resulting column is narrower than `max-inline-size`; only an automatic/non-positive value may derive a count from available width.
- Creature devices: chapter list, TOC nav, progress persist to `books.progress` + `annotations`.
- EPUB footnote references are handled by the vendored `FootnoteHandler`: explicit `epub:type`/ARIA references are preferred, conservative superscript heuristics require a note-like target, and the host renders the result in a disposable temporary `foliate-view` popup. Nested footnotes have local back history; parsing/rendering failures fall back to ordinary internal navigation and do not alter the main reader jump history.
- Reader sidebar has three tabs: TOC, notes, and stats (数据). The stats tab shows per-book reading stats sourced from `GET /reading-records/book/:bookId` (totalSeconds + full daily records, no pagination), derived client-side by pure functions in `features/reader/stats/`; opening the tab flushes the in-progress reading timer first so the numbers include the current session. Below the daily-duration chart it also renders a 24-hour distribution module from `GET /reading-records/hourly` with the optional `bookId` filter (from = book start date, to = today), skipped when the book has no records. A "已读字数" card shows `readFraction × meta.wordCount` (from `GET /progress/:bookId` + book detail), formatted as `X.X万字` for ≥10000, with a `全书 N` sub-line; the card shows `-` when word counts are unavailable.
- Jump history (后退/前进): browser-style session history, in-memory only and cleared on book switch. `FoliateReader.display`/`scrollToPercent` is the chokepoint — every user jump (TOC, note/bookmark, search result, progress drag) emits `willJump` with the position being left, which `Reader.tsx` pushes into `features/reader/jump-history.ts` (back/forward stacks, cap 50; a new jump clears the forward stack). Internal navigation opts out via `display(target, { internal: true })`: the initial open, saved-progress re-display, and the history back/forward buttons themselves. Page turns and scrolling never enter the history.

### 6.3 Planned browser extension

The companion extension is a separate client application under `apps/extension/`. It is developed in this monorepo so API contracts, upload/auth behavior, and any deliberately extracted reader-core code can evolve with the server and Web client. Its build output is independent: the extension does not bundle `@bookdock/server` or the full `@bookdock/web` application.

The extension has two explicit modes:

- **Local mode**: an extension-local flat `LocalLibrary` stores EPUB/TXT files, editable title/author metadata, a single reading position, and the minimum reader preferences. It supports reading, TOC navigation, progress recovery, and basic reading settings; it does not implement the Web client's custom fonts, custom themes, custom TXT TOC rules, annotations, AI, or TTS.
- **Connected mode**: an `InstanceConnection` identifies a configured Bookdock instance and authentication state. Dropped files are uploaded to `POST /api/v1/books`; the returned `bookId` is opened through the extension reader using the instance's remote file endpoint. A configured but unreachable instance must not silently report a successful local upload.

The extension must not import the whole `@bookdock/web` entry point. Shared code is limited to `@bookdock/shared` and, only after a stable second consumer exists, a small reader-core boundary for source adapters, TOC/progress primitives, or vendored foliate assets. Browser-only persistence and instance profiles remain extension-owned concerns.

The first extension milestone intentionally excludes `file://` takeover, annotations/bookmarks/notes, full-text indexing, multi-shelf organization, cloud synchronization, PDF/MOBI/CBZ support, and offline upload queues. See `docs/local/extension/` for the scoped product and implementation documents, and `docs/local/research/browser-extensions/` for competitor research.

---

## 7. Config & Env

Single `config.ts`, zod-validated then `Object.freeze`:

| Env | Default | Notes |
|---|---|---|
| `PORT` | 3000 | listen port |
| `DATA_DIR` | `./data` (`/data` in image) | storage root for library & covers |
| `DB_PATH` | `${DATA_DIR}/bookdock.db` | SQLite path |
| `JWT_SECRET` | — | if unset: generate random hex, persist to `${DATA_DIR}/.jwt-secret` and reuse; env overrides |
| `DEFAULT_USERNAME` | `admin` | username of the built-in default (guest) user; owner is always created via `/setup` |
| `LOG_LEVEL` | `info` | minimum structured log level; all output is one JSON object per line |
| `UPLOAD_MAX_BYTES` | `104857600` | default max book upload (100MB); runtime-overridden by the owner-set `uploadMaxBytes` instance setting |
| `FONT_UPLOAD_MAX_BYTES` | `20971520` | max font upload (20MB) |
| `AVATAR_UPLOAD_MAX_BYTES` | `2097152` | max avatar upload (2MB) |
| `AUTH_RPM` | `5` | per-client-address + username sliding-window failed login attempt limit |
| `STORAGE_DRIVER` | `localfs` | only driver implemented today; reserved seam for a second `StorageDriver` |
| `AI_PROVIDER` | `openai` | headless default only; used when the user has no stored AI profile |
| `AI_BASE_URL` | provider catalog default | headless default only |
| `AI_API_KEY` | — | headless default only |
| `AI_MODEL` | provider catalog default | headless default only |
| `AI_MAX_OUTPUT_TOKENS` | `8192` | global cap, applied regardless of profile source |
| `AI_RPM` | `6` | per-user sliding-window chat request limit; active-request concurrency remains 1 |
| `AI_TIMEOUT_MS` | `300000` | maximum wall-clock time for one provider chat/embedding operation |

The shipped `docker-compose.yml` sets no environment variables: `NODE_ENV` and `DATA_DIR` are image `ENV`s and everything else runs on defaults; overrides are added as an `environment:` block. Backup = tarball `DATA_DIR`.

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

- **Docker**: multi-stage. The build stage compiles all packages, then deploys the server package alone with production dependencies; the web package is copied as static `dist` output. The final image contains no build toolchain and runs one Node process on one port. The server bundle includes `@bookdock/shared`; `better-sqlite3` is installed in the Linux build stage so its native binary matches the runtime image.
- **docker-compose.yml**: minimal on purpose — image/build reference, port mapping, `./data:/data` mount, `restart: unless-stopped`, no `environment:` block (runtime env comes from image `ENV`s + schema defaults; overrides are added locally). A published registry image uses the same runtime layout and volume contract; Docker Hub is a distribution option, not a runtime dependency.
- **Health**: `GET /api/v1/health` → `{ data: { ok: true } }`; the image `HEALTHCHECK` probes this endpoint (compose does not duplicate it).
- **Response compression**: the server negotiates gzip/Brotli for eligible JSON and static responses while preserving `HEAD`, range/206, and non-compressible EPUB/image binary semantics required by the reader.
- **Persistence**: all mutable state lives under `DATA_DIR`, including SQLite, uploaded files, generated content, progress, and `.jwt-secret`. A cold backup copies the complete directory while the container is stopped; restore replaces the complete directory before startup. The `.jwt-secret` file must be preserved to keep existing sessions valid.
- **Initialization**: database migrations, narrow idempotent schema-compatibility guards, and derived-artifact migrations run during startup. The 0.2.1 release upgrades an existing 0.2.0 `DATA_DIR` through forward migrations; existing 0.1.0 data is not an upgrade target. TXT books are stored as generated EPUB artifacts, so each artifact format change must be versioned in `books.meta` and upgraded atomically before the server starts serving book files. Back up any local data before upgrading, start the new image, and verify `/api/v1/health` plus the web setup/login flow.
- **Registry publishing**: `.github/workflows/docker-publish.yml` publishes `v*` git tags to Docker Hub as both a version tag and `latest`. It requires the repository secrets `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN`; no registry credentials are stored in the repository.

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
| ADR-13 | fonts table two-scope ownership (user/instance) | `docs/local/adr/0013-fonts-two-scope.md` |
| ADR-14 | TTS visible-DOM segments and user-owned online configuration | `docs/local/adr/0014-tts-visible-dom-user-config.md` |
| ADR-15 | unified reader TTS engines and multiple user AI services | `docs/local/adr/0015-tts-unified-engines-multi-services.md` |
| ADR-16 | AI chat gateway and explicit reader context | `docs/local/adr/0016-ai-chat-gateway-and-reader-context.md` |
| ADR-17 | AI lexical index and bounded book retrieval | `docs/local/adr/0017-ai-lexical-index.md` |
| ADR-18 | optional AI embeddings and portable hybrid retrieval | `docs/local/adr/0018-ai-optional-embedding-vectors.md` |
| ADR-19 | persisted AI citations and source navigation | `docs/local/adr/0019-ai-citations-source-navigation.md` |
| ADR-20 | bounded AI search over user-owned book annotations | `docs/local/adr/0020-ai-annotation-search.md` |
| ADR-21 | bounded recipe for historical AI retry | `docs/local/adr/0021-ai-historical-retry-recipe.md` |
| ADR-22 | companion browser extension as an isolated app in the monorepo | `docs/local/adr/0022-companion-extension-monorepo.md` |
| ADR-23 | Readest foliate-js as the EPUB compatibility baseline | `docs/local/adr/0023-readest-foliate-upstream.md` |
| ADR-24 | operation-scoped access tokens for external clients | `docs/local/adr/0024-scoped-access-tokens.md` |

The ADR number always equals the file-number prefix, so `0017-*.md` is ADR-17.
- **Legado media projection boundary**: EPUB chapter responses may contain a `<usehtml>` projection with same-origin `<img>` URLs. Those URLs point to an authenticated, ownership-checked media-resource route that reads only image/audio/video entries from the stored EPUB archive. The standard Legado text renderer handles images but strips or externally opens ordinary audio/video markup, so non-image media is represented by a clickable image payload that invokes Legado's built-in `java.openVideoPlayer(url, title, true)` floating player. This keeps playback available regardless of the app's image-click preference without pretending that a text source can provide inline mixed-content controls or EPUB Media Overlay synchronization.
- **Legado EPUB title de-duplication**: The adapter keeps the chapter `title` because Legado's text reader renders it independently in the chapter header, then removes only the first meaningful EPUB heading whose normalized text exactly matches that title. Leading decorative blocks without text, such as logo images, are ignored while looking for that heading; headings after real prose remain content, so in-chapter section headings are not lost.
- **Legado basic inline style projection**: EPUB text may use `<usehtml>` when the serializer finds safe inline styles or semantic emphasis. Only color, bold, italic, underline, and strikethrough are converted to Android `HtmlCompat`-compatible tags (`font`, `b`, `i`, `u`, `s`); external stylesheets, classes, layout, font declarations, backgrounds, and other full EPUB CSS are intentionally not projected through a Legado text source.
- **Legado source indentation preservation**: The EPUB-to-`<usehtml>` serializer preserves whitespace-only text nodes made of full-width spaces (`U+3000`) because they are meaningful paragraph indentation before inline elements such as colored `<span>` dialogue. Other formatting-only whitespace remains discarded, preventing XHTML pretty-printing from becoming visible in the Reading text layout.
- **EPUB source indentation normalization**: Imported EPUB paragraphs may contain literal full-width leading spaces while Bookdock's reader-layout mode also applies the user's paragraph-indent setting. When layout override is enabled, the reader removes leading whitespace from the first text node of each `p` and applies the configured `text-indent` exactly once; when it is disabled, the original prefix is restored and the book's CSS remains authoritative. The normalization is reversible at runtime, keeps generated TXT EPUBs stable, avoids double indentation in converted TXT-based books, and does not alter the Legado projection, which preserves the source text for its own renderer.
