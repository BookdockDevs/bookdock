# Bookdock

A self-hosted web e-book library. pnpm monorepo — `@bookdock/shared` (contracts/types/zod), `@bookdock/server` (Hono), `@bookdock/web` (React). Single-container Docker deployment with persistent data volume.

## Documentation

| Doc | Purpose |
|---|---|
| [`../CHANGELOG.md`](../CHANGELOG.md) | User-facing release history and version-specific upgrade notes |
| [`architecture.md`](./architecture.md) | Authoritative architecture blueprint (design principles, module layout, schema, API, ADRs) |
| [Reading data](./architecture.md#reading-ledger-maturity-2026-10-18) | Current reading-history ownership, timing, correction, statistics, transfer, and personal-archive retention boundaries |

## Quick start

```bash
pnpm install
pnpm dev                 # server on :18423, web on :5173
pnpm lint
pnpm typecheck
pnpm test
```

See [`docs/architecture.md`](./architecture.md) for the full blueprint.
