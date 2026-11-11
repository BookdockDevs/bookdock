# Bookdock

A self-hosted web e-book library. pnpm monorepo — `@bookdock/shared` (contracts/types/zod), `@bookdock/server` (Hono), `@bookdock/web` (React), and `@bookdock/extension` (MV3 browser extension). Single-container Docker deployment with persistent data volume.

## Documentation

| Doc | Purpose |
|---|---|
| [`../CHANGELOG.md`](../CHANGELOG.md) | User-facing release history and version-specific upgrade notes |
| [`architecture.md`](./architecture.md) | Authoritative architecture blueprint (design principles, module layout, schema, API, ADRs) |
| [`../apps/extension/README.md`](../apps/extension/README.md) | Companion browser extension installation, workflow, i18n, and packaging |
| [Dictionaries](./architecture.md#personal-dictionaries) | MDict imports, personal and instance scope, resource isolation and file ownership |
| [Selection toolbar](./architecture.md#selection-toolbar-preferences) | Action ordering, visibility and account preference synchronization |
| [Selection translation](./architecture.md#selection-translation) | AI service selection, streamed results and preference ownership |
| [Reading data](./architecture.md#reading-ledger-maturity-2026-10-18) | Current reading-history ownership, timing, correction, statistics, transfer, personal-archive retention boundaries, and `all` / `time` / `notes` scoped archive deletion (v0.8.1) |
| [Device books and the unified shelf](./architecture.md#dual-library-client-foundation) | Device vault storage, source-scoped references, the unified bookshelf direction (v0.8.0), and connected-service boundaries |
| [Companion extension](./architecture.md#63-companion-browser-extension) | Independently versioned uploader, scoped access tokens, drop/upload workflow, and separation from the shelved local-reader prototype |
| [Book transfer and offline cache](./architecture.md#explicit-local-server-upload-migration-and-browser-full-book-caching) | Explicit device-to-server upload migration (v0.8.1), removable server-book full-book cache, offline write replay, and the boundaries that keep both sources independent |

## Quick start

```bash
pnpm install
pnpm dev                 # server on :18423, web on :5173
pnpm build:extension     # build and pack Chrome/Firefox extension ZIPs
pnpm lint
pnpm typecheck
pnpm test
```

See [`docs/architecture.md`](./architecture.md) for the full blueprint.
