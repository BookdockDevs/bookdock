import { DOMParser } from '@xmldom/xmldom'
import JSZip from 'jszip'

/** The identifier only narrows the lookup; archive verification is mandatory. */
export async function readTxtEpubCandidate(buffer: Buffer): Promise<{ archive: JSZip; sourceId: string } | null> {
  try {
    const zip = await JSZip.loadAsync(buffer)
    const entry = zip.file('OEBPS/content.opf')
    if (!entry) return null
    const doc = new DOMParser({ onError: () => { throw new Error('Invalid package XML') } })
      .parseFromString(await entry.async('string'), 'application/xml')
    const identifier = Array.from(doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', 'identifier'))
      .find((element) => element.getAttribute('id') === doc.documentElement?.getAttribute('unique-identifier'))
    const sourceId = identifier?.textContent?.trim()
    return sourceId ? { archive: zip, sourceId } : null
  } catch {
    return null
  }
}

/** Fail closed: even added non-spine resources count as an archive change. */
export async function sameEpubArchive(candidate: JSZip, expectedBuffer: Buffer): Promise<boolean> {
  const expected = await JSZip.loadAsync(expectedBuffer)
  const names = Object.keys(candidate.files).filter((name) => !candidate.files[name]!.dir).sort()
  const expectedNames = Object.keys(expected.files).filter((name) => !expected.files[name]!.dir).sort()
  if (names.length !== expectedNames.length || names.some((name, index) => name !== expectedNames[index])) return false
  for (const name of names) {
    const [actual, reference] = await Promise.all([
      candidate.file(name)!.async('nodebuffer'), expected.file(name)!.async('nodebuffer'),
    ])
    if (!actual.equals(reference)) return false
  }
  return true
}
