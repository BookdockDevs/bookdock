# Bookdock

Self-hosted web e-book library.

## Quick Start

### Development

```bash
# Install
pnpm install

# Terminal 1: Server (http://localhost:3000)
pnpm --filter @bookdock/server dev

# Terminal 2: Web (http://localhost:5173)
pnpm --filter @bookdock/web dev
```

On first run, open the web UI and complete setup to create the owner account. The owner can later enable guest access (no-sign-in mode) or open registration in Settings.

### Production (Docker)

```bash
docker compose up -d
```

Then open `http://localhost:3000` (the server also serves the built web UI) and complete `/setup` to create the owner account — no account is created automatically on first boot.

- `JWT_SECRET` is optional: when omitted, a random secret is generated and persisted to `/data/.jwt-secret`.
- `DEFAULT_USERNAME` only names the built-in guest account used when guest access is enabled; it does not create an admin.

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
