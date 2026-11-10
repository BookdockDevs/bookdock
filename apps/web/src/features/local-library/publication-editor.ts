import { buildTxtEditorSource, editorTxtSaveSchema, normalizeTxtEditorContent } from '@bookdock/shared'
import type { ClientBookRef, EditorTxtSaveReq, EditorTxtSaveRes } from '@bookdock/shared'

import { processEpubInWorker } from './epub-editor-worker'
import { prepareEditedTxtInWorker } from './prepare-txt-worker'
import { LocalLibraryError, LocalLibraryRepository, localLibraryRepository } from './repository'

export async function saveLocalTxt(ref: ClientBookRef, input: EditorTxtSaveReq, contentId: string, signal: AbortSignal, repository: LocalLibraryRepository = localLibraryRepository): Promise<{ data: EditorTxtSaveRes }> {
  const draft = editorTxtSaveSchema.parse(input)
  const book = await repository.getBook(ref)
  if (book.format !== 'txt' || !book.textSource || book.availability !== 'available') throw new LocalLibraryError('unavailable-content', 'Local TXT source is unavailable')
  const replay = book.content?.contentId === contentId
  if (book.content?.contentId !== draft.baseRevisionId && !replay) throw new LocalLibraryError('conflict', 'Publication changed in another editor')
  const text = await repository.getNormalizedTxt(ref, replay ? contentId : draft.baseRevisionId, signal)
  const built = buildTxtEditorSource(draft.chapters)
  const unchanged = book.textSource.chapters.length === built.sourceChapters.length && book.textSource.chapters.every((chapter, index) => {
    const next = built.sourceChapters[index]!
    return chapter.title === next.title && chapter.level === next.level && normalizeTxtEditorContent(text.slice(chapter.contentStartOffset, chapter.endOffset)) === next.content
  })
  const selection = draft.tocRuleSelection
  const ruleSelection = selection ? { patterns: selection.patterns, label: selection.label, auto: selection.auto } : book.textSource.ruleSelection
  if (replay) {
    if (!unchanged || JSON.stringify(book.textSource.ruleSelection) !== JSON.stringify(ruleSelection)) throw new LocalLibraryError('conflict', 'Publication save payload changed')
    return { data: await repository.readPublicationSaveResult(ref, contentId) }
  }
  if (unchanged) {
    await repository.saveTxtRuleSelection(ref, draft.baseRevisionId, ruleSelection, signal)
    return { data: { revisionId: draft.baseRevisionId, changed: false, unlocated: { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 } } }
  }
  const prepared = await prepareEditedTxtInWorker(draft, book.textSource.fileName, book.title, contentId, signal)
  signal.throwIfAborted()
  const source = { ...prepared.source, ...(ruleSelection ? { ruleSelection } : {}) }
  return { data: await repository.replacePublication({ book: ref, baseContentId: draft.baseRevisionId, contentId, textSource: source }, prepared.normalizedText, prepared, signal, draft.chapters.flatMap((chapter, index) => chapter.structureOnlyTitle ? [index] : [])) }
}

export async function readLocalEpub(ref: ClientBookRef, revision: string, signal: AbortSignal, repository: LocalLibraryRepository = localLibraryRepository) {
  const book = await repository.getBook(ref)
  if (book.format !== 'epub' || book.content?.contentId !== revision) throw new LocalLibraryError('conflict', 'Publication revision changed')
  const result = await processEpubInWorker({ file: await repository.getFile(ref) }, signal)
  signal.throwIfAborted()
  if ((await repository.getBook(ref)).content?.contentId !== revision) throw new LocalLibraryError('conflict', 'Publication revision changed')
  return { data: { ...result.source, revisionId: revision } }
}

export async function saveLocalEpub(ref: ClientBookRef, draft: import('@bookdock/shared').EditorEpubSaveReq, contentId: string, signal: AbortSignal, repository: LocalLibraryRepository = localLibraryRepository): Promise<{ data: EditorTxtSaveRes }> {
  const book = await repository.getBook(ref)
  if (book.format !== 'epub') throw new LocalLibraryError('unavailable-content', 'Local EPUB source is unavailable')
  const replay = book.content?.contentId === contentId
  if (book.content?.contentId !== draft.baseRevisionId && !replay) throw new LocalLibraryError('conflict', 'Publication changed in another editor')
  const result = await processEpubInWorker({ file: await repository.getFile(ref), draft }, signal)
  signal.throwIfAborted()
  if (replay) {
    if (result.file) throw new LocalLibraryError('conflict', 'Publication save payload changed')
    return { data: await repository.readPublicationSaveResult(ref, contentId) }
  }
  if (!result.file) {
    await repository.assertPublicationRevision(ref, draft.baseRevisionId)
    return { data: { revisionId: draft.baseRevisionId, changed: false, unlocated: { progress: 0, coverage: 0, highlights: 0, bookmarks: 0, notes: 0, pointReplacements: 0 } } }
  }
  return { data: await repository.replacePublication({ book: ref, baseContentId: draft.baseRevisionId, contentId }, result.file, undefined, signal) }
}
