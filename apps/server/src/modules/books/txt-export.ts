import JSZip from 'jszip'
import { and, eq, isNull, or } from 'drizzle-orm'

import { applyPointMatch, applyRuleToText, findPointMatch } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { textTransformOverrides, textTransforms } from '../../db/schema'
import { getStorage } from '../../storage'
import { AppError } from '../../middleware/error'
import { convertTxtToEpub, type TxtToEpubCover } from '../../lib/txt-to-epub'

import { bufferFromStream, getActiveBook } from './books.service'

export interface ExportRule {
  id: string
  matchType: 'pattern' | 'point'
  pattern: string | null
  replacement: string | null
  isRegex: boolean
  caseSensitive: boolean
  /** Per-book effective value (override ?? global default for pattern rules) */
  effectiveEnabled: boolean
  spineHref: string | null
  textOffset: number | null
  originalText: string | null
}

// The same filter and override resolution as the transforms module's
// book-scoped list — global pattern rules + this book's scoped rows, with
// effectiveEnabled = override ?? global default for global patterns.
async function loadEffectiveRules(
  db: ReturnType<typeof getDb>,
  userId: string,
  bookId: string,
): Promise<ExportRule[]> {
  const rows = await db.select().from(textTransforms).where(
    and(
      eq(textTransforms.userId, userId),
      or(
        and(eq(textTransforms.matchType, 'pattern'), isNull(textTransforms.bookId)),
        eq(textTransforms.bookId, bookId),
      ),
    ),
  ).all()
  const overrides = await db.select().from(textTransformOverrides).where(
    and(eq(textTransformOverrides.userId, userId), eq(textTransformOverrides.bookId, bookId)),
  ).all()
  const overrideByTransform = new Map(overrides.map((o) => [o.transformId, o]))
  return rows.map((row) => {
    const override = row.matchType === 'pattern' && row.bookId === null
      ? overrideByTransform.get(row.id)
      : undefined
    return {
      id: row.id,
      matchType: row.matchType,
      pattern: row.pattern,
      replacement: row.replacement,
      isRegex: row.isRegex === 1,
      caseSensitive: row.caseSensitive === 1,
      effectiveEnabled: override ? override.enabled === 1 : row.enabled === 1,
      spineHref: row.spineHref,
      textOffset: row.textOffset,
      originalText: row.originalText,
    }
  })
}

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

// Apply the effective rules to one chapter's runs: pattern rules first
// (per run, rule order — same semantics as the renderer), then point patches
// (spineHref-matched, snapshot searched over the run concatenation with the
// closest-to-offset disambiguation; a miss means the patch is invalid and is
// silently skipped — the renderer already flags it in the UI).
export function applyChapterTransforms(runs: { text: string }[], rules: ExportRule[], spineHref: string): void {
  const patternRules = rules.filter((r) => r.matchType === 'pattern' && r.effectiveEnabled && r.pattern)
  for (const run of runs) {
    let text = run.text
    for (const rule of patternRules) text = applyRuleToText(text, rule)
    run.text = text
  }
  for (const patch of rules) {
    if (patch.matchType !== 'point' || !patch.effectiveEnabled) continue
    if (patch.spineHref !== spineHref) continue
    const snapshot = patch.originalText ?? ''
    if (!snapshot || patch.textOffset == null) continue
    const found = findPointMatch(runs, snapshot, patch.textOffset, patch.caseSensitive)
    if (!found) continue
    applyPointMatch(runs, found, patch.replacement ?? '')
  }
}

// Chapter = title line + blank line + paragraphs (one line each, no blank
// lines between them — the layout the reader shows); chapters joined with
// two blank lines (more separation than the paragraph blocks); single
// trailing newline. Trade-off: re-uploading the export flattens each chapter
// into one paragraph (the txt parser splits paragraphs on blank lines), which
// the reading-first layout is willing to pay.
export function assembleTxt(chapters: { title: string; paragraphs: string[] }[]): string {
  const parts = chapters.map((c) =>
    c.paragraphs.length ? `${c.title}\n\n${c.paragraphs.join('\n')}` : c.title)
  return parts.join('\n\n\n') + '\n'
}

// The shared middle of export.txt / export.epub: read the stored EPUB's
// chapters (server-generated, spine order), apply the given rules per chapter
// and return the transformed runs. `rules` is [] for the plain (原文) variant.
export async function extractTransformedChapters(
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
    applyChapterTransforms(runs, rules, `OEBPS/${href}`)
    chapters.push({ title: runs[0]!.text, paragraphs: runs.slice(1).map((r) => r.text) })
  }
  return chapters
}

// Ownership + TXT-only gate shared by both export variants.
async function getExportableTxtBook(userId: string, bookId: string) {
  const book = await getActiveBook(userId, bookId)
  if (book.format !== 'txt') {
    throw new AppError('UNSUPPORTED_FORMAT', 'Exports are only supported for TXT books')
  }
  return book
}

// Load the rules and read the stored EPUB for an export. `plain` skips the
// rule query entirely — the 原文 variant never applies transforms.
async function loadExportInput(userId: string, bookId: string, plain: boolean) {
  const book = await getExportableTxtBook(userId, bookId)
  const rules: ExportRule[] = plain ? [] : await loadEffectiveRules(getDb(), userId, bookId)
  const storage = getStorage()
  if (!(await storage.exists(book.filePath))) {
    throw new AppError('BOOK_FILE_MISSING', 'Book file not found')
  }
  const buffer = await bufferFromStream(await storage.get(book.filePath))
  return { book, rules, buffer }
}

// P4: TXT edited export — the stored file is the generated EPUB, from which
// the normalized text is recovered losslessly (the server wrote it). Applies
// the requesting user's effective rules (or not, when plain) and returns the
// assembled text plus the book title (for the download filename). `plain`
// powers the "原文" path for TXT books: the original bytes were never
// stored, so the closest to the original is the untransformed normalized text.
// `edited` reports whether any effective rule was applied — routes use it to
// keep the filename honest (原文 name when nothing was changed).
export async function exportTxtBook(
  userId: string,
  bookId: string,
  plain = false,
): Promise<{ text: string; title: string; edited: boolean }> {
  const { book, rules, buffer } = await loadExportInput(userId, bookId, plain)
  const chapters = await extractTransformedChapters(buffer, rules)
  return { text: assembleTxt(chapters), title: book.title, edited: rules.some((r) => r.effectiveEnabled) }
}

// P4: EPUB export — regenerated on demand from the stored book's chapters
// with the requesting user's effective rules applied (or not, when plain).
// Metadata (title/author) and the cover come from the DB's current values so
// edits made after upload show up immediately. TXT books only; uploaded EPUB
// books keep their stored file. The output is the plain txt-to-epub template
// product — the original upload's formatting is not recoverable.
export async function exportEpubBook(
  userId: string,
  bookId: string,
  plain = false,
): Promise<{ buffer: Buffer; title: string; edited: boolean }> {
  const { book, rules, buffer } = await loadExportInput(userId, bookId, plain)
  const chapters = await extractTransformedChapters(buffer, rules)

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
