import { parse, type DefaultTreeAdapterTypes } from 'parse5'

import type { MetadataCandidate } from '@bookdock/shared'

import { AppError } from '../../middleware/error'

type Node = DefaultTreeAdapterTypes.Node
type Element = DefaultTreeAdapterTypes.Element

function elements(root: Node, predicate: (element: Element) => boolean): Element[] {
  const found: Element[] = []
  function visit(node: Node) {
    if ('tagName' in node && predicate(node)) found.push(node)
    if ('childNodes' in node) node.childNodes.forEach(visit)
  }
  visit(root)
  return found
}

function attr(node: Element | undefined, name: string): string | undefined {
  return node?.attrs.find((item) => item.name === name)?.value
}

function hasClass(node: Element, name: string): boolean {
  return (attr(node, 'class') ?? '').split(/\s+/).includes(name)
}

function content(node: Node): string {
  if (node.nodeName === '#text' && 'value' in node) return node.value
  if ('tagName' in node && node.tagName === 'br') return '\n'
  return 'childNodes' in node ? node.childNodes.map(content).join('') : ''
}

function cover(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol === 'https:' && /^img\d+\.doubanio\.com$/.test(url.hostname) && /^\/view\/subject\/[a-z]+\/public\/[\w-]+\.(jpg|jpeg|png|webp)$/.test(url.pathname) && !url.port && !url.username && !url.password && !url.search && !url.hash) return url.href
  } catch { /* Invalid cover URLs are ignored. */ }
  return undefined
}

export function parseDoubanSearch(html: string): MetadataCandidate[] {
  const document = parse(html)
  const list = elements(document, (node) => hasClass(node, 'result-list'))[0]
  if (!list) {
    if (html.includes('没有找到相关结果')) return []
    throw new AppError('VALIDATION_ERROR', 'Douban search response could not be read')
  }
  const results = elements(list, (node) => hasClass(node, 'result'))
  const candidates = results.slice(0, 20).flatMap((result) => {
    const link = elements(result, (node) => node.tagName === 'a' && hasClass(node, 'nbg'))[0]
    const id = attr(link, 'onclick')?.match(/\bsid:\s*(\d{1,20})\b/)?.[1]
    const title = attr(link, 'title')?.trim().slice(0, 500)
    if (!id || !title) return []
    const image = link && elements(link, (node) => node.tagName === 'img')[0]
    const cast = elements(result, (node) => hasClass(node, 'subject-cast'))[0]
    const author = cast && content(cast).split(' / ')[0]?.trim().slice(0, 500)
    return [{ id, provider: 'douban' as const, title, authors: author ? [author] : [], coverUrl: cover(attr(image, 'src')), sourceUrl: `https://book.douban.com/subject/${id}/` }]
  })
  if (results.length && !candidates.length) throw new AppError('VALIDATION_ERROR', 'Douban search response could not be read')
  return candidates
}

export function parseDoubanDetail(html: string, id: string): MetadataCandidate {
  const document = parse(html)
  const titleNode = elements(document, (node) => attr(node, 'property') === 'v:itemreviewed')[0]
  const info = elements(document, (node) => attr(node, 'id') === 'info')[0]
  const title = titleNode && content(titleNode).trim().slice(0, 500)
  if (!title || !info) throw new AppError('VALIDATION_ERROR', 'Douban detail response could not be read')
  const lines = content(info).split('\n').map((line) => line.trim()).filter(Boolean)
  const field = (name: string, max: number) => {
    const index = lines.findIndex((line) => new RegExp(`^${name}\\s*[:：]`).test(line))
    if (index < 0) return undefined
    const value = lines[index]!.replace(new RegExp(`^${name}\\s*[:：]\\s*`), '').trim() || lines[index + 1]
    return value?.slice(0, max)
  }
  const author = field('作者', 500)
  const report = elements(document, (node) => attr(node, 'id') === 'link-report')[0]
  const intros = report ? elements(report, (node) => hasClass(node, 'intro')) : []
  const intro = intros.at(-1)
  const paragraphs = intro ? elements(intro, (node) => node.tagName === 'p').map((node) => content(node).trim()).filter(Boolean) : []
  const image = elements(document, (node) => attr(node, 'property') === 'og:image')[0]
  return { id, provider: 'douban', title, authors: author ? [author] : [], description: paragraphs.join('\n') || undefined, publisher: field('出版社', 200), published: field('出版年', 50), isbn: field('ISBN', 20), coverUrl: cover(attr(image, 'content')), sourceUrl: `https://book.douban.com/subject/${id}/` }
}
