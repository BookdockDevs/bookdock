import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { migrate } from 'drizzle-orm/better-sqlite3/migrator'

export const BOOK_RETIREMENT_TIMESTAMP = 1791700000000

/** Keep the async data/file bridge outside Drizzle's synchronous SQL transaction. */
export function migrateBeforeBookRetirement(
  db: Parameters<typeof migrate>[0],
  options: Parameters<typeof migrate>[1],
) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'bookdock-migration-stage-'))
  try {
    fs.mkdirSync(path.join(scratch, 'meta'))
    const journal = JSON.parse(fs.readFileSync(path.join(options.migrationsFolder, 'meta/_journal.json'), 'utf8')) as {
      entries: Array<{ when: number; tag: string }>
    }
    journal.entries = journal.entries.filter((entry) => entry.when < BOOK_RETIREMENT_TIMESTAMP)
    for (const entry of journal.entries) {
      fs.copyFileSync(path.join(options.migrationsFolder, `${entry.tag}.sql`), path.join(scratch, `${entry.tag}.sql`))
    }
    fs.writeFileSync(path.join(scratch, 'meta/_journal.json'), JSON.stringify(journal))
    migrate(db, { ...options, migrationsFolder: scratch })
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true })
  }
}
