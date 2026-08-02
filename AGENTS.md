# Project Rules

## Scope
- Self-hosted web e-book library. pnpm monorepo, single Docker container deployment, data volume persistence.
- Three packages: `@bookdock/shared` (contracts/types/zod), `@bookdock/server` (Hono), `@bookdock/web` (React).

## Architecture

Authoritative architecture document: `docs/architecture.md`. Change the doc first, then the code.

- Server organized by domain modules (`modules/{auth,books,shelves,tags,progress}`), thin routes, service orchestration, no cross-module service imports.
- Key interfaces first: `StorageDriver` (storage/), `FormatRegistry` (formats/). New storage/format = implement interface + register, no service changes.
- Don't extract `@bookdock/db` or `@bookdock/storage` yet. Cohesive modules + interfaces suffice. Extract when a second consumer (CLI/Tauri) appears.
- Multi-user is live: `users` table + `userId` FK on all user-data tables, per-user libraries, owner/member roles. **Every new table must include `userId`** (instance-level tables like `instance_settings` are the documented exception, see ADR-12). All single-entity queries must verify row ownership by `userId`; shared content-hash blobs must be reference-checked before physical deletion.

## Setup commands

### Install dependencies
```bash
pnpm install
```

### Server dev
```bash
pnpm --filter @bookdock/server dev
```
`tsx watch src/index.ts`, defaults to http://localhost:3000.

### Web dev
```bash
pnpm --filter @bookdock/web dev
```
Vite dev, defaults to http://localhost:5173, `/api` proxy to :3000.

### Both
```bash
pnpm dev
```

## Pre-commit setup

```bash
pnpm lint      # OxLint across all packages
pnpm typecheck # tsc --noEmit across all packages
pnpm test      # Vitest
```

Future: `lint-staged` hooks for affected packages.

## Dev environment tips

1. Use `pnpm dlx turbo run where <project_name>` to jump to a package instead of scanning with `ls`.
2. Run `pnpm install --filter <project_name>` to add the package to your workspace so Vite, ESLint, and TypeScript can see it.
3. Check the name field inside each package's package.json to confirm the right name—skip the top-level one.
4. All API routes must use `/api/v1/...` prefix.
5. Every new table must include `userId` FK (multi-user pre-wired).
6. When backend routes, request/response schemas change, update `@bookdock/shared` contract types and schemas.
7. After modifying shared types, run `pnpm typecheck --filter @bookdock/server --filter @bookdock/web` to verify both sides compile.
8. **Language**: code, comments, log messages, commit messages, and PR titles/descriptions must all be in English (project targets internationalization). UI strings stay Chinese for now, structured to be extractable.
9. **Do not create report/summary files** (e.g. `CHANGES_SUMMARY.md`, `TASK_REPORT.md`) unless explicitly requested by the user.
10. Consider cross-platform compatibility: code runs in a Linux Docker container in production, but development happens on Windows. Avoid platform-specific assumptions; use `node:path` and Drizzle/SQLite abstractions, not shell fragments in code.

### KISS & First Principles

Follow first principles: identify the real problem, required behavior, and smallest useful change before writing code. Do not pile on features, configuration switches, abstractions, dependencies, or compatibility layers unless they directly solve the current problem with clear evidence of need.

**Inline first**: Do not extract helper functions unless:
- **High reuse**: identical logic appears in ≥3 locations
- **High complexity**: inlining makes the main function >50 lines or severely derails the flow

**No fragmentation**: Do not split continuous linear logic (single API call, simple form validation, one-time data formatting) into tiny functions. Handle edge cases, error catching, and logging directly in the main function.

**Refactoring constraint**: When modifying existing code, do not change function structure or extract new helpers unless the existing code already violates the above rules.

## Coding Conventions

### General
- Keep edits minimal and aligned with existing repository style.
- Do not modify unrelated files.
- Shared types/validation must come from `@bookdock/shared`. Never duplicate domain types in `/web` or `/server`.
- Primary keys: nanoid strings (`server/lib/id.ts`), never auto-increment integers.
- Timestamps: INTEGER unix ms.
- Unstable/rarely-queried fields go into JSON columns (e.g. `books.meta`). Stable, frequently-queried fields get dedicated columns.
- Auth: JWT in HttpOnly Cookie `bd_token` (SameSite=Strict); guard verifies then loads the fresh user from DB (short-TTL cache) so role/disabled changes take effect immediately. First run always requires creating the owner via `/setup`; afterwards the owner can toggle open registration and guest access (stored in `instance_settings`, runtime-editable). Guest access injects the default user and is rejected by owner-only endpoints. See `docs/local/dev/accounts.md`.
- Security: sensitive config (JWT_SECRET etc.) from env only, never committed. Server config validated via zod. Upload size limits enforced.

### API response shapes (authoritative)

Success: `{ data: T }`
Error: `{ error: { code: string, message: string, details?: unknown } }`

Error codes live in `shared/errors.ts` (string enum); HTTP status mapping is centralized there, never scattered across routes.

