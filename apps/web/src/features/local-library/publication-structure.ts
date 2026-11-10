import type { ClientBookRef, ClientPublicationNavigationItem, ClientPublicationStructure } from '@bookdock/shared'
import { clientPublicationStructureSchema } from '@bookdock/shared'

import { loadFoliateEngine } from '../reader/content/load-engine'
import { localEpubProvider } from '../reader/content/local-epub-provider'
import { LocalLibraryError, type LocalLibraryRepository } from './repository'

export async function readPublicationStructure(repository: LocalLibraryRepository, ref: ClientBookRef, signal: AbortSignal): Promise<ClientPublicationStructure> {
  signal.throwIfAborted()
  const book = await repository.getBook(ref)
  if (!book.content) throw new LocalLibraryError('unavailable-content', 'Publication structure requires available content')
  const file = await repository.getPublicationFile(ref)
  const lease = await localEpubProvider(book.content.contentId, file).open(await loadFoliateEngine(), signal)
  try {
    signal.throwIfAborted()
    const sections = lease.book.sections
    if (!Array.isArray(sections) || !sections.length || sections.length > 10_000 || sections.some((section) => !section || typeof section !== 'object')) throw new LocalLibraryError('invalid-input', 'Invalid publication spine')
    let count = 0
    const titles = new Map<number, string>()
    function navigation(items: unknown, depth = 0): ClientPublicationNavigationItem[] {
      if (!Array.isArray(items)) return []
      if (depth > 32) throw new LocalLibraryError('invalid-input', 'Publication navigation is too deeply nested')
      return items.map((item) => {
        if (++count > 10_000 || !item || typeof item !== 'object') throw new LocalLibraryError('invalid-input', 'Invalid publication navigation')
        const href = typeof item.href === 'string' && item.href ? item.href : null
        const label = typeof item.label === 'string' ? item.label : ''
        const resolved = href ? lease.book.resolveHref?.(href) : null
        if (Number.isInteger(resolved?.index) && label && !titles.has(resolved.index)) titles.set(resolved.index, label)
        return { label, href, children: navigation(item.subitems, depth + 1) }
      })
    }
    const toc = navigation(lease.book.toc)
    const structure = clientPublicationStructureSchema.parse({
      content: book.content,
      sections: sections.map((section, index) => ({
        index, href: typeof section?.id === 'string' && section.id ? section.id : null,
        title: titles.get(index) ?? null,
        byteLength: Number.isSafeInteger(section?.size) && section.size >= 0 ? section.size : null,
        wordCount: book.format === 'txt' ? book.textSource?.chapters[index]?.wordCount ?? null : null,
      })), navigation: toc,
    })
    const current = await repository.getBook(ref)
    if (current.availability !== 'available' || current.content?.contentId !== book.content.contentId) throw new LocalLibraryError('unavailable-content', 'Publication content changed during extraction')
    signal.throwIfAborted()
    return structure
  } finally { lease.release() }
}
