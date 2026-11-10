import { applyReplacementsWithWorker } from '../reader/lib/text-replacements'
import { processEpubInWorker } from '../local-library/epub-editor-worker'
import type { ClientBookRef } from '@bookdock/shared'

import { isDeviceBook } from './book-source'
import { localLibraryRepository, type LocalLibraryRepository } from '../local-library/repository'
import { loadFoliateEngine } from '../reader/content/load-engine'
import { localEpubProvider } from '../reader/content/local-epub-provider'

export async function prepareLocalBookFile(ref: ClientBookRef, format: 'epub' | 'txt', edited: boolean, signal = new AbortController().signal, repository: LocalLibraryRepository = localLibraryRepository): Promise<Blob> {
  signal.throwIfAborted()
  const book = await repository.getBook(ref)
  const file = await repository.getFile(ref)
  signal.throwIfAborted()
  if (book.format === 'txt' && !edited) return format === 'epub' ? repository.getPublicationFile(ref) : repository.getNormalizedText(ref)
  const rules = edited && isDeviceBook(ref) ? (await repository.readReplacements(ref.scope.vaultId, ref.bookId)).data.filter((rule) => rule.locationAvailable !== false) : []
  if (book.format === 'txt') {
    const publication = await repository.getPublicationFile(ref)
    const loaded = await processEpubInWorker({ file: publication }, signal)
    const documents = []
    for (const document of loaded.source.documents) {
      signal.throwIfAborted()
      documents.push({ ...document, content: await applyReplacementsWithWorker(document.content, rules, 'application/xhtml+xml', document.href) })
    }
    if (format === 'txt') {
      const texts = documents.map((document) => {
        const doc = new DOMParser().parseFromString(document.content, 'application/xhtml+xml')
        for (const element of doc.querySelectorAll('script,style,noscript,template')) element.remove()
        for (const element of doc.querySelectorAll('p,div,br,h1,h2,h3,h4,h5,h6,li,section')) element.append(doc.createTextNode('\n'))
        return doc.body?.textContent?.trim() ?? ''
      })
      signal.throwIfAborted()
      return new Blob([texts.join('\n\n')], { type: 'text/plain;charset=utf-8' })
    }
    const saved = await processEpubInWorker({ file: publication, draft: { ...loaded.source, documents, baseRevisionId: book.content!.contentId } }, signal)
    return saved.file ?? publication
  }
  if (format === 'epub') return file
  const lease = await localEpubProvider(JSON.stringify([ref, book.content?.contentId]), file).open(await loadFoliateEngine(), signal)
  try {
    const chapters: string[] = []
    let length = 0
    for (const section of lease.book.sections ?? []) {
      signal.throwIfAborted()
      if (section.linear === 'no') continue
      let doc = await section.createDocument()
      if (edited) {
        const markup = await applyReplacementsWithWorker(new XMLSerializer().serializeToString(doc), rules, 'application/xhtml+xml', section.id)
        doc = new DOMParser().parseFromString(markup, 'application/xhtml+xml')
      }
      signal.throwIfAborted()
      for (const node of doc.querySelectorAll('script,style,noscript,template')) node.remove()
      for (const node of doc.querySelectorAll('br')) node.replaceWith(doc.createTextNode('\n'))
      for (const node of doc.querySelectorAll('p,div,section,article,h1,h2,h3,h4,h5,h6,li,blockquote,tr')) node.append(doc.createTextNode('\n'))
      const text = (doc.body?.textContent ?? '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
      length += text.length
      if (length > 24_000_000) throw new Error('Local text preparation exceeds the size limit')
      if (text) chapters.push(text)
    }
    return new Blob([chapters.join('\n\n')], { type: 'text/plain;charset=utf-8' })
  } finally { lease.release() }
}
