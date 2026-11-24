import { createEpubMarkupRevisionMap, extractEpubMarkupText } from '@bookdock/shared'
import type { TxtEditorChapterIds } from '@bookdock/shared'

import { loadEpubSpineMarkup } from '../../formats/epub'

export async function createEpubRevisionMap(sourceEpub: Buffer, targetEpub: Buffer, structuralHeadingIndexes: readonly number[] = [], txtEditorChapterIds?: TxtEditorChapterIds) {
  const [source, target] = await Promise.all([loadEpubSpineMarkup(sourceEpub), loadEpubSpineMarkup(targetEpub)])
  return createEpubMarkupRevisionMap(source, target, structuralHeadingIndexes, txtEditorChapterIds)
}

export async function extractEpubSpineText(epub: Buffer) { return extractEpubMarkupText(await loadEpubSpineMarkup(epub)) }
