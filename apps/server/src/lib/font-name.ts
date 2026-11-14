import { inflateSync } from 'node:zlib'

/** Language-tagged name records extracted from an sfnt name table. */
export interface FontNames {
  /** Cross-language family: nameID 16 preferred over 1, Windows English over
   *  Macintosh Roman over other Windows languages. The display fallback when
   *  no localized name matches the UI language. */
  family: string | null
  /** Windows LANGID (hex key, e.g. `804` for zh-CN) → display name, full
   *  name (nameID 4) preferred over typographic family (16) then family (1).
   *  Null when the file carries no usable Windows name records. */
  localNames: Record<string, string> | null
}

const MAX_LOCAL_NAMES = 12
// A name table holding a few dozen strings is a few KB; 1 MB is far beyond
// any legitimate font and bounds the inflate below against decompression
// bombs (a tiny WOFF claiming/producing a huge table)
const MAX_NAME_TABLE_BYTES = 1024 * 1024

interface NameRecord {
  platform: number
  language: number
  nameId: number
  start: number
  length: number
}

function decodeRecord(bytes: Uint8Array, r: NameRecord): string {
  const raw = bytes.subarray(r.start, r.start + r.length)
  if (r.platform === 1) return new TextDecoder('latin1').decode(raw)
  // Platforms 0 (Unicode) and 3 (Windows) store UTF-16BE
  const swapped = new Uint8Array(raw.length)
  for (let i = 0; i + 1 < raw.length; i += 2) {
    swapped[i] = raw[i + 1]!
    swapped[i + 1] = raw[i]!
  }
  return new TextDecoder('utf-16le').decode(swapped)
}

function readNameTable(table: Uint8Array): NameRecord[] | null {
  try {
    if (table.length < 6) return null
    const view = new DataView(table.buffer, table.byteOffset, table.byteLength)
    const count = view.getUint16(2)
    const stringBase = view.getUint16(4)
    const records: NameRecord[] = []
    for (let i = 0; i < count; i++) {
      const rec = 6 + i * 12
      if (rec + 12 > table.length) return null
      const start = stringBase + view.getUint16(rec + 10)
      const length = view.getUint16(rec + 8)
      if (start + length > table.length) continue
      records.push({ platform: view.getUint16(rec), language: view.getUint16(rec + 4), nameId: view.getUint16(rec + 6), start, length })
    }
    return records
  } catch {
    return null
  }
}

function locateNameTable(buffer: Buffer): Uint8Array | null {
  try {
    if (buffer.length < 12) return null
    const version = buffer.toString('ascii', 0, 4)
    if (version === 'wOF2') return null
    if (version === 'wOFF') {
      const numTables = buffer.readUInt16BE(12)
      for (let i = 0; i < numTables; i++) {
        const rec = 44 + i * 20
        if (rec + 20 > buffer.length) return null
        if (buffer.toString('ascii', rec, rec + 4) !== 'name') continue
        const offset = buffer.readUInt32BE(rec + 4)
        const compLength = buffer.readUInt32BE(rec + 8)
        const origLength = buffer.readUInt32BE(rec + 12)
        if (offset + compLength > buffer.length) return null
        if (origLength > MAX_NAME_TABLE_BYTES) return null
        const stored = buffer.subarray(offset, offset + compLength)
        // WOFF1 table entries are zlib-compressed whenever the stored bytes
        // are shorter than the original table; maxOutputLength rejects
        // decompression bombs before the buffer is allocated
        return compLength < origLength
          ? inflateSync(stored, { maxOutputLength: MAX_NAME_TABLE_BYTES })
          : stored
      }
      return null
    }
    const numTables = buffer.readUInt16BE(4)
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (rec + 16 > buffer.length) return null
      if (buffer.toString('ascii', rec, rec + 4) === 'name') {
        const offset = buffer.readUInt32BE(rec + 8)
        const length = buffer.readUInt32BE(rec + 12)
        if (offset + length > buffer.length) return null
        return buffer.subarray(offset, offset + length)
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Reads display names from an sfnt (TrueType/OpenType, incl. CFF) name
 * table, and WOFF1 via zlib inflate. WOFF2 is Brotli-compressed and is not
 * parsed (callers fall back to the file name). Malformed input of any shape
 * returns nulls; this function never throws.
 */
export function parseFontNames(buffer: Buffer): FontNames {
  const empty: FontNames = { family: null, localNames: null }
  try {
    const table = locateNameTable(buffer)
    if (!table) return empty
    const records = readNameTable(table)
    if (!records) return empty

    const decode = (r: NameRecord): string => decodeRecord(table, r).replaceAll('\0', '').trim()

    const localNames: Record<string, string> = {}
    const preferredNameIds = [4, 16, 1]
    const windowsRecords = records.filter((r) => r.platform === 3 && preferredNameIds.includes(r.nameId))
    const languages = [...new Set(windowsRecords.map((r) => r.language))].slice(0, MAX_LOCAL_NAMES)
    for (const language of languages) {
      // Full name preferred, then typographic family, then family
      for (const nameId of preferredNameIds) {
        const record = windowsRecords.find((c) => c.language === language && c.nameId === nameId)
        if (!record) continue
        const value = decode(record)
        if (!value) continue
        localNames[language.toString(16)] = value
        break
      }
    }

    let family: string | null = null
    for (const nameId of [16, 1]) {
      const candidates = records.filter((r) => r.nameId === nameId)
      const best =
        candidates.find((r) => r.platform === 3 && r.language === 0x409) ??
        candidates.find((r) => r.platform === 1 && r.language === 0) ??
        candidates.find((r) => r.platform === 3) ??
        candidates[0]
      if (!best) continue
      const candidate = decode(best)
      if (candidate) {
        family = candidate
        break
      }
    }
    return { family, localNames: Object.keys(localNames).length > 0 ? localNames : null }
  } catch {
    return empty
  }
}

/** Cross-language family only; see parseFontNames for localized names. */
export function parseFontFamily(buffer: Buffer): string | null {
  return parseFontNames(buffer).family
}
