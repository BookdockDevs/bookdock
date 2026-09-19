import { DOMParser, Element as XmlElement } from '@xmldom/xmldom'
import { and, asc, eq } from 'drizzle-orm'

import { applyRuleToRuns, applyTitleReplacements, findPointMatch, applyPointMatch, type LegadoExploreConfigRes, type TextRun } from '@bookdock/shared'

import { getDb } from '../../db/client'
import { shelves, tags } from '../../db/schema'
import { isEpubMediaPath, loadEpubChapterMarkup, loadEpubResource, resolveEpubResourcePath, type EpubChapterMedia } from '../../formats/epub'
import { AppError } from '../../middleware/error'

import {
  getActiveBook,
  getBookChapterContent,
  getBookChapters,
  getBookEpubBuffer,
} from './books.service'
import { applyChapterReplacements, loadEffectiveBookReplacementRules, type BookReplacementRule } from './replacement-rules'

const SKIPPED_TAGS = new Set(['script', 'style', 'head'])
const TITLE_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'title'])
const READING_BLOCK_TAGS = new Set(['p', 'div', 'li', 'blockquote', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre'])
const READING_INLINE_TAGS = new Set(['b', 'em', 'i', 's', 'small', 'span', 'strong', 'sub', 'sup', 'u'])

export type LegadoExploreScope = 'all' | 'shelf' | 'tag'

export function getLegadoExploreConfig(userId: string): LegadoExploreConfigRes {
  const db = getDb()
  const shelfRows = db
    .select({ id: shelves.id, name: shelves.name })
    .from(shelves)
    .where(eq(shelves.userId, userId))
    .orderBy(asc(shelves.sortOrder), asc(shelves.createdAt))
    .all()
  const tagRows = db
    .select({ id: tags.id, name: tags.name })
    .from(tags)
    .where(eq(tags.userId, userId))
    .orderBy(asc(tags.sortOrder), asc(tags.name))
    .all()

  return {
    shelves: [{ id: 'none', name: '未分类' }, ...shelfRows],
    tags: tagRows,
  }
}

export function getLegadoExploreFilter(userId: string, scope: LegadoExploreScope, id?: string): { shelfId?: string; tagId?: string } {
  if (scope === 'all') return {}
  if (!id) throw new AppError(scope === 'shelf' ? 'SHELF_NOT_FOUND' : 'TAG_NOT_FOUND')
  if (scope === 'shelf') {
    if (id === 'none') return { shelfId: 'none' }
    const shelf = getDb().select({ id: shelves.id }).from(shelves)
      .where(and(eq(shelves.id, id), eq(shelves.userId, userId))).get()
    if (!shelf) throw new AppError('SHELF_NOT_FOUND')
    return { shelfId: id }
  }
  const tag = getDb().select({ id: tags.id }).from(tags)
    .where(and(eq(tags.id, id), eq(tags.userId, userId))).get()
  if (!tag) throw new AppError('TAG_NOT_FOUND')
  return { tagId: id }
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

function isTitleNode(node: EpubNode): boolean {
  let parent = node.parentNode
  while (parent) {
    if (TITLE_TAGS.has(nodeTag(parent))) return true
    parent = parent.parentNode
  }
  return false
}

function collectTextNodes(root: EpubNode): EpubNode[] {
  const nodes: EpubNode[] = []
  const visit = (node: EpubNode) => {
    if (node.nodeType === 3) {
      if (!isSkippedNode(node) && node.nodeValue) nodes.push(node)
      return
    }
    for (const child of Array.from(node.childNodes ?? [])) visit(child)
  }
  visit(root)
  return nodes
}

function applyPatternRules(runs: TextRun[], rules: BookReplacementRule[]): void {
  for (const rule of rules) {
    try {
      applyRuleToRuns(runs, rule)
    } catch {
      // One malformed rule must not make a chapter unavailable.
    }
  }
}

function applyEpubChapterReplacements(doc: ReturnType<DOMParser['parseFromString']>, rules: BookReplacementRule[], href: string): void {
  const nodes = collectTextNodes(doc as unknown as EpubNode)
  const patternRules = rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled && rule.pattern)
  const contentNodes = nodes.filter((node) => !isTitleNode(node))
  const contentRuns = contentNodes.map((node) => ({ text: node.nodeValue ?? '' }))
  applyPatternRules(contentRuns, patternRules.filter((rule) => rule.applyTo !== 'title'))
  for (let index = 0; index < contentNodes.length; index += 1) {
    contentNodes[index]!.nodeValue = contentRuns[index]!.text
  }

  const titleGroups = new Map<EpubNode, EpubNode[]>()
  for (const node of nodes) {
    if (!isTitleNode(node)) continue
    let title = node.parentNode
    while (title && !TITLE_TAGS.has(nodeTag(title))) title = title.parentNode
    if (!title) continue
    const group = titleGroups.get(title) ?? []
    group.push(node)
    titleGroups.set(title, group)
  }
  for (const group of titleGroups.values()) {
    const runs = group.map((node) => ({ text: node.nodeValue ?? '' }))
    applyPatternRules(runs, patternRules.filter((rule) => rule.applyTo !== 'content'))
    for (let index = 0; index < group.length; index += 1) {
      group[index]!.nodeValue = runs[index]!.text
    }
  }

  const pointRuns = nodes.map((node) => ({ text: node.nodeValue ?? '' }))
  for (const patch of rules) {
    if (patch.matchType !== 'point' || !patch.effectiveEnabled || patch.spineHref !== href) continue
    const snapshot = patch.originalText ?? ''
    if (!snapshot || patch.textOffset == null) continue
    const found = findPointMatch(pointRuns, snapshot, patch.textOffset)
    if (!found) continue
    applyPointMatch(pointRuns, found, patch.replacement ?? '')
  }
  for (let index = 0; index < nodes.length; index += 1) {
    nodes[index]!.nodeValue = pointRuns[index]!.text
  }
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

export async function getLegadoToc(userId: string, bookId: string) {
  await getActiveBook(userId, bookId)
  const chapters = await getBookChapters(userId, bookId)
  const rules = await loadEffectiveBookReplacementRules(userId, bookId)
  return chapters.map((chapter, index) => ({
    id: chapter.id,
    index,
    title: applyTitleReplacements(chapter.title, rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled)),
    level: chapter.level,
    isVolume: chapters[index + 1] !== undefined && chapters[index + 1]!.level > chapter.level,
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

  const book = await getActiveBook(userId, bookId)
  const chapters = await getBookChapters(userId, bookId)
  const chapter = chapters[chapterIndex]
  if (!chapter) throw new AppError('VALIDATION_ERROR', 'Chapter index is out of range')
  const rules = await loadEffectiveBookReplacementRules(userId, bookId)

  if (book.format === 'txt') {
    const raw = await getBookChapterContent(userId, bookId, chapterIndex)
    const projected = projectTxtChapterContent(chapter.title, raw.content, rules, chapterIndex)
    return { id: chapter.id, index: chapterIndex, title: projected.title, content: projected.content }
  }

  const title = applyTitleReplacements(
    chapter.title,
    rules.filter((rule) => rule.matchType === 'pattern' && rule.effectiveEnabled),
  )
  const markup = await loadEpubChapterMarkup(await getBookEpubBuffer(userId, bookId), chapterIndex)
  if (markup) {
    try {
      const content = projectEpubChapterMarkup(markup.markup, rules, markup.href, resourceUrl, markup.media, title, includeMedia)
      return { id: chapter.id, index: chapterIndex, title, content }
    } catch {
      // Fall back to the established plain-text extractor for malformed XHTML.
    }
  }

  const raw = await getBookChapterContent(userId, bookId, chapterIndex)
  const projected = projectTxtChapterContent(chapter.title, raw.content, rules, chapterIndex)
  return { id: chapter.id, index: chapterIndex, title: projected.title, content: projected.content }
}

export async function getLegadoBookResource(userId: string, bookId: string, resourcePath: string) {
  const book = await getActiveBook(userId, bookId)
  if (book.format !== 'epub') throw new AppError('UNSUPPORTED_FORMAT', 'Only EPUB books expose media resources')
  const resource = await loadEpubResource(await getBookEpubBuffer(userId, bookId), resourcePath)
  if (!resource) throw new AppError('BOOK_FILE_MISSING', 'EPUB media resource not found')
  return resource
}
