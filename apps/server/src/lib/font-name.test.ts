import { describe, it, expect } from 'vitest'

import { parseFontFamily } from './font-name'

interface NameEntry {
  platform: number
  encoding: number
  language: number
  nameId: number
  text: string
}

function buildSfnt(entries: NameEntry[]): Buffer {
  const records: Buffer[] = []
  const strings: Buffer[] = []
  let offset = 0
  for (const e of entries) {
    const str =
      e.platform === 3
        ? Buffer.from(e.text, 'utf16le').swap16()
        : Buffer.from(e.text, 'latin1')
    const rec = Buffer.alloc(12)
    rec.writeUInt16BE(e.platform, 0)
    rec.writeUInt16BE(e.encoding, 2)
    rec.writeUInt16BE(e.language, 4)
    rec.writeUInt16BE(e.nameId, 6)
    rec.writeUInt16BE(str.length, 8)
    rec.writeUInt16BE(offset, 10)
    records.push(rec)
    strings.push(str)
    offset += str.length
  }
  const header6 = Buffer.alloc(6)
  header6.writeUInt16BE(entries.length, 2)
  header6.writeUInt16BE(6 + entries.length * 12, 4)
  const nameTable = Buffer.concat([header6, ...records, ...strings])

  const header = Buffer.alloc(12)
  header.writeUInt32BE(0x00010000, 0)
  header.writeUInt16BE(1, 4)
  const tableRec = Buffer.alloc(16)
  tableRec.write('name', 0, 'ascii')
  tableRec.writeUInt32BE(28, 8)
  tableRec.writeUInt32BE(nameTable.length, 12)
  return Buffer.concat([header, tableRec, nameTable])
}

describe('parseFontFamily', () => {
  it('returns null for empty or truncated buffers', () => {
    expect(parseFontFamily(Buffer.alloc(0))).toBeNull()
    expect(parseFontFamily(Buffer.alloc(8))).toBeNull()
  })

  it('returns null for woff/woff2 without parsing', () => {
    const woff = Buffer.concat([Buffer.from('wOFF', 'ascii'), Buffer.alloc(64)])
    const woff2 = Buffer.concat([Buffer.from('wOF2', 'ascii'), Buffer.alloc(64)])
    expect(parseFontFamily(woff)).toBeNull()
    expect(parseFontFamily(woff2)).toBeNull()
  })

  it('returns null when there is no name table', () => {
    const header = Buffer.alloc(12)
    header.writeUInt32BE(0x00010000, 0)
    header.writeUInt16BE(0, 4)
    expect(parseFontFamily(header)).toBeNull()
  })

  it('returns null for garbage that claims more tables than it holds', () => {
    const buf = Buffer.alloc(20, 0xaa)
    buf.writeUInt16BE(100, 4)
    expect(parseFontFamily(buf)).toBeNull()
  })

  it('prefers nameID 16 over nameID 1', () => {
    const buf = buildSfnt([
      { platform: 3, encoding: 1, language: 0x409, nameId: 1, text: 'Plain Family' },
      { platform: 3, encoding: 1, language: 0x409, nameId: 16, text: 'Typo Family' },
    ])
    expect(parseFontFamily(buf)).toBe('Typo Family')
  })

  it('falls back to nameID 1 when 16 is absent', () => {
    const buf = buildSfnt([
      { platform: 3, encoding: 1, language: 0x409, nameId: 1, text: 'Plain Family' },
    ])
    expect(parseFontFamily(buf)).toBe('Plain Family')
  })

  it('decodes CJK family names from UTF-16BE Windows records', () => {
    const buf = buildSfnt([
      { platform: 3, encoding: 1, language: 0x409, nameId: 16, text: '霞鹜文楷' },
    ])
    expect(parseFontFamily(buf)).toBe('霞鹜文楷')
  })

  it('prefers the Windows (3,1,0x409) record over Macintosh (1,0,0)', () => {
    const buf = buildSfnt([
      { platform: 1, encoding: 0, language: 0, nameId: 1, text: 'Mac Name' },
      { platform: 3, encoding: 1, language: 0x409, nameId: 1, text: 'Win Name' },
    ])
    expect(parseFontFamily(buf)).toBe('Win Name')
  })

  it('falls back to the Macintosh record when no Windows record exists', () => {
    const buf = buildSfnt([
      { platform: 1, encoding: 0, language: 0, nameId: 1, text: 'Mac Name' },
    ])
    expect(parseFontFamily(buf)).toBe('Mac Name')
  })
})
