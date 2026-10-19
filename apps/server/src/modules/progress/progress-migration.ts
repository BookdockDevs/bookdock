import fs from 'node:fs'
import path from 'node:path'

import { and, eq, ne } from 'drizzle-orm'

import { config } from '../../config'
import type { getDb } from '../../db/client'
import { bookStates, bookVersions, libraryMigrationLog, readingArchives, readingSessions } from '../../db/schema'
import { createId } from '../../lib/id'
import { unionLength } from '../../lib/intervals'
import { log } from '../../lib/logger'
import type { ProgressFileData } from '../../lib/progress-file'
import { getStorage } from '../../storage'

export interface ProgressMigrationAnomaly {
  file: string
  reason: string
}

export interface ProgressMigrationReport {
  scanned: number
  imported: number
  skipped: number
  anomalies: ProgressMigrationAnomaly[]
}

export const PROGRESS_MIGRATION_BATCH = 'phase1-progress-database-migration-v2'

export function resolveProgressDirectories(): string[] {
  const dirs = new Set<string>()
  try {
    const storage = getStorage()
    if (storage && typeof (storage as any).getBaseDir === 'function') {
      const baseDir = (storage as any).getBaseDir()
      dirs.add(path.join(baseDir, 'progress'))
      dirs.add(path.join(baseDir, 'files', 'progress'))
      dirs.add(path.join(path.dirname(baseDir), 'progress'))
      return Array.from(dirs).filter((d) => fs.existsSync(d))
    }
    // If storage is initialized/mocked without getBaseDir (e.g. MemoryDriver),
    // do not probe host filesystem
    if (storage) {
      return []
    }
  } catch {
    // Storage might not be initialized yet
  }
  dirs.add(path.join(config.dataDir, 'files', 'progress'))
  dirs.add(path.join(config.dataDir, 'progress'))
  return Array.from(dirs).filter((d) => fs.existsSync(d))
}

export function isProgressMigrationCompleted(db: ReturnType<typeof getDb>): boolean {
  try {
    const row = db.select({ id: libraryMigrationLog.id })
      .from(libraryMigrationLog)
      .where(and(
        eq(libraryMigrationLog.batch, PROGRESS_MIGRATION_BATCH),
        eq(libraryMigrationLog.status, 'completed'),
      )).get()
    return Boolean(row)
  } catch {
    return false
  }
}

