/**
 * Reads the family name from an sfnt (TrueType/OpenType, incl. CFF) name
 * table: nameID 16 (typographic family) preferred, nameID 1 as fallback.
 * Windows platform records (Unicode, UTF-16BE) win over Macintosh (1,0,0).
 *
 * woff/woff2 are never parsed and return null: woff2 is Brotli-compressed,
 * and pulling in a decoder dependency just to read a name string is not
 * worth it — callers fall back to the file name.
 *
 * Malformed input of any shape returns null; this function never throws.
 */
export function parseFontFamily(buffer: Buffer): string | null {
  try {
    if (buffer.length < 12) return null
    const sfntVersion = buffer.toString('ascii', 0, 4)
    if (sfntVersion === 'wOFF' || sfntVersion === 'wOF2') return null

    const numTables = buffer.readUInt16BE(4)
    let nameTableOffset = -1
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16
      if (rec + 16 > buffer.length) return null
      if (buffer.toString('ascii', rec, rec + 4) === 'name') {
        nameTableOffset = buffer.readUInt32BE(rec + 8)
        break
      }
    }
    if (nameTableOffset < 0 || nameTableOffset + 6 > buffer.length) return null

    const count = buffer.readUInt16BE(nameTableOffset + 2)
    const stringBase = nameTableOffset + buffer.readUInt16BE(nameTableOffset + 4)

    interface NameRecord {
      platform: number
      language: number
      nameId: number
      start: number
      length: number
    }
    const records: NameRecord[] = []
    for (let i = 0; i < count; i++) {
      const rec = nameTableOffset + 6 + i * 12
      if (rec + 12 > buffer.length) return null
      const start = stringBase + buffer.readUInt16BE(rec + 10)
      const length = buffer.readUInt16BE(rec + 8)
      if (start + length > buffer.length) continue
      records.push({
        platform: buffer.readUInt16BE(rec),
        language: buffer.readUInt16BE(rec + 4),
        nameId: buffer.readUInt16BE(rec + 6),
        start,
        length,
      })
    }

    const decode = (r: NameRecord): string => {
      const raw = buffer.subarray(r.start, r.start + r.length)
      return r.platform === 3
        ? Buffer.from(raw).swap16().toString('utf16le')
        : raw.toString('latin1')
    }

    for (const nameId of [16, 1]) {
      const candidates = records.filter((r) => r.nameId === nameId)
      const best =
        candidates.find((r) => r.platform === 3 && r.language === 0x409) ??
        candidates.find((r) => r.platform === 1 && r.language === 0) ??
        candidates.find((r) => r.platform === 3) ??
        candidates[0]
      if (!best) continue
      const family = decode(best).replaceAll('\0', '').trim()
      if (family) return family
    }
    return null
  } catch {
    return null
  }
}
