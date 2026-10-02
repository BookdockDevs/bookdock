import { DOMParser, Element as XmlElement } from '@xmldom/xmldom'
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm'

import { applyTitleReplacements, type LegadoExploreConfigRes, type LegadoExploreLibrary, type TextRun } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { contentRevisions, libraryCategories, libraryMemberships, libraryTags, libraries } from '../../db/schema'
import { isEpubMediaPath, loadEpubChapterMarkup, loadEpubResource, resolveEpubResourcePath, type EpubChapterMedia } from '../../formats/epub'
import { AppError } from '../../middleware/error'
import { getUserTimezone } from '../auth/auth.service'
import { formatTimestamp } from '../../lib/format-timestamp'
import { ensurePrivateLibrary, isLibraryManager } from '../libraries/library-access'
import { listLibraryVersionEntries } from '../libraries/catalog.service'

import {
  getActiveBook,
  getBookChapterContent,
  getBookChapters,
  getBookEpubBuffer,
} from './books.service'
import { applyEpubChapterReplacements, applyChapterReplacements, loadEffectiveBookReplacementRules, type BookReplacementRule } from './replacement-rules'

const SKIPPED_TAGS = new Set(['script', 'style', 'head'])
const TITLE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title'])
const READING_BLOCK_TAGS = new Set(['p', 'div', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'])
const READING_INLINE_TAGS = new Set(['b', 'em', 'i', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u'])

/** Sentinel category id meaning "uncategorized"; it exists once per library. */
export const LEGADO_NONE_CATEGORY = 'none'

export type LegadoExploreScope = 'all' | 'shelf' | 'tag'

/**
 * A shelf/tag filter is always scoped to one library: taxonomy ids are
 * library-local and the uncategorized sentinel repeats per library, so an id
 * on its own would let one library's row answer for another's.
 */
export interface LegadoExploreFilter {
  libraryId: string
  categoryId?: string
  tagId?: string
}

/**
 * Libraries a reader may browse from a client that lists "my books": their own
 * private library first, then the shared ones they actually joined (owner, admin
 * or member). A public library they never joined is deliberately absent — both
 * the book source's discovery page and the external API mirror the Web sidebar,
 * which omits unjoined rows, rather than `GET /libraries` which lists them for
 * discovery.
 *
 * Shared by the book source and the external API, so it is named for the rule
 * rather than for either client.
 */
export function listBrowsableLibraries(userId: string): { id: string; name: string; type: 'private' | 'shared'; private: boolean }[] {
  const db = getDb()
  const privateLibrary = db.select({ id: libraries.id, name: libraries.name }).from(libraries)
    .where(and(eq(libraries.userId, userId), eq(libraries.type, 'private'))).get()
  const shared = db.select({ id: libraries.id, name: libraries.name }).from(libraries)
    .where(and(
      eq(libraries.type, 'shared'),
      or(eq(libraries.userId, userId), inArray(libraries.id, memberLibraryIds(userId))),
    ))
    .all()
  return [
    ...(privateLibrary ? [{ ...privateLibrary, type: 'private' as const, private: true }] : []),
    // Joined libraries follow the reader's own join order, so the source
    // mirrors the sidebar rather than an arbitrary server-side sort.
    ...shared.map((row) => ({ ...row, type: 'shared' as const, private: false })),
  ]
}

function memberLibraryIds(userId: string): string[] {
  return getDb().select({ libraryId: libraryMemberships.libraryId }).from(libraryMemberships)
    .where(eq(libraryMemberships.userId, userId)).all().map((row) => row.libraryId)
}

/** Nesting depth for the discovery indents; cycles cannot occur (see the
 *  category-parent service, which refuses them) but a malformed row must not
 *  hang the config request either. */
function categoryDepths(rows: { id: string; parentId: string | null }[]): Map<string, number> {
  const byId = new Map(rows.map((row) => [row.id, row]))
  const depths = new Map<string, number>()
  for (const row of rows) {
    let depth = 0
    let cursor = row.parentId
    while (cursor && depth < 8) {
      depth += 1
      cursor = byId.get(cursor)?.parentId ?? null
    }
    depths.set(row.id, depth)
  }
  return depths
}

/**
 * Discovery rows for every browsable library.
 *
 * Hidden taxonomy follows the same rule as hidden works and hidden versions: it
 * is a member-facing switch, so a manager keeps seeing it. That needs no
 * special case for the private library, whose owner is its own manager, and it
 * is consistent there in a stronger way — the source already lists that owner's
 * hidden books, so hiding their shelf rows would only have made a visible book
 * unreachable by category. A library with no readable work is dropped entirely
 * rather than rendered as a section of dead buttons.
 */
export async function getLegadoExploreConfig(userId: string): Promise<LegadoExploreConfigRes> {
  const rows: LegadoExploreLibrary[] = []
  for (const library of listBrowsableLibraries(userId)) {
    const showHidden = await isLibraryManager(userId, library.id)
    const [categories, tags, works] = await Promise.all([
      listLegadoCategories(library.id, showHidden),
      listLegadoTags(library.id, showHidden),
      listLibraryVersionEntries(userId, library.id, { page: 1, pageSize: 1 }),
    ])
    if (works.total === 0) continue
    rows.push({ id: library.id, name: library.name, type: library.type, categories, tags })
  }
  return { libraries: rows }
}

function listLegadoCategories(libraryId: string, includeHidden: boolean) {
  const db = getDb()
  const rows = db.select({ id: libraryCategories.id, name: libraryCategories.name, parentId: libraryCategories.parentId, sortOrder: libraryCategories.sortOrder, createdAt: libraryCategories.createdAt })
    .from(libraryCategories)
    .where(includeHidden
      ? eq(libraryCategories.libraryId, libraryId)
      : and(eq(libraryCategories.libraryId, libraryId), eq(libraryCategories.hidden, false)))
    .orderBy(asc(libraryCategories.sortOrder), asc(libraryCategories.createdAt))
    .all()
  const depths = categoryDepths(rows)
  return [{ id: LEGADO_NONE_CATEGORY, name: '未分类', depth: 0 }, ...rows.map((row) => ({
    id: row.id,
    name: row.name,
    depth: depths.get(row.id) ?? 0,
  }))]
}

function listLegadoTags(libraryId: string, includeHidden: boolean) {
  return getDb().select({ id: libraryTags.id, name: libraryTags.name })
    .from(libraryTags)
    .where(includeHidden
      ? eq(libraryTags.libraryId, libraryId)
      : and(eq(libraryTags.libraryId, libraryId), eq(libraryTags.hidden, false)))
    .orderBy(asc(libraryTags.sortOrder), asc(libraryTags.name))
    .all()
    .map((row) => ({ id: row.id, name: row.name, depth: 0 }))
}

/** Reject a taxonomy id that does not belong to the library it was asked for. */
export function getLegadoExploreFilter(userId: string, libraryId: string, scope: LegadoExploreScope, id?: string): LegadoExploreFilter {
  if (scope === 'all') return { libraryId }
  if (!id) throw new AppError(scope === 'shelf' ? 'SHELF_NOT_FOUND' : 'TAG_NOT_FOUND')
  if (scope === 'shelf') {
    if (id === LEGADO_NONE_CATEGORY) return { libraryId, categoryId: LEGADO_NONE_CATEGORY }
    const category = getDb().select({ id: libraryCategories.id }).from(libraryCategories)
      .where(and(eq(libraryCategories.id, id), eq(libraryCategories.libraryId, libraryId))).get()
    if (!category) throw new AppError('SHELF_NOT_FOUND')
    return { libraryId, categoryId: id }
  }
  const tag = getDb().select({ id: libraryTags.id }).from(libraryTags)
    .where(and(eq(libraryTags.id, id), eq(libraryTags.libraryId, libraryId))).get()
  if (!tag) throw new AppError('TAG_NOT_FOUND')
  return { libraryId, tagId: id }
}

/** The reader's own library, created on demand like every other private path. */
export function legadoPrivateLibraryId(userId: string): string {
  return ensurePrivateLibrary(getDb(), userId)
}

/** Every library the reader joined, private library first. */
export function legadoJoinedLibraryIds(userId: string): string[] {
  const libs = listBrowsableLibraries(userId)
  return libs.length > 0 ? libs.map((row) => row.id) : [legadoPrivateLibraryId(userId)]
}

interface EpubNode {
  childNodes?: ArrayLike<EpubNode>
  nodeName?: string
  nodeType: number
  nodeValue: string | null
  parentNode: EpubNode | null
  tagName?: string
}

interface ProjectedEpubHtml {
  html: string
  hasMedia: boolean
  hasRichMarkup: boolean
}

interface EpubInlineStyles {
  bold: boolean
  color?: string
  italic: boolean
  strike: boolean
  underline: boolean
}

function nodeTag(node: EpubNode): string {
  return (node.tagName ?? node.nodeName ?? '').toLowerCase()
}

function isSkippedNode(node: EpubNode): boolean {
  let parent = node.parentNode
  while (parent) {
    if (SKIPPED_TAGS.has(nodeTag(parent))) return true
    parent = parent.parentNode
  }
  return false
}

function collectReadingText(node: EpubNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? ''
  let text = ''
  for (const child of Array.from(node.childNodes ?? [])) {
    const tag = nodeTag(child)
    if (child.nodeType === 1 && tag === 'br') {
      text += '\n'
      continue
    }
    text += collectReadingText(child)
    if (child.nodeType === 1 && READING_BLOCK_TAGS.has(tag)) text += '\n\n'
  }
  return text
}

function normalizeHeadingText(text: string): string {
  return text.replace(/[\s\u3000]+/g, '')
}

function collectNodeText(node: EpubNode): string {
  if (node.nodeType === 3) return node.nodeValue ?? ''
  let text = ''
  for (const child of Array.from(node.childNodes ?? [])) text += collectNodeText(child)
  return text
}

function removeLeadingDuplicateEpubHeading(body: EpubNode, chapterTitle?: string): void {
  if (!chapterTitle) return
  const normalizedTitle = normalizeHeadingText(chapterTitle)
  if (!normalizedTitle) return

  let resolved = false
  const visit = (node: EpubNode) => {
    if (resolved) return
    for (const child of Array.from(node.childNodes ?? [])) {
      if (resolved) return
      if (child.nodeType === 3) {
        if ((child.nodeValue ?? '').trim()) resolved = true
        continue
      }
      if (child.nodeType !== 1) continue
      if (TITLE_TAGS.has(nodeTag(child))) {
        if (normalizeHeadingText(collectNodeText(child)) === normalizedTitle) {
          const parent = child.parentNode as unknown as XmlElement | null
          parent?.removeChild(child as unknown as XmlElement)
        }
        resolved = true
        return
      }
      visit(child)
    }
  }

  visit(body)
}

function normalizeReadingText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function escapeEpubHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character] ?? character)
}

function parseEpubInlineStyles(node: EpubNode): EpubInlineStyles {
  const styles: EpubInlineStyles = {
    bold: false,
    italic: false,
    strike: false,
    underline: false,
  }
  const declarations = elementAttribute(node, 'style')
    .split(';')
    .map((declaration) => {
      const separator = declaration.indexOf(':')
      if (separator < 0) return null
      return [declaration.slice(0, separator).trim().toLowerCase(), declaration.slice(separator + 1).trim().toLowerCase()] as const
    })
    .filter((declaration): declaration is readonly [string, string] => declaration !== null)

  const color = elementAttribute(node, 'color').trim()
  for (const [property, value] of declarations) {
    if (property === 'color' && /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{1,32})$/i.test(value)) styles.color = value
    if (property === 'font-weight' && (value === 'bold' || /^(?:[6-9]00|1000)$/.test(value))) styles.bold = true
    if (property === 'font-style' && (value === 'italic' || value === 'oblique')) styles.italic = true
    if ((property === 'text-decoration' || property === 'text-decoration-line') && value.includes('underline')) styles.underline = true
    if ((property === 'text-decoration' || property === 'text-decoration-line') && value.includes('line-through')) styles.strike = true
  }
  if (!styles.color && /^(?:#[0-9a-f]{3}|#[0-9a-f]{6}|[a-z]{1,32})$/i.test(color)) styles.color = color
  return styles
}

function wrapEpubInlineStyles(html: string, styles: EpubInlineStyles): string {
  let result = html
  if (styles.strike) result = `<s>${result}</s>`
  if (styles.underline) result = `<u>${result}</u>`
  if (styles.italic) result = `<i>${result}</i>`
  if (styles.bold) result = `<b>${result}</b>`
  if (styles.color) result = `<font color="${escapeEpubHtml(styles.color)}">${result}</font>`
  return result
}

function elementAttribute(node: EpubNode, name: string): string {
  if (node.nodeType !== 1) return ''
  return (node as unknown as XmlElement).getAttribute(name) ?? ''
}

function resolveEpubMediaUrl(
  href: string,
  value: string,
  resourceUrl?: (resourcePath: string) => string,
): string | null {
  const path = resolveEpubResourcePath(href, value)
  if (path && isEpubMediaPath(path)) return resourceUrl?.(path) ?? null
  return /^(?:https?:|data:)/i.test(value.trim()) ? value.trim() : null
}

function firstDescendantAttribute(node: EpubNode, tags: Set<string>, attribute: string): string {
  for (const child of Array.from(node.childNodes ?? [])) {
    if (child.nodeType !== 1) continue
    const tag = nodeTag(child)
    if (tags.has(tag)) {
      const value = elementAttribute(child, attribute)
      if (value) return value
    }
    const nested = firstDescendantAttribute(child, tags, attribute)
    if (nested) return nested
  }
  return ''
}

function mediaPlaceholderUrl(label: string): string {
  const safeLabel = escapeEpubHtml(label)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="240" viewBox="0 0 720 240"><rect width="720" height="240" rx="24" fill="#e2e8f0"/><circle cx="360" cy="96" r="36" fill="#94a3b8"/><path d="M348 78v36l30-18z" fill="#f8fafc"/><text x="360" y="174" fill="#334155" font-family="sans-serif" font-size="32" text-anchor="middle">${safeLabel} · 点击播放</text></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

function mediaImageSource(imageUrl: string, mediaUrl: string | null, label: string): string {
  if (!mediaUrl) return imageUrl
  const click = `java.openVideoPlayer(${JSON.stringify(mediaUrl)},${JSON.stringify(label)},true)`
  return `${imageUrl},${JSON.stringify({ click })}`
}

function serializeEpubMediaElement(
  node: EpubNode,
  href: string,
  resourceUrl?: (resourcePath: string) => string,
): ProjectedEpubHtml {
  const tag = nodeTag(node)
  const isVideo = tag === 'video'
  const mediaSource = elementAttribute(node, 'src')
    || firstDescendantAttribute(node, new Set(['audio', 'source']), 'src')
  const mediaUrl = mediaSource ? resolveEpubMediaUrl(href, mediaSource, resourceUrl) : null
  const posterSource = isVideo ? elementAttribute(node, 'poster') : ''
  const posterUrl = posterSource ? resolveEpubMediaUrl(href, posterSource, resourceUrl) : null
  const label = isVideo ? '视频' : '音频'
  if (!mediaUrl && !posterUrl) return { html: '', hasMedia: false, hasRichMarkup: false }
  const imageUrl = posterUrl ?? mediaPlaceholderUrl(label)
  const source = mediaImageSource(imageUrl, mediaUrl, label)
  return {
    html: `<div><img src="${escapeEpubHtml(source)}" alt="${label}"></div>`,
    hasMedia: true,
    hasRichMarkup: true,
  }
}

function serializeEpubReadingHtml(
  node: EpubNode,
  href: string,
  resourceUrl?: (resourcePath: string) => string,
  includeMedia = true,
): ProjectedEpubHtml {
  if (node.nodeType === 3) {
    const text = node.nodeValue ?? ''
    if (!text.trim()) {
      const indentation = text.replace(/[^\u3000]/g, '')
      return { html: indentation, hasMedia: false, hasRichMarkup: false }
    }
    return { html: escapeEpubHtml(text), hasMedia: false, hasRichMarkup: false }
  }
  if (node.nodeType !== 1 || isSkippedNode(node)) return { html: '', hasMedia: false, hasRichMarkup: false }

  const tag = nodeTag(node)
  if (tag === 'img') {
    if (!includeMedia) return { html: '', hasMedia: false, hasRichMarkup: false }
    const source = elementAttribute(node, 'src') || elementAttribute(node, 'data-src') || elementAttribute(node, 'xlink:href')
    const imageUrl = source ? resolveEpubMediaUrl(href, source, resourceUrl) : null
    if (!imageUrl) return { html: '', hasMedia: false, hasRichMarkup: false }
    const alt = elementAttribute(node, 'alt')
    return {
      html: `<img src="${escapeEpubHtml(imageUrl)}"${alt ? ` alt="${escapeEpubHtml(alt)}"` : ''}>`,
      hasMedia: true,
      hasRichMarkup: true,
    }
  }
  if (tag === 'audio' || tag === 'video') {
    if (!includeMedia) return { html: '', hasMedia: false, hasRichMarkup: false }
    return serializeEpubMediaElement(node, href, resourceUrl)
  }
  if (tag === 'br') return { html: '<br>', hasMedia: false, hasRichMarkup: false }

  let children = { html: '', hasMedia: false, hasRichMarkup: false }
  for (const child of Array.from(node.childNodes ?? [])) {
    const projected = serializeEpubReadingHtml(child, href, resourceUrl, includeMedia)
    children = {
      html: children.html + projected.html,
      hasMedia: children.hasMedia || projected.hasMedia,
      hasRichMarkup: children.hasRichMarkup || projected.hasRichMarkup,
    }
  }

  if (tag === 'a') {
    const source = elementAttribute(node, 'href')
    const linkUrl = source ? resolveEpubMediaUrl(href, source, resourceUrl) : null
    return linkUrl
      ? { html: `<a href="${escapeEpubHtml(linkUrl)}">${children.html}</a>`, hasMedia: children.hasMedia, hasRichMarkup: true }
      : children
  }
  if (tag === 'span' || tag === 'font') {
    const styles = parseEpubInlineStyles(node)
    const styledHtml = wrapEpubInlineStyles(children.html, styles)
    return {
      html: styledHtml,
      hasMedia: children.hasMedia,
      hasRichMarkup: children.hasRichMarkup || styledHtml !== children.html,
    }
  }
  if (READING_INLINE_TAGS.has(tag) || READING_BLOCK_TAGS.has(tag)) {
    return {
      html: `<${tag}>${children.html}</${tag}>`,
      hasMedia: children.hasMedia,
      hasRichMarkup: children.hasRichMarkup || READING_INLINE_TAGS.has(tag),
    }
  }
  return children
}

export function projectEpubChapterMarkup(
  markup: string,
  rules: BookReplacementRule[],
  href: string,
  resourceUrl?: (resourcePath: string) => string,
  chapterMedia: EpubChapterMedia[] = [],
  chapterTitle?: string,
  includeMedia = true,
): string {
  const doc = new DOMParser().parseFromString(markup, 'application/xml')
  applyEpubChapterReplacements(doc, rules, href)
  const body = doc.getElementsByTagName('body')[0] ?? doc.documentElement
  if (!body) return ''
  const bodyNode = body as unknown as EpubNode
  removeLeadingDuplicateEpubHeading(bodyNode, chapterTitle)
  const projected = serializeEpubReadingHtml(bodyNode, href, resourceUrl, includeMedia)
  const overlayMedia = includeMedia
    ? chapterMedia
        .map((media) => {
          const mediaUrl = resourceUrl?.(media.path)
          if (!mediaUrl) return ''
          const label = media.type === 'video' ? '视频' : '音频'
          const source = mediaImageSource(mediaPlaceholderUrl(label), mediaUrl, label)
          return `<div><img src="${escapeEpubHtml(source)}" alt="${label}"></div>`
        })
        .join('')
    : ''
  if (projected.hasMedia || projected.hasRichMarkup || overlayMedia) return `<usehtml>${projected.html}${overlayMedia}</usehtml>`
  return normalizeReadingText(collectReadingText(bodyNode))
}

function txtChapterHref(index: number): string {
  return `OEBPS/chapter-${String(index + 1).padStart(4, '0')}.xhtml`
}

export function projectTxtChapterContent(title: string, content: string, rules: BookReplacementRule[], index: number) {
  const runs: TextRun[] = [
    { text: title },
    ...content.split('\n\n').map((paragraph) => ({ text: paragraph })),
  ]
  applyChapterReplacements(runs, rules, txtChapterHref(index))

  const projectedTitle = runs[0]!.text.trim()
  const chapterSubtitle = projectedTitle
    .replace(/^(?:第\s*[0-9〇零一二两三四五六七八九十百千万亿]+\s*(?:章|回|节|卷)|chapter\s+\d+)\s*[:：\-—]?\s*/iu, '')
    .trim()
  const firstParagraph = runs[1]?.text.trim()
  const repeatsHeading = firstParagraph !== undefined
    && firstParagraph.length > 0
    && (firstParagraph === projectedTitle || (chapterSubtitle.length >= 2 && firstParagraph === chapterSubtitle))
  const bodyRuns = (repeatsHeading ? runs.slice(2) : runs.slice(1))

  return {
    title: runs[0]!.text,
    content: bodyRuns.map((run) => run.text).join('\n\n'),
  }
}

/**
 * A private library is a vault, so its owner also excludes hidden rows unless a
 * read opts in. The book source is the owner's own external reader and lists
 * hidden books on purpose, so every read below asks for them: a book the
 * discovery page offers must be openable, or the source would advertise a row
 * that 404s on tap. This only relaxes the hide filter; deletion and the
 * collected-source check stay in force.
 */
export const LEGADO_READ = { showHidden: true } as const

export async function getLegadoToc(userId: string, bookId: string) {
  const book = await getActiveBook(userId, bookId, LEGADO_READ)
  const chapters = await getBookChapters(userId, bookId, LEGADO_READ)
  const rules = await loadEffectiveBookReplacementRules(userId, bookId)
  // Legado renders TocRule.updateTime as a plain string beside every chapter
  // title (BookChapter.tag), not as a timestamp, so this is a readable date and
  // time. A chapter carries its own added time only once that differs from the
  // revision it lives in, so an absent addedAt means every chapter of this book
  // so far arrived with the file currently being read. Minutes are the useful
  // ceiling: one append stamps all of its chapters with the same instant, so a
  // seconds field would only expose how long the insert took.
  const timezone = getUserTimezone(userId)
  return chapters.map((chapter, index) => ({
    id: chapter.id,
    index,
    title: applyTitleReplacements(chapter.title, rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled)),
    level: chapter.level,
    isVolume: chapters[index + 1] !== undefined && chapters[index + 1]!.level > chapter.level,
    contentUpdateDate: formatTimestamp(chapter.addedAt ?? book.contentUpdatedAt, timezone),
  }))
}

export async function getLegadoChapterContent(
  userId: string,
  bookId: string,
  chapterIndex: number,
  resourceUrl?: (resourcePath: string) => string,
  includeMedia = true,
) {
  if (!Number.isInteger(chapterIndex) || chapterIndex < 0) {
    throw new AppError('VALIDATION_ERROR', 'Invalid chapter index')
  }

  const book = await getActiveBook(userId, bookId, LEGADO_READ)
  const chapters = await getBookChapters(userId, bookId, LEGADO_READ)
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new AppError('VALIDATION_ERROR', 'Chapter index is out of range')
  const rules = await loadEffectiveBookReplacementRules(userId, bookId)

  if (book.format === 'txt') {
    const raw = await getBookChapterContent(userId, bookId, chapterIndex, LEGADO_READ)
    const projected = projectTxtChapterContent(chapter.title, raw.content, rules, chapterIndex)
    return { id: chapter.id, index: chapterIndex, title: projected.title, content: projected.content }
  }

  const title = applyTitleReplacements(
    chapter.title,
    rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled),
  )
  const markup = await loadEpubChapterMarkup(await getBookEpubBuffer(userId, bookId, LEGADO_READ), chapterIndex)
  if (markup) {
    try {
      const content = projectEpubChapterMarkup(markup.markup, rules, markup.href, resourceUrl, markup.media, title, includeMedia)
      return { id: chapter.id, index: chapterIndex, title, content }
    } catch {
      // Fall back to the established plain-text extractor for malformed XHTML.
    }
  }

  const raw = await getBookChapterContent(userId, bookId, chapterIndex, LEGADO_READ)
  const projected = projectTxtChapterContent(chapter.title, raw.content, rules, chapterIndex)
  return { id: chapter.id, index: chapterIndex, title: projected.title, content: projected.content }
}

export async function getLegadoBookResource(userId: string, bookId: string, resourcePath: string) {
  const book = await getActiveBook(userId, bookId, LEGADO_READ)
  if (book.format !== 'epub') throw new AppError('UNSUPPORTED_FORMAT', 'Only EPUB books expose media resources')
  const resource = await loadEpubResource(await getBookEpubBuffer(userId, bookId, LEGADO_READ), resourcePath)
  if (!resource) throw new AppError('BOOK_FILE_MISSING', 'EPUB media resource not found')
  return resource
}

/**
 * Latest chapter title per BookVersion, read straight from the latest
 * revision's cached chapter list. The list projections used to call the full
 * TOC per row, which re-read the book and its replacement rules once per item;
 * this is one query for the whole page.
 */
export function legadoLatestChapterTitles(bookVersionIds: string[]): Map<string, string> {
  const titles = new Map<string, string>()
  if (bookVersionIds.length === 0) return titles
  const rows = getDb().select({
    bookVersionId: contentRevisions.bookVersionId,
    meta: contentRevisions.meta,
  }).from(contentRevisions)
    .where(and(
      inArray(contentRevisions.bookVersionId, bookVersionIds),
      eq(contentRevisions.revisionNo, sql`(SELECT max(${contentRevisions.revisionNo}) FROM ${contentRevisions} WHERE ${contentRevisions.bookVersionId} = ${contentRevisions.bookVersionId})`),
    )).all()
  for (const row of rows) {
    const chapters = (row.meta as { chapters?: Array<{ title?: string; level?: number }> } | null)?.chapters
    if (!Array.isArray(chapters) || chapters.length === 0) continue
    // Mirrors the TOC's isVolume rule: a node is a volume when the next node
    // is deeper, so the last such node has no content behind it.
    let latest: string | null = null
    for (let index = 0; index < chapters.length; index += 1) {
      const chapter = chapters[index]!
      if (chapters[index + 1] !== undefined && (chapters[index + 1]!.level ?? 1) > (chapter.level ?? 1)) continue
      if (typeof chapter.title === 'string' && chapter.title) latest = chapter.title
    }
    if (latest) titles.set(row.bookVersionId, latest)
  }
  return titles
}
