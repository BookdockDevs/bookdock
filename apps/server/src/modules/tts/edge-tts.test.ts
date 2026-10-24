import { describe, expect, it } from 'vitest'

import { generateEdgeSecMsGec } from './edge-sec-ms-gec'
import { parseEdgeBinaryFrame, parseEdgeTextFrame, parseEdgeWordBoundaries } from './edge-tts'

function binaryFrame(path: string, body: string) {
  const headers = Buffer.from(`Path: ${path}\r\n`)
  const payload = Buffer.from(body)
  const prefix = Buffer.alloc(2)
  prefix.writeUInt16BE(headers.length)
  return Buffer.concat([prefix, headers, payload])
}

describe('Edge response frames', () => {
  it('reads metadata from text and binary frames', () => {
    const body = JSON.stringify({ Metadata: [{ Type: 'WordBoundary', Data: { Offset: 1, Duration: 2, text: { Text: 'word' } } }] })
    expect(parseEdgeTextFrame(`Path: audio.metadata\r\n\r\n${body}`)).toMatchObject({ path: 'audio.metadata', body })
    expect(parseEdgeBinaryFrame(binaryFrame('audio.metadata', body))).toMatchObject({ path: 'audio.metadata', body: Buffer.from(body) })
  })
})

describe('generateEdgeSecMsGec', () => {
  it('matches the upstream v2 known token vector', () => {
    expect(generateEdgeSecMsGec(1_791_888_000)).toBe('492D7694A183A45E-56E821F95D4579C5B7C7E33DC7303FF379EC36D510213555BBBB9EB17EF15876')
  })
})

describe('parseEdgeWordBoundaries', () => {
  it('keeps real word timing and text while ignoring sentence and malformed entries', () => {
    const boundaries = parseEdgeWordBoundaries(JSON.stringify({ Metadata: [
      { Type: 'WordBoundary', Data: { Offset: 100, Duration: 250, text: { Text: 'Hello' } } },
      { Type: 'SentenceBoundary', Data: { Offset: 350, Duration: 500, text: { Text: 'Hello.' } } },
      { Type: 'WordBoundary', Data: { Offset: -1, Duration: 1, text: { Text: 'bad' } } },
      { Type: 'WordBoundary', Data: { Offset: 350, Duration: 100, text: { Text: '世界' } } },
    ] }))

    expect(boundaries).toEqual([
      { offset: 100, duration: 250, text: 'Hello' },
      { offset: 350, duration: 100, text: '世界' },
    ])
  })

  it('returns no boundaries for absent or invalid metadata', () => {
    expect(parseEdgeWordBoundaries('{')).toEqual([])
    expect(parseEdgeWordBoundaries(JSON.stringify({ Metadata: [] }))).toEqual([])
  })
})
