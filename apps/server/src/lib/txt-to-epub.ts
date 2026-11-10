import JSZip from 'jszip'

import { buildTxtEpubEntries } from '@bookdock/shared'
import type { TxtToEpubChapter, TxtToEpubCover, TxtToEpubMetadata } from '@bookdock/shared'

export { TXT_EPUB_ARTIFACT_VERSION } from '@bookdock/shared'
export type { TxtToEpubChapter, TxtToEpubCover, TxtToEpubMetadata } from '@bookdock/shared'

export async function convertTxtToEpub(
  metadata: TxtToEpubMetadata,
  chapters: TxtToEpubChapter[],
  contentFor: (index: number) => string,
  cover?: TxtToEpubCover,
): Promise<Buffer> {
  const zip = new JSZip()
  for (const entry of buildTxtEpubEntries(metadata, chapters, contentFor, cover)) {
    zip.file(entry.path, entry.data, entry.store ? { compression: 'STORE' } : undefined)
  }
  const arrayBuffer = await zip.generateAsync({ type: 'arraybuffer' })
  return Buffer.from(arrayBuffer)
}