```ts
// shared/errors.ts
export const ErrorCode = {
  BOOK_NOT_FOUND: 'BOOK_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  UPLOAD_TOO_LARGE: 'UPLOAD_TOO_LARGE',
  // ...
} as const
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode]

// success response
return c.json({ data: book }, 200)
// error response (usually produced by error middleware, not in routes)
return c.json({ error: { code: 'BOOK_NOT_FOUND', message: 'book not found' } }, 404)
```

### File & naming
- Files/directories: kebab-case (`books.routes.ts`, `auth.store.ts`).
- React components: PascalCase (`BookCard.tsx`, `UploadDialog.tsx`).
- Non-component modules: camelCase (`api/client.ts`, `lib/utils.ts`).
- Types/interfaces: PascalCase (`Book`, `ApiResponse<T>`).
- Functions/variables: camelCase.

### Component conventions
- One component per file, filename matches component name (`BookCard.tsx` → `export default function BookCard`).
- Page-level components in `pages/`, feature components in `features/<name>/components/`, shared UI in `components/ui/`.
- Component props: `interface` at file top, named `{ComponentName}Props`.
- Never use `useEffect` for data fetching — use TanStack Query hooks.
- Never use `useState` for derived data — use `useMemo`.

Example component skeleton:
```tsx
interface BookCardProps {
  book: Book
  onOpen?: (id: string) => void
}

export default function BookCard({ book, onOpen }: BookCardProps) {
  return (
    <article className="flex h-full flex-col gap-2 rounded-lg border border-slate-200 p-4 hover:shadow-md">
      {/* ... */}
    </article>
  )
}
```

### State management
- **Server state** (API data): TanStack Query hooks in `api/hooks/`.
- **Client state** (theme, UI preferences, auth token): Zustand stores in `stores/`.
- **URL state** (search params, pagination, filters): TanStack Router searchParams schema.
- Never store API data in Zustand — Query cache is the single source of truth.

### Import order
Grouped with blank lines between groups, alphabetically within each group:
1. Standard library (`node:*`)
2. Third-party (`react`, `hono`, `@tanstack/*`)
3. Workspace packages (`@bookdock/*`)
4. Internal relative paths (`@/`, `../`, `./`)

```ts
import { promises as fs } from 'node:fs'

import { Hono } from 'hono'

import type { Book } from '@bookdock/shared'

import { booksService } from './books.service'
```

### Comments
- Do not write comments explaining "what" the code does (code should be self-documenting).
- Only write comments for "why" something is non-obvious (e.g., performance rationale, edge case trade-offs).
- Never write `// TODO` without an issue number or owner.

### Styling
- Use Tailwind CSS 4 utility classes exclusively. No custom CSS unless Tailwind cannot express it.
- Class order: layout → sizing → spacing → background/border → typography → interaction (hover/focus/active).
- Use Tailwind semantic color palette (`slate-*`, `blue-*`), never hardcoded color values.

### Error handling
- Server: service layer throws `AppError(code, message?)`, routes layer catches, `error.ts` middleware converts to `{ error: { code, message } }`.
- Frontend: TanStack Query `onError` or global `QueryClient` defaultOptions for toast/notifications.
- Never call `c.json()` in service layer — that's the routes' responsibility.

### Testing
- Server: unit tests for service layer (mock db/storage), integration tests for routes (hono/testing).
- Web: component tests with `@testing-library/react`, hook tests with `renderHook`.
- Mock data constructed from `@bookdock/shared` domain types, never redefine types.

## Testing instructions

- CI plan in `.github/workflows`.
- `pnpm turbo run test --filter <project_name>` runs all checks for that package; `pnpm test` from package root.
- Focus a single test: `pnpm vitest run -t "<test name>"`.
- Keep the full suite green. Add or update tests for changed code.
- After moving files or changing imports, run `pnpm lint --filter <project_name>` to confirm OxLint and TS pass.

## Git & PR instructions

### Branching strategy (GitHub Flow)

| Branch | Purpose | Merge method |
|--------|---------|:------------:|
| `main` | Production-ready, always deployable | — |
| `feature/<epic-name>` | New feature (e.g. `feature/read-status`) | Squash merge |
| `fix/<brief-description>` | Bug fix (e.g. `fix/download-button`) | Squash merge |
| `chore/<brief-description>` | Refactor / tooling / config (e.g. `chore/update-deps`) | Squash merge |

- All branches merge into `main` via PR.
- Squash merge keeps `main` history clean — one commit per feature/fix.
- Branch names: kebab-case, all lowercase.

### Commits & PRs

- **Commit messages**: conventional commits — `feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`, `perf:`. Example: `feat(server): add book upload endpoint`.
- **PR title format**: `[<project_name>] <Title>` (e.g. `[server] support book upload`).
- Always run `pnpm lint`, `pnpm typecheck`, and `pnpm test` before committing.
- Do not commit, push, or open PRs unless explicitly asked.

## Communication

- Report findings/risks first, then change summary.

## Encoding

- Source/config text files: UTF-8 without BOM.
- Do not write BOM into TS/JSON files. Watch encoding when using Windows PowerShell.