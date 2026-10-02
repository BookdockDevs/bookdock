# Project Rules

## Scope
- Self-hosted web e-book library. pnpm monorepo, single Docker container deployment, data volume persistence.
- Three packages: `@bookdock/shared` (contracts/types/zod), `@bookdock/server` (Hono), `@bookdock/web` (React).

## Architecture

Authoritative architecture document: `docs/architecture.md`. For changes to architecture, domain semantics, data models, or interface boundaries, update the relevant documentation before implementation. Small fixes that preserve the existing design do not require architecture edits.

Implementation map: `docs/local/implementation-map.md` — file/flow/pitfall index. Search for task-relevant entries before diving into source; read linked details only as needed. Update relevant entries when architecture changes or a non-obvious pitfall is discovered. Cross-check historical plans against current architecture and code.

- Server organized by domain modules, with thin routes and service orchestration. Avoid adding cross-module service dependencies; use established permission helpers and interfaces. Existing cross-module imports are not a reason for unrelated refactoring.
- Key interfaces first: `StorageDriver` (storage/), `FormatRegistry` (formats/). New storage/format = implement interface + register, no service changes.
- Don't extract `@bookdock/db` or `@bookdock/storage` yet. Cohesive modules + interfaces suffice. Extract when a second consumer (CLI/Tauri) appears.
- Multi-user is live: user-private data must include a `userId` FK and queries must enforce user ownership. Shared content is authorized through library relationships, visibility, and existing permission helpers in `apps/server/src/modules/libraries/library-access.ts`; reading does not require personal ownership or collection. Distinguish read access, personal-data writes, and shared-content mutation.
- Every new table must have an explicit ownership and authorization model. Shared content tables (such as `book_versions`, `content_revisions`, and `blobs`), relationship tables, and instance-level tables do not automatically require `userId`; follow the documented domain model (see ADR-12 for `instance_settings`). Shared content-hash blobs must be reference-checked before physical deletion.

## Workflow and completion

