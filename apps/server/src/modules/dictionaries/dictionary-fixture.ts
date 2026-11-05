import { deflateSync } from 'node:zlib'

function number(value: number, size = 8) {
  const buffer = Buffer.alloc(size)
  if (size === 8) buffer.writeBigUInt64BE(BigInt(value))
  else if (size === 4) buffer.writeUInt32BE(value)
  else buffer.writeUInt16BE(value)
  return buffer
}
function checksum(bytes: Buffer) {
  let a = 1, b = 0
  for (const value of bytes) { a = (a + value) % 65521; b = (b + a) % 65521 }
  return ((b << 16) | a) >>> 0
}
function packed(bytes: Buffer) { return Buffer.concat([Buffer.from([2, 0, 0, 0]), number(checksum(bytes), 4), deflateSync(bytes)]) }

export function dictionaryFixture(entries: Record<string, string | Buffer>, resource = false, stylesheet = '') {
  const words = Object.keys(entries).sort()
  const encode = (value: string) => Buffer.from(value, resource ? 'utf16le' : 'utf8')
  const nul = Buffer.alloc(resource ? 2 : 1)
  const records = words.map((word) => Buffer.isBuffer(entries[word]) ? entries[word] as Buffer : Buffer.from(entries[word] as string))
  let offset = 0
  const keyParts = words.map((word, index) => {
    const result = Buffer.concat([number(offset), encode(word), nul])
    offset += records[index]!.length
    return result
  })
  const split = Math.max(1, Math.floor(words.length / 2))
  const groups = [words.slice(0, split), words.slice(split)].filter((group) => group.length)
  let cursor = 0
  const keyBlocks: Buffer[] = []
  const infos = groups.map((group) => {
    const keys = Buffer.concat(keyParts.slice(cursor, cursor + group.length))
    cursor += group.length
    const block = packed(keys)
    keyBlocks.push(block)
    return Buffer.concat([number(group.length), number(group[0]!.length, 2), encode(group[0]!), nul, number(group[group.length - 1]!.length, 2), encode(group[group.length - 1]!), nul, number(block.length), number(keys.length)])
  })
  const info = Buffer.concat(infos), compressedInfo = packed(info)
  const rawRecords = Buffer.concat(records), compressedRecords = packed(rawRecords)
  const tag = resource ? 'Library_Data' : 'Dictionary'
  const escapedStyle = stylesheet.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
  const header = Buffer.from(`<${tag} GeneratedByEngineVersion="2.0" RequiredEngineVersion="2.0" Encrypted="0" Encoding="${resource ? 'UTF-16' : 'UTF-8'}" Format="Html" KeyCaseSensitive="No" StripKey="Yes" Title="Bookdock Test Dictionary" StyleSheet="${escapedStyle}"/>\0`, 'utf16le')
  const headerChecksum = Buffer.alloc(4); headerChecksum.writeUInt32LE(checksum(header))
  const keyHeader = Buffer.concat([number(groups.length), number(words.length), number(info.length), number(compressedInfo.length), number(Buffer.concat(keyBlocks).length)])
  return Buffer.concat([number(header.length, 4), header, headerChecksum, keyHeader, number(checksum(keyHeader), 4), compressedInfo, ...keyBlocks, number(1), number(words.length), number(16), number(compressedRecords.length), number(compressedRecords.length), number(rawRecords.length), compressedRecords])
}
