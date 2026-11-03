import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ImportProposal } from './reading-imports.service'

import { decodeArchiveText, extractEpubStartup, openEpubArchive, readArchiveEntryBuffer, type EpubByteSource } from '../../formats/epub-index'
import { buildLocatorIndexFromMarkup, locateNote } from './locator-report'
import { fetchWereadProposal } from './weread-import'

/** The gap the step-5 record calls out: every earlier check fed the engine a
 *  real book with *synthetic* notes. This one runs the real import path (WeRead
 *  gateway → proposal) against a real EPUB, so it is opt-in twice over:
 *
 *    BOOKDOCK_WEREAD_KEY='wrk-...' \
 *    BOOKDOCK_SAMPLE_EPUB='/path/to/book.epub' \
 *    pnpm --filter @bookdock/server test locator-report.real-weread
 *
 *  The key is a short-lived credential, so the test skips rather than fails
 *  when it is absent or expired. */
const wereadKey = process.env.BOOKDOCK_WEREAD_KEY
const samplePath = process.env.BOOKDOCK_SAMPLE_EPUB
const title = process.env.BOOKDOCK_WEREAD_TITLE ?? '一点也不超级的机器人大战'
/** A whole-notebook import is ~90 books × 2 requests, which is pointless to
 *  repeat while iterating on the engine. The proposal is cached under `.tmp/`
 *  (git-ignored, never shipped) and reused until deleted. It holds the reader's
 *  own notes, which is exactly why it must not be committed. */
const cachePath = process.env.BOOKDOCK_WEREAD_CACHE ?? path.resolve(process.cwd(), '.tmp/weread-notes.json')

async function loadProposal(): Promise<ImportProposal | null> {
  try {
    return JSON.parse(await fs.readFile(cachePath, 'utf8')) as ImportProposal
  } catch {
    if (!wereadKey) return null
  }
  const proposal = await fetchWereadProposal(wereadKey!, 'notes')
  await fs.mkdir(path.dirname(cachePath), { recursive: true })
  await fs.writeFile(cachePath, JSON.stringify(proposal), 'utf8')
  return proposal
}

async function byteSource(filePath: string): Promise<EpubByteSource> {
  const handle = await fs.open(filePath, 'r')
  const stat = await handle.stat()
  return {
    size: stat.size,
    async read(start: number, endInclusive: number) {
      const length = endInclusive - start + 1
      const buffer = Buffer.alloc(length)
      await handle.read(buffer, 0, length, start)
      return buffer
    },
  }
}

describe.skipIf(!samplePath)('locator report on real WeRead notes', () => {
  it('finds the user’s actual highlights in their own copy of the book', async (ctx) => {
    // Whole-notebook import: this is the same code the preview endpoint calls,
    // including the chapter titles the source recorded.
    const proposal = await loadProposal()
    if (!proposal) {
      ctx.skip()
      return
    }
    const book = proposal.books.find((entry) => entry.title.includes(title))
    expect(book, `no notebook titled ${title}`).toBeDefined()
    const notes = proposal.notes.filter((note) => note.sourceBookId === book!.sourceBookId)
    expect(notes.length).toBeGreaterThan(0)

    const archive = await openEpubArchive(await byteSource(samplePath!))
    const startup = await extractEpubStartup(archive)
    const entries: Array<{ spineIndex: number; href: string; markup: string }> = []
    for (const [spineIndex, item] of startup.spine.entries()) {
      if (!item.linear || !/html|xml/i.test(item.mediaType)) continue
      const entry = archive.byPath.get(item.path) ?? archive.byLowerPath.get(item.path.toLowerCase())
      if (!entry) continue
      entries.push({ spineIndex, href: item.path, markup: decodeArchiveText(await readArchiveEntryBuffer(archive, entry, entry.size)) })
    }
    const index = buildLocatorIndexFromMarkup(entries)
    expect(index.chapters.length).toBeGreaterThan(0)

    const tally = { located: 0, ambiguous: 0, missing: 0, conflict: 0 }
    const warnings = { punctuation: 0, crossParagraph: 0, chapterMismatch: 0 }
    const misses: unknown[] = []
    for (const [position, note] of notes.entries()) {
      const located = locateNote({ recordId: String(position), kind: note.kind, text: note.text, chapter: note.chapter }, index)
      tally[located.state] += 1
      if (located.warning === 'punctuation') warnings.punctuation += 1
      if (located.warning === 'cross-paragraph') warnings.crossParagraph += 1
      if (located.warning === 'chapter-mismatch') warnings.chapterMismatch += 1
      if (located.state !== 'located' && misses.length < 5) {
        misses.push({
          text: note.text.slice(0, 40), sourceChapter: note.chapter, state: located.state, hits: located.hits,
          locatedChapter: located.chapter === null ? null : index.chapters[located.chapter]!.heading,
          reason: located.reason,
        })
      }
    }
    console.log('[real-weread]', JSON.stringify({ total: notes.length, tally, warnings, misses }, null, 1))

    // The source and the EPUB may paginate differently, but at least the bulk
    // of real highlights must still be findable in the book's own text.
    expect(tally.located).toBeGreaterThan(notes.length / 2)
    expect(tally.missing).toBeLessThan(notes.length / 2)
  }, 900_000)
})
