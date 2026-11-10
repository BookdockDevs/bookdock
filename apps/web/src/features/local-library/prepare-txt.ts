import chardet from 'chardet'
import JSZip from 'jszip'

import { buildTxtEditorSource, buildTxtEpubEntries, clientTxtPublicationSchema, editorTxtSaveSchema, CONTENT_EDITOR_MAX_TEXT_CHARS, countWords, normalizeTxtText, scanTxtChapterBoundaries, TXT_EPUB_ARTIFACT_VERSION } from '@bookdock/shared'
import type { ClientTxtPublication, EditorTxtSaveReq } from '@bookdock/shared'

export interface PreparedLocalTxt {
  source: ClientTxtPublication
  publication: Blob
  normalizedText: Blob
}

export async function decodeLocalTxt(file: Blob) {
  if (!file.size || file.size > 64 * 1024 * 1024) throw new Error('TXT file must be between 1 byte and 64 MiB')
  const bytes = new Uint8Array(await file.arrayBuffer())
  let encoding: string
  if (bytes[0] === 0xff && bytes[1] === 0xfe && bytes[2] === 0 && bytes[3] === 0) encoding = 'UTF-32LE'
  else if (bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 0xfe && bytes[3] === 0xff) encoding = 'UTF-32BE'
  else if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'UTF-16LE'
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'UTF-16BE'
  else encoding = chardet.detect(bytes.subarray(0, 1024 * 1024)) ?? 'UTF-8'
  let text: string
  if (/^UTF-32(?:LE|BE)$/i.test(encoding)) {
    if (bytes.length % 4) throw new Error('Invalid UTF-32 text length')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const chunks: string[] = []
    let chunk: number[] = []
    for (let index = 0; index < bytes.length; index += 4) {
      const value = view.getUint32(index, encoding.toUpperCase().endsWith('LE'))
      if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw new Error('Invalid UTF-32 code point')
      chunk.push(value)
      if (chunk.length === 4096) { chunks.push(String.fromCodePoint(...chunk)); chunk = [] }
    }
    if (chunk.length) chunks.push(String.fromCodePoint(...chunk))
    text = chunks.join('')
  } else {
    text = new TextDecoder(encoding, { fatal: true }).decode(bytes)
  }
  assertPublicationText(text)
  return { text, encoding }
}

function assertPublicationText(text: string, title = ''): void {
  // XML 1.0 cannot represent these controls, even as numeric references.
  // oxlint-disable-next-line no-control-regex
  const invalid = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/
  if (invalid.test(text) || invalid.test(title)) throw new Error('TXT file contains invalid publication characters')
  if (text.length > CONTENT_EDITOR_MAX_TEXT_CHARS) throw new Error('TXT exceeds the text processing limit')
}

export async function prepareLocalTxt(file: Blob, fileName: string, title: string, contentId: string): Promise<PreparedLocalTxt> {
  const { text, encoding } = await decodeLocalTxt(file)
  const normalized = normalizeTxtText(text)
  if (!normalized.trim()) throw new Error('TXT file has no readable text')
  const chapters = scanTxtChapterBoundaries(normalized, undefined, undefined, { maxChapters: 10_000 }).map((chapter) => ({ ...chapter, wordCount: countWords(normalized.slice(chapter.contentStartOffset, chapter.endOffset)) }))
  const source = clientTxtPublicationSchema.parse({ schemaVersion: 1, fileName, encoding, artifactVersion: TXT_EPUB_ARTIFACT_VERSION, normalizedLength: normalized.length, chapters })
  return buildLocalTxtPublication(normalized, source, title, contentId)
}

export async function prepareEditedLocalTxt(input: EditorTxtSaveReq, fileName: string, title: string, contentId: string): Promise<PreparedLocalTxt> {
  const draft = editorTxtSaveSchema.parse(input)
  const built = buildTxtEditorSource(draft.chapters)
  const chapters = built.chapters.map((chapter, index) => ({ ...chapter, endOffset: built.chapters[index + 1]?.startOffset ?? built.text.length }))
  const source = clientTxtPublicationSchema.parse({ schemaVersion: 1, fileName, encoding: 'UTF-8', artifactVersion: TXT_EPUB_ARTIFACT_VERSION, normalizedLength: built.text.length, chapters, ...(draft.tocRuleSelection ? { ruleSelection: { patterns: draft.tocRuleSelection.patterns, label: draft.tocRuleSelection.label, auto: draft.tocRuleSelection.auto } } : {}) })
  return buildLocalTxtPublication(built.text, source, title, contentId)
}

async function buildLocalTxtPublication(normalized: string, source: ClientTxtPublication, title: string, contentId: string): Promise<PreparedLocalTxt> {
  assertPublicationText(normalized, title)
  const chapters = source.chapters
  const zip = new JSZip()
  let totalBytes = 0
  for (const entry of buildTxtEpubEntries({ title, id: contentId }, chapters.map((chapter) => ({ ...chapter, id: `ch-${chapter.startOffset}` })), (index) => normalized.slice(chapters[index]!.contentStartOffset, chapters[index]!.endOffset))) {
    const size = typeof entry.data === 'string' ? new TextEncoder().encode(entry.data).byteLength : entry.data.byteLength
    totalBytes += size
    if (size > 64 * 1024 * 1024 || totalBytes > 512 * 1024 * 1024) throw new Error('Generated TXT publication exceeds the resource limit')
    zip.file(entry.path, entry.data, { createFolders: false, date: new Date('1980-01-01T00:00:00Z'), ...(entry.store ? { compression: 'STORE' as const } : {}) })
  }
  const publication = new Blob([await zip.generateAsync({ type: 'arraybuffer', compression: 'DEFLATE' })], { type: 'application/epub+zip' })
  return { source, publication, normalizedText: new Blob([normalized], { type: 'text/plain;charset=utf-8' }) }
}
