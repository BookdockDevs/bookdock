import { DOMParser } from '@xmldom/xmldom'
import JSZip from 'jszip'

import { loadEpubSpineMarkup } from '../../formats/epub'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { convertTxtToEpub, type TxtToEpubCover } from '../../lib/txt-to-epub'

import { bufferFromStream, getActiveBook } from './books.service'
import { applyEpubChapterReplacements, applyChapterReplacements, loadEffectiveBookReplacementRules, type BookReplacementRule } from './replacement-rules'

import { extractEpubTextBlocks, formatTxtBlocks, type TxtBlock } from './txt-layout'

export type ExportRule = BookReplacementRule
export { applyChapterReplacements } from './replacement-rules'

// Reverse of txt-to-epub's escapeXml — the generated XHTML only ever contains
// these five entities, so a direct map is lossless.
export function unescapeXml(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|apos);/g, (m, name: string) =>
    ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" })[name] ?? m)
}

// Extract the chapter's text runs from its generated XHTML: one h1 (the
// chapter title) plus one <p> per paragraph. The XHTML is server-generated
// (txt-to-epub.buildChapterXhtml), so `<h1>..</h1>` / `<p>..</p>` with plain
// escaped text is the whole shape — the same run sequence the reader's
// TreeWalker sees, which keeps point-patch textOffsets aligned (they count
// from the section start, title included).
export function extractChapterRuns(xhtml: string): { title: string; paragraphs: string[] } {
  const titles: string[] = []
  const paragraphs: string[] = []
  const re = /<(h1|p)>([^<]*)<\/\1>/g
  let m: RegExpExecArray | null
  while ((m = re.exec(xhtml))) {
    const text = unescapeXml(m[2]!)
    if (m[1] === 'h1') titles.push(text)
    else paragraphs.push(text)
  }
  return { title: titles.join(''), paragraphs }
}

export function assembleTxt(chapters: { title: string; paragraphs: string[] }[]): string {
  return formatTxtBlocks(chapters.flatMap((chapter): TxtBlock[] => [
    { kind: 'heading', text: chapter.title },
    ...chapter.paragraphs.map((text): TxtBlock => ({ kind: text.includes('\n') ? 'structured' : 'paragraph', text })),
  ]))
}

// The shared middle of export.txt / export.epub: read the stored EPUB's
// chapters (server-generated, spine order), apply the given rules per chapter
// and return the replaced runs. `rules` is [] for the plain (原文) variant.
export async function extractReplacedChapters(
  buffer: Buffer,
  rules: ExportRule[],
): Promise<{ title: string; paragraphs: string[] }[]> {
  const zip = await JSZip.loadAsync(buffer)
  const opfEntry = zip.file('OEBPS/content.opf')
  if (!opfEntry) throw new AppError('BOOK_FILE_MISSING', 'Book file is missing its package document')
  const opf = await opfEntry.async('string')
  // The OPF is server-generated: manifest id→href, then the spine order.
  const manifest = new Map<string, string>()
  for (const m of opf.matchAll(/<item\s+id="([^"]+)"\s+href="([^"]+)"[^>]*>/g)) {
    manifest.set(m[1]!, m[2]!)
  }
  const hrefs: string[] = []
  for (const m of opf.matchAll(/<itemref\s+idref="([^"]+)"[^>]*\/?>/g)) {
    const href = manifest.get(m[1]!)
    if (href) hrefs.push(href)
  }

  const chapters: { title: string; paragraphs: string[] }[] = []
  for (const href of hrefs) {
    const entry = zip.file(`OEBPS/${href}`)
    if (!entry) continue
    const xhtml = await entry.async('string')
    const { title, paragraphs } = extractChapterRuns(xhtml)
    const runs = [{ text: title }, ...paragraphs.map((p) => ({ text: p }))]
    // Patches anchor to the section's full zip path ("OEBPS/chapter-XXXX.xhtml"
    // — the id foliate exposes as book.sections[i].id and the reader compares
    // against). Match that, not the bare OPF href, or every point patch
    // silently misses here while working in the reader.
    applyChapterReplacements(runs, rules, `OEBPS/${href}`)
    chapters.push({ title: runs[0]!.text, paragraphs: runs.slice(1).map((r) => r.text) })
  }
  return chapters
}