export async function importProgressFiles(db: ReturnType<typeof getDb>): Promise<ProgressMigrationReport> {
  if (isProgressMigrationCompleted(db)) {
    return { scanned: 0, imported: 0, skipped: 0, anomalies: [] }
  }

  // Invalidate any erroneous v1 completed log from prior buggy directory scans
  try {
    db.delete(libraryMigrationLog)
      .where(eq(libraryMigrationLog.batch, 'phase1-progress-database-migration'))
      .run()
  } catch {
    // Non-blocking
  }

  const startedAt = Date.now()
  const logId = createId('mlog')
  db.insert(libraryMigrationLog).values({
    id: logId,
    batch: PROGRESS_MIGRATION_BATCH,
    status: 'started',
    details: {},
    startedAt,
  }).run()

  const report: ProgressMigrationReport = {
    scanned: 0,
    imported: 0,
    skipped: 0,
    anomalies: [],
  }

  try {
    const candidateDirs = resolveProgressDirectories()
    const processedKeys = new Set<string>()

    for (const progressDir of candidateDirs) {
      const userEntries = await fs.promises.readdir(progressDir, { withFileTypes: true })
      for (const userEntry of userEntries) {
        if (!userEntry.isDirectory()) continue
        const userId = userEntry.name
        const userPath = path.join(progressDir, userId)
        const fileEntries = await fs.promises.readdir(userPath, { withFileTypes: true })
        for (const fileEntry of fileEntries) {
          if (!fileEntry.isFile() || !fileEntry.name.endsWith('.json')) continue
          const fileKey = `${userId}/${fileEntry.name}`
          if (processedKeys.has(fileKey)) continue
          processedKeys.add(fileKey)

          const bookVersionId = fileEntry.name.slice(0, -5)
          const filePath = path.join(userPath, fileEntry.name)
          report.scanned += 1

          let content: string
          try {
            content = await fs.promises.readFile(filePath, 'utf-8')
          } catch (err) {
            report.anomalies.push({ file: fileKey, reason: `Cannot read file: ${err}` })
            continue
          }

          let data: ProgressFileData
          try {
            data = JSON.parse(content) as ProgressFileData
          } catch (err) {
            report.anomalies.push({ file: fileKey, reason: `Malformed JSON: ${err}` })
            continue
          }

          const readFraction = unionLength(data.intervals ?? [])
          const updatedAt = typeof data.updatedAt === 'number' ? data.updatedAt : Date.now()

          // Check if already in book_states
          const existing = db.select({
            userId: bookStates.userId,
            progressData: bookStates.progressData,
            updatedAt: bookStates.updatedAt,
          }).from(bookStates).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookVersionId))).get()

          if (existing?.progressData != null) {
            report.skipped += 1
            continue
          }
          if (!existing && !db.select({ id: bookVersions.id }).from(bookVersions).where(eq(bookVersions.id, bookVersionId)).get()) {
            report.anomalies.push({ file: fileKey, reason: `Version ${bookVersionId} does not exist in database` })
            continue
          }
          db.transaction((tx) => {
            if (existing) {
              tx.update(bookStates).set({
                progressData: data,
                readFraction,
                updatedAt: Math.max(existing.updatedAt, updatedAt),
              }).where(and(eq(bookStates.userId, userId), eq(bookStates.bookVersionId, bookVersionId))).run()
            } else {
              tx.insert(bookStates).values({
                userId, bookVersionId, readStatus: 'reading',
                percent: typeof data.percent === 'number' ? data.percent : 0,
                cfi: typeof data.cfi === 'string' ? data.cfi : null,
                chapter: typeof data.chapter === 'string' ? data.chapter : null,
                progressData: data, readFraction, updatedAt,
              }).run()
            }
            // SQL migration runs before legacy files are imported. Preserve that
            // missing baseline only while no precise ledger contributions exist.
            const archive = tx.select().from(readingArchives).where(and(
              eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, bookVersionId),
            )).get()
            const canonical = tx.select({ id: readingSessions.id }).from(readingSessions).where(and(
              eq(readingSessions.userId, userId), eq(readingSessions.bookId, bookVersionId), ne(readingSessions.source, 'legacy'),
            )).get()
            if (archive && archive.legacyIntervals.length === 0 && !canonical) {
              tx.update(readingArchives).set({ legacyIntervals: data.intervals ?? [] }).where(and(
                eq(readingArchives.userId, userId), eq(readingArchives.bookVersionId, bookVersionId),
              )).run()
            }
          })
          report.imported += 1
        }
      }
    }

    const hasAnomalies = report.anomalies.length > 0
    const finalStatus = hasAnomalies ? 'failed' : 'completed'

    db.update(libraryMigrationLog).set({
      status: finalStatus,
      finishedAt: Date.now(),
      details: { ...report, anomalies: report.anomalies },
    }).where(eq(libraryMigrationLog.id, logId)).run()

    if (hasAnomalies) {
      log('warn', 'progress.migration.incomplete', {
        durationMs: Date.now() - startedAt,
        meta: { ...report },
      })
    } else {
      log('info', 'progress.migration.completed', {
        durationMs: Date.now() - startedAt,
        meta: { ...report },
      })
    }
  } catch (err) {
    db.update(libraryMigrationLog).set({
      status: 'failed',
      finishedAt: Date.now(),
      details: { ...report, error: err instanceof Error ? err.message : String(err) },
    }).where(eq(libraryMigrationLog.id, logId)).run()
    log('error', 'progress.migration.failed', {
      durationMs: Date.now() - startedAt,
      error: err,
    })
    throw err
  }

  return report
}
