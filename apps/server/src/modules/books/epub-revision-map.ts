import { createEpubMarkupRevisionMap, extractEpubMarkupText } from '@bookdock/shared'

import { loadEpubSpineMarkup } from '../../formats/epub'

export async function createEpubRevisionMap(sourceEpub: Buffer, targetEpub: Buffer, structuralHeadingIndexes: readonly number[] = []) {
  const [source, target] = await Promise.all([loadEpubSpineMarkup(sourceEpub), loadEpubSpineMarkup(targetEpub)])
  return createEpubMarkupRevisionMap(source, target, structuralHeadingIndexes)
}

export async function extractEpubSpineText(epub: Buffer) { return extractEpubMarkupText(await loadEpubSpineMarkup(epub)) }
