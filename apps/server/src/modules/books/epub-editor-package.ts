import { patchEpubPackage as patchPackage, readEpubEditorPackage as readPackage } from '@bookdock/shared'
import type { EditorEpubSaveReq } from '@bookdock/shared'

import { loadEpubSpineMarkupFromZip } from '../../formats/epub'

// Reuse the archive the package reader already opened; decompressing the same
// EPUB twice was the most expensive part of opening and saving the workbench.
const loadSpine = (_source: Uint8Array, zip: Parameters<typeof loadEpubSpineMarkupFromZip>[0]) => loadEpubSpineMarkupFromZip(zip)

export function readEpubEditorPackage(source: Buffer) {
  return readPackage(source, loadSpine)
}

export async function patchEpubPackage(source: Buffer, request: EditorEpubSaveReq): Promise<Buffer> {
  return Buffer.from(await patchPackage(source, request, loadSpine))
}
