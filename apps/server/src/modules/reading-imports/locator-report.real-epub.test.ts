import { promises as fs } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createEpubCfiTextRange, resolveEpubCfiTextRange } from '../books/epub-cfi-position'
import { decodeArchiveText, extractEpubStartup, openEpubArchive, readArchiveEntryBuffer, type EpubArchive, type EpubByteSource } from '../../formats/epub-index'
import { buildLocatorIndexFromMarkup, locateNote, type LocatorChapter } from './locator-report'

/** Real-book verification for the locator report (step 5). It needs an actual
 * EPUB whose text the user also has in WeRead, so it is opt-in rather than part
 * of the default suite:
 *
 *   BOOKDOCK_SAMPLE_EPUB='/path/to/book.epub' pnpm --filter @bookdock/server test locator-report.real-epub
 *
 * The checks are about the engine's behaviour on real markup (nested spans,
 * full-width punctuation, ruby, paragraphs split across elements), not about
 * one specific title. */
const samplePath = process.env.BOOKDOCK_SAMPLE_EPUB

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

async function loadChapters(filePath: string): Promise<{
  entries: Array<{ spineIndex: number; href: string; markup: string }>
  archive: EpubArchive
}> {
  const archive = await openEpubArchive(await byteSource(filePath))
  const startup = await extractEpubStartup(archive)
  const entries: Array<{ spineIndex: number; href: string; markup: string }> = []
  for (const [spineIndex, item] of startup.spine.entries()) {
    if (!item.linear || !/html|xml/i.test(item.mediaType)) continue
    const entry = archive.byPath.get(item.path) ?? archive.byLowerPath.get(item.path.toLowerCase())
    if (!entry) continue
    const data = await readArchiveEntryBuffer(archive, entry, entry.size)
    entries.push({ spineIndex, href: item.path, markup: decodeArchiveText(data) })
  }
  return { entries, archive }
}

function sentences(chapter: LocatorChapter): string[] {
  return chapter.text
    .split(/[。！？!?]/)
    .map((value) => value.trim())
    .filter((value) => value.length >= 16 && value.length <= 80)
}

let cached: Promise<{ entries: Array<{ spineIndex: number; href: string; markup: string }>; index: ReturnType<typeof buildLocatorIndexFromMarkup> }> | null = null

function loadSample() {
  const filePath = path.resolve(samplePath!)
  cached ??= (async () => {
    const { entries } = await loadChapters(filePath)
    return { entries, index: buildLocatorIndexFromMarkup(entries) }
  })()
  return cached
}

describe.skipIf(!samplePath)('locator report on a real EPUB', () => {
  it('parses the whole book and locates its own sentences exactly', async () => {
    const { entries, index } = await loadSample()
    const markupByHref = new Map(entries.map((entry) => [entry.href, entry.markup]))

    expect(index.chapters.length).toBeGreaterThan(20)
    expect(index.textLength).toBeGreaterThan(100_000)

    // Walk every chapter, take up to 3 quotable sentences from each, and treat
    // them as if they were imported highlights with no chapter hint.
    const candidates: Array<{ chapter: number; text: string }> = []
    for (const [chapterIndex, chapter] of index.chapters.entries()) {
      for (const text of sentences(chapter).slice(0, 3)) candidates.push({ chapter: chapterIndex, text })
    }
    expect(candidates.length).toBeGreaterThan(100)

    let located = 0
    let ambiguous = 0
    let missing = 0
    let roundTripFailures = 0
    for (const candidate of candidates) {
      const result = locateNote({ recordId: 'probe', kind: 'highlight', text: candidate.text, chapter: null }, index)
      if (result.state === 'ambiguous') { ambiguous += 1; continue }
      if (result.state === 'missing') { missing += 1; continue }
      located += 1
      const chapter = index.chapters[result.chapter!]!
      const markup = markupByHref.get(chapter.href)!
      const cfi = createEpubCfiTextRange(markup, chapter.spineIndex, result.start!, result.end!)
      const resolved = cfi ? resolveEpubCfiTextRange(markup, cfi) : null
      if (!resolved || resolved.start !== result.start || resolved.end !== result.end) roundTripFailures += 1
    }

    // A book's own sentences are, by construction, exactly present: nearly all
    // must locate, and every located one must survive the CFI round trip.
    expect(roundTripFailures).toBe(0)
    expect(located / candidates.length).toBeGreaterThan(0.85)
    expect(missing).toBeLessThan(candidates.length * 0.1)
    console.log(`[real-epub] chapters=${index.chapters.length} chars=${index.textLength} probes=${candidates.length} located=${located} ambiguous=${ambiguous} missing=${missing}`)
  }, 180_000)

  it('keeps locating after punctuation and spacing are mangled', async () => {
    const { index } = await loadSample()
    const samples: string[] = []
    for (const chapter of index.chapters) {
      const found = sentences(chapter).find((value) => value.length >= 20)
      if (found) samples.push(found)
      if (samples.length >= 12) break
    }
    expect(samples.length).toBeGreaterThan(5)

    const warnings: Record<string, number> = {}
    let located = 0
    for (const sample of samples) {
      const mangled = sample
        .replace(/，/g, ', ')
        .replace(/。/g, '.')
        .replace(/“/g, '"')
        .replace(/”/g, '"')
        .replace(/、/g, ',')
      const result = locateNote({ recordId: 'probe', kind: 'highlight', text: mangled, chapter: null }, index)
      if (result.state !== 'located') continue
      located += 1
      const chapter = index.chapters[result.chapter!]!
      const actual = chapter.text.slice(result.start!, result.end!)
      // Restoring the source's own punctuation must give back the book's text,
      // not a prefix or an over-long span.
      // Restoring the source's punctuation must give back the book's own text,
      // not a prefix, an over-long span or a neighbour's closing mark.
      if (actual !== sample) {
        warnings.mismatch = (warnings.mismatch ?? 0) + 1
        if (warnings.mismatch <= 3) console.log('[mismatch]', JSON.stringify({ mangled, sample, actual }))
      }
      if (result.warning) warnings[result.warning] = (warnings[result.warning] ?? 0) + 1
    }
    expect(located).toBeGreaterThanOrEqual(samples.length - 1)
    expect(warnings.mismatch ?? 0).toBe(0)
    console.log(`[real-epub] mangled probes=${samples.length} located=${located} warnings=${JSON.stringify(warnings)}`)
  }, 180_000)

  it('reports a missing quote and an ambiguous one honestly', async () => {
    const { index } = await loadSample()

    expect(locateNote({ recordId: 'p1', kind: 'highlight', text: '这句话在这本书里绝对不存在，只是用来测试的。', chapter: null }, index))
      .toMatchObject({ state: 'missing', reason: 'not-found' })

    // A short but real phrase like "他说" repeats constantly in a novel; it must
    // come back ambiguous rather than silently picking the first hit.
    const common = '他说'
    const result = locateNote({ recordId: 'p2', kind: 'highlight', text: common, chapter: null }, index)
    expect(result.state).toBe('ambiguous')
    expect(result.hits).toBeGreaterThan(1)
  }, 180_000)
})
