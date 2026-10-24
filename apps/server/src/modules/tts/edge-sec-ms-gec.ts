import { createHash } from 'node:crypto'

const EDGE_GEC_EPOCH_OFFSET_SECONDS = 11_644_473_600
const EDGE_GEC_SALT = 'Copyright (C) Microsoft Corporation. All rights reserved.'
const CS64_COEFFICIENTS = [
  [0xe82e91b1, 0xb32700d0], [0x44de24c6, 0x88dff51d], [0x3beb65bc, 0x29514038], [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5], [0x314ef5d5, 0x26e55f3c], [0xe92491b1, 0x607801c6], [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da], [0xda79fa60, 0x207cc464], [0xbed20560, 0x3c3c74f3], [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1], [0xcb49e3c6, 0xc5626167],
]

function add32(...values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) >>> 0
}

function multiply32(left: number, right: number) {
  return Math.imul(left, right) >>> 0
}

function rotate16(value: number) {
  return ((value << 16) | (value >>> 16)) >>> 0
}

function cs64Digest(input: Uint8Array, digest: Uint8Array) {
  const keyA = ((digest[0]! | (digest[1]! << 8) | (digest[2]! << 16) | (digest[3]! << 24)) | 1) >>> 0
  const keyB = ((digest[4]! | (digest[5]! << 8) | (digest[6]! << 16) | (digest[7]! << 24)) | 1) >>> 0
  const factorA = multiply32(keyA, 0x82893933)
  const factorB = multiply32(keyB, 0x82893933)
  const terms = CS64_COEFFICIENTS.map(([coefficient], index) => multiply32(coefficient!, index % 2 === 0 ? factorA : factorB))
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => offset!)
  const bytes = [0, ...input]
  while (bytes.length % 4 !== 0) bytes.push(0)
  const words: number[] = []
  for (let i = 0; i < bytes.length; i += 4) words.push((bytes[i]! | (bytes[i + 1]! << 8) | (bytes[i + 2]! << 16) | (bytes[i + 3]! << 24)) >>> 0)
  if (words.length % 2 !== 0) words.push(0)

  words.forEach((word, index) => {
    const term = multiply32(word, index % 2 === 0 ? keyA : keyB)
    let offset = multiply32(rotate16(word), index % 2 === 0 ? 0xef0569fb : 0xc31713db)
    if (index === 0) {
      terms.push(add32(term, multiply32(0xf2f90b1a, factorA)))
      offset = add32(offset, 0x0b1a0000)
    } else {
      terms.push(term)
    }
    offsets.push(offset)
  })

  let sumSwaps = 0
  let lastSwap = 0
  let state = 0
  let accumulator = 0
  for (let i = 0; i < terms.length; i += 2) {
    let value = rotate16(add32(offsets[i]!, terms[i]!))
    let mixed = multiply32(value, 0x76f50f34)
    sumSwaps = add32(sumSwaps, multiply32(rotate16(mixed), 0xc3efea97), mixed)
    value = rotate16(add32(offsets[i + 1]!, terms[i + 1]!))
    mixed = multiply32(value, 0x1881ce3c)
    lastSwap = add32(multiply32(rotate16(mixed), 0x35bd1ec9), mixed)
    sumSwaps = add32(sumSwaps, lastSwap)

    state = multiply32(state, keyA)
    state = add32(state, terms[i]!)
    for (const factor of [0xcf98b111, 0x87085b9f, 0x12ceb96d, 0x257e1d83]) state = multiply32(rotate16(state), factor)
    accumulator = add32(accumulator, state)
    let next = add32(multiply32(state, keyB), terms[i + 1]!)
    next = multiply32(rotate16(next), 0xa27416f5)
    next = multiply32(rotate16(next), 0xd38396ff)
    state = multiply32(rotate16(multiply32(rotate16(next), 0x7c932b89)), 0xbfa49f69)
    accumulator = add32(accumulator, state)
  }
  const result = new Uint8Array(8)
  const outputWords = [lastSwap ^ state, sumSwaps ^ accumulator]
  outputWords.forEach((word, index) => {
    result[index * 4] = word
    result[index * 4 + 1] = word >>> 8
    result[index * 4 + 2] = word >>> 16
    result[index * 4 + 3] = word >>> 24
  })
  return result
}

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function generateEdgeSecMsGec(unixTimestamp = Date.now() / 1000) {
  let seconds = unixTimestamp + EDGE_GEC_EPOCH_OFFSET_SECONDS
  seconds -= seconds % 300
  const input = new TextEncoder().encode(`${(seconds * 10_000_000).toFixed(0)}${'6A5AA1D4EAFF4E9FB37E23D68491D6F4'}`)
  const digest = createHash('sha256').update(EDGE_GEC_SALT).update(input).digest()
  return `${toHex(cs64Digest(input, digest))}-${toHex(digest)}`
}
