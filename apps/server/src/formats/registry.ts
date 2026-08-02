import type { Readable } from 'node:stream'

import type { BookMetadata } from '@bookdock/shared'

export interface ParsedBook {
  meta: {
    title: string
    author?: string
    cover?: Buffer
    bookmeta?: BookMetadata
  }
  chapters: { title: string; content: string; wordCount?: number }[]
}

export interface FormatParser {
  match(fileName: string, mime: string): boolean
  parse(data: Buffer | Readable): Promise<ParsedBook>
}

const parsers: FormatParser[] = []

export function registerParser(parser: FormatParser): void {
  parsers.push(parser)
}

export function getParser(fileName: string, mime: string): FormatParser | undefined {
  return parsers.find((p) => p.match(fileName, mime))
}