// Regenerating EPUB remains limited to TXT-source books.
async function getExportableTxtBook(userId: string, bookId: string, opts?: { showHidden?: boolean }) {
  const book = await getActiveBook(userId, bookId, opts)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Exports are only supported for TXT books')
  }
  return book
}

// Load the rules and read the stored EPUB for an export. `plain` skips the
// rule query entirely — the 原文 variant never applies replacements.
async function loadExportInput(userId: string, bookId: string, plain: boolean, opts?: { showHidden?: boolean }) {
  const book = await getActiveBook(userId, bookId, opts)
  const rules: ExportRule[] = plain ? [] : await loadEffectiveBookReplacementRules(userId, bookId)
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  }
  const buffer = await bufferFromStream(await storage.get(book.filePath))
  return { book, rules, buffer }
}

// Uploaded TXT bytes are not retained: its original export is recovered text.
// Apply rules before adding indentation so point-patch offsets stay meaningful.
export async function exportTxtBook(
  userId: string,
  bookId: string,
  plain = false,
  opts?: { showHidden?: boolean },
): Promise<{ text: string; title: string; edited: boolean }> {
  const { book, rules, buffer } = await loadExportInput(userId, bookId, plain, opts)
  let text: string
  if (book.format === 'txt') {
    text = assembleTxt(await extractReplacedChapters(buffer, rules))
  } else {
    let sections: Awaited<ReturnType<typeof loadEpubSpineMarkup>>
    try {
      sections = await loadEpubSpineMarkup(buffer)
    } catch {
      throw new AppError('BOOK_FILE_MISSING', 'Book package or spine document is missing or invalid')
    }
    const parts: string[] = []
    for (const section of sections) {
      const doc = new DOMParser().parseFromString(section.markup, 'application/xml')
      applyEpubChapterReplacements(doc, rules, section.href)
      const part = formatTxtBlocks(extractEpubTextBlocks(doc, section.coverPage)).trimEnd()
      if (part) parts.push(part)
    }
    text = parts.length ? parts.join('\n\n\n') + '\n' : ''
  }
  if (!text.trim()) throw new AppError('NO_EXPORTABLE_TEXT', 'Book has no readable text to export')
  return { text, title: book.title, edited: rules.some((r) => r.effectiveEnabled) }
}

// TXT-source EPUBs are regenerated with current metadata and cover; uploaded
// EPUBs must keep their package structure and use the stored-file endpoint.
export async function exportEpubBook(
  userId: string,
  bookId: string,
  plain = false,
  opts?: { showHidden?: boolean },
): Promise<{ buffer: Buffer; title: string; edited: boolean }> {
  await getExportableTxtBook(userId, bookId, opts)
  const { book, rules, buffer } = await loadExportInput(userId, bookId, plain, opts)
  const chapters = await extractReplacedChapters(buffer, rules)

  // A missing or unreadable cover never fails the export (silent degradation).
  let cover: TxtToEpubCover | undefined
  if (book.coverKey) {
    const ext = book.coverKey.split('.').pop()?.toLowerCase()
    if (ext === 'jpg' || ext === 'png' || ext === 'webp') {
      try {
        const storage = getStorage()
        if (await storage.exists(book.coverKey)) {
          cover = { data: await bufferFromStream(await storage.get(book.coverKey)), ext }
        }
      } catch {
        // keep the export going without a cover
      }
    }
  }

  const bookmeta = (book.meta as Record<string, unknown> | undefined)?.bookmeta as { language?: string } | undefined
  const epub = await convertTxtToEpub(
    { title: book.title, author: book.author || undefined, id: book.id, language: bookmeta?.language },
    chapters.map((c, i) => ({ id: `ch-${i}`, title: c.title, level: 1 })),
    (i) => chapters[i]!.paragraphs.join('\n\n'),
    cover,
  )
  return { buffer: epub, title: book.title, edited: rules.some((r) => r.effectiveEnabled) }
}