- For bugs, confirm the actual cause and required behavior before making the smallest useful fix. For plans or reviews, deliver the requested analysis without implementing changes unless authorized.
- For implementation tasks, continue through implementation, relevant checks, result inspection, and fixes for failures caused by the change. Report existing or blocked failures separately. Do not claim runtime or browser validation from static review or unit tests.
- Use existing UI patterns and notifications. For interaction changes, verify the actual page behavior when the environment supports it; otherwise report the unverified behavior.
- For permission changes, check relevant roles and rejected paths. For schema/migration changes, verify fresh databases and upgrades from representative existing structures using disposable data.
- Read files, edit task-related files, and run local checks with disposable data autonomously. Use the user's existing authorization for subsequent steps; ask only when a consequential decision remains unresolved, such as expanding scope, modifying real persistent data, or deploying.
- Preserve unrelated working-tree changes. Do not commit, push, open PRs, or deploy unless explicitly authorized; authorization for one action does not imply the others.

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
pnpm lint      # Root OxLint check
pnpm typecheck # Type checks across workspace packages
pnpm test      # Server and Web Vitest suites
```

## Dev environment tips

1. Use `rg` and `rg --files` to locate relevant code. This repository uses pnpm workspace scripts, not Turbo.
2. Install dependencies only when needed; reuse the existing installation for ordinary review and editing tasks.
3. Confirm package names and available commands in the relevant `package.json`; place pnpm package filters before the script name.
4. All API routes must use `/api/v1/...` prefix.
5. Apply the ownership and authorization rules above to new tables and queries.
6. When backend routes, request/response schemas change, update `@bookdock/shared` contract types and schemas.
7. After modifying shared types, run `pnpm --filter @bookdock/shared --filter @bookdock/server --filter @bookdock/web run typecheck` to verify the contract and both consumers compile.
8. **Language**: code, comments, log messages, commit messages, and PR titles/descriptions must all be in English (project targets internationalization). UI strings stay Chinese for now, structured to be extractable.
9. **Do not create report/summary files** (e.g. `CHANGES_SUMMARY.md`, `TASK_REPORT.md`) unless explicitly requested by the user.
10. Consider cross-platform compatibility: code runs in a Linux Docker container in production, but development happens on Windows. Avoid platform-specific assumptions; use `node:path` and Drizzle/SQLite abstractions, not shell fragments in code.

### KISS & First Principles

Follow first principles: identify the real problem, required behavior, and smallest useful change before writing code. Do not pile on features, configuration switches, abstractions, dependencies, or compatibility layers unless they directly solve the current problem with clear evidence of need.

**Inline first**: Keep straightforward linear logic together. Extract helpers when meaningful reuse, complexity, or an independently testable boundary justifies it; do not use repetition counts or line counts as mandatory thresholds.

**No fragmentation**: Do not split continuous linear logic (single API call, simple form validation, one-time data formatting) into tiny functions. Handle edge cases, error catching, and logging directly in the main function.

**Refactoring constraint**: Default to local edits. Structural changes must directly support the task's correctness, readability, or testing; explain non-obvious restructuring and avoid unrelated cleanup.

## Coding Conventions

### General
- Keep edits minimal and aligned with existing repository style.
- Do not modify unrelated files.
- Shared types/validation must come from `@bookdock/shared`. Never duplicate domain types in `/web` or `/server`.
- Primary keys: nanoid strings (`apps/server/src/lib/id.ts`), never auto-increment integers.
- Timestamps: INTEGER unix ms.
- Unstable/rarely-queried fields go into JSON columns (e.g. `books.meta`). Stable, frequently-queried fields get dedicated columns.
- Auth: JWT in HttpOnly Cookie `bd_token` (SameSite=Strict); guard verifies then loads the fresh user from DB (short-TTL cache) so role/disabled changes take effect immediately. First run always requires creating the owner via `/setup`; afterwards the owner can toggle open registration and guest access (stored in `instance_settings`, runtime-editable). Guest access injects the default user and is rejected by owner-only endpoints. See `docs/local/dev/accounts.md`.
- Security: sensitive config (JWT_SECRET etc.) from env only, never committed. Server config validated via zod. Upload size limits enforced.

### API response shapes (authoritative)

Success: `{ data: T }`
Error: `{ error: { code: string, message: string, details?: unknown } }`

Error codes and HTTP status mapping live in `packages/shared/src/errors.ts`, never scattered across routes.

```ts
// packages/shared/src/errors.ts
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
- Do not duplicate derived data in state. Compute simple values directly; use `useMemo` for expensive calculations or when stable references are needed.

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
- **Client state** (theme, UI preferences): Zustand stores in `stores/`. Authentication uses the HttpOnly cookie; do not store its token in client state.
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
- Server: services throw `AppError(code, message?, details?)`; errors propagate to the centralized `error.ts` middleware, which produces the authoritative error response. Catch locally only when recovery or translation is required.
- Frontend: TanStack Query `onError` or global `QueryClient` defaultOptions for toast/notifications.
- Never call `c.json()` in service layer — that's the routes' responsibility.

### Testing
- Server: unit tests for service layer (mock db/storage), integration tests for routes (hono/testing).
- Web: component tests with `@testing-library/react`, hook tests with `renderHook`.
- Mock data constructed from `@bookdock/shared` domain types, never redefine types.

## Testing instructions

- CI plan in `.github/workflows`.
- Start with checks relevant to the changed behavior. Add or update meaningful regression tests for behavior changes; documentation-only edits do not require application tests.
- Run a package suite with `pnpm --filter @bookdock/server test` or `pnpm --filter @bookdock/web test`.
- Focus a test from its package directory with `pnpm exec vitest run <test-file> -t "<test name>"` so package aliases and configuration resolve correctly.
- Run package type checks with `pnpm --filter <package-name> typecheck`. After moving files or changing imports, run affected type checks and the root `pnpm lint`.
- Root `pnpm lint` runs OxLint; package `lint` scripts currently run TypeScript checks. Tests, type checks, and lint are separate checks.
- Keep the full suite green. Before committing, run the full checks below. Broaden or repeat checks when failures, further edits, or unresolved concerns justify it.
- If a check is blocked, report what ran, what did not, and why. Never present an unrun check as passed.

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
- Keep the handoff concise: what changed, what was checked, and any remaining limitation. Distinguish static review, automated checks, and runtime/browser evidence; state whether work remains local, was committed, or was pushed.

## Encoding

- Source/config text files: UTF-8 without BOM.
- Do not write BOM into TS/JSON files. Watch encoding when using Windows PowerShell.
