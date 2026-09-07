# Bookdock

A self-hosted web e-book library. pnpm monorepo — `@bookdock/shared` (contracts/types/zod), `@bookdock/server` (Hono), `@bookdock/web` (React). Single-container Docker deployment with persistent data volume.

## Documentation

| Doc | Purpose |
|---|---|
| [`../CHANGELOG.md`](../CHANGELOG.md) | User-facing release history and version-specific upgrade notes |
| [`architecture.md`](./architecture.md) | Authoritative architecture blueprint (design principles, module layout, schema, API, ADRs) |
| [`plan.md`](./plan.md) | Curated public roadmap (P0/P1/P2/P3) |

> Private development tracking lives under `docs/local/` (git-ignored): full dev-log plan, ADRs, and domain glossary.

## Quick start

```bash
pnpm install
pnpm dev                 # server on :3000, web on :5173
pnpm lint
pnpm typecheck
pnpm test
```

See [`docs/architecture.md`](./architecture.md) for the full blueprint.
