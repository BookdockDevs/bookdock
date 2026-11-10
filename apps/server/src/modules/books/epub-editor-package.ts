import { patchEpubPackage as patchPackage, readEpubEditorPackage as readPackage } from '@bookdock/shared'
import type { EditorEpubSaveReq } from '@bookdock/shared'

import { loadEpubSpineMarkup } from '../../formats/epub'

const loadSpine = (source: Uint8Array) => loadEpubSpineMarkup(Buffer.from(source))

export function readEpubEditorPackage(source: Buffer) {
  return readPackage(source, loadSpine)
}

export async function patchEpubPackage(source: Buffer, request: EditorEpubSaveReq): Promise<Buffer> {
  return Buffer.from(await patchPackage(source, request, loadSpine))
}
