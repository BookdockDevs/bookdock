# Bookdock

Self-hosted web e-book library.

## Quick Start

### Development

```bash
# Install
pnpm install

# Terminal 1: Server (http://localhost:3000)
AUTH_MODE=off pnpm --filter @bookdock/server dev

# Terminal 2: Web (http://localhost:5173)
pnpm --filter @bookdock/web dev
```

### Production (Docker)

```bash
docker compose up -d
```

Set `JWT_SECRET` environment variable for password auth. Use `AUTH_MODE=off` for no-password mode.

## Commands

```bash
pnpm lint          # Lint all packages
pnpm typecheck     # Type check all packages
pnpm test          # Run all tests
pnpm dev           # Run all dev servers
```

## Data

All data (database + uploaded files) is stored in `data/` directory. Backup by copying this directory.

## Tech Stack

- Frontend: React 19 + Vite + Tailwind CSS 4 + TanStack Router + TanStack Query + Zustand
- Backend: Hono + TypeScript
- Database: SQLite + Drizzle ORM
- Reading Engine: foliate-js (vendored)
- Formats: EPUB, TXT
