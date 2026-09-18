# Bookdock

Self-hosted web e-book library.

## Releases

See [`CHANGELOG.md`](./CHANGELOG.md) for release history and version-specific upgrade notes.

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
docker compose up -d --build
```

Then open `http://localhost:3000` (the server also serves the built web UI) and complete `/setup` to create the owner account — no account is created automatically on first boot.

- `JWT_SECRET` is optional: when omitted, a random secret is generated and persisted to `/data/.jwt-secret`.
- `LOG_LEVEL` defaults to `info`; set it to `debug`, `warn`, or `error` when diagnosing a deployment. Logs are JSON lines on Docker stdout/stderr.
- `DEFAULT_USERNAME` only names the built-in guest account used when guest access is enabled; it does not create an admin.
- The complete `data/` directory is the persistent state. Stop the container before copying it for a cold backup, and restore the complete directory (including the hidden `.jwt-secret` file) before starting the container again.
- `docker compose ps` shows the health status. The health endpoint is `http://localhost:3000/api/v1/health`.

To use a published registry image instead of building from the checkout, set `BOOKDOCK_IMAGE` to the image tag and run `docker compose pull` followed by `docker compose up -d --no-build`. Docker Hub is only needed for this pull-based workflow; building from the repository does not require Docker Hub.

The repository publishes Docker Hub images when a `v*` tag is pushed. To enable that workflow, add `DOCKERHUB_USERNAME` and `DOCKERHUB_TOKEN` as GitHub Actions secrets, create a public Docker Hub repository named `bookdock`, and push a release tag. For example, `v0.2.4` publishes `<dockerhub-username>/bookdock:0.2.4`, `<dockerhub-username>/bookdock:0.2`, and `<dockerhub-username>/bookdock:latest`. Until an image is published, use the source-build command above.

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
