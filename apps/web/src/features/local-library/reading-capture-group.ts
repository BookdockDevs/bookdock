import { clientReadingCaptureGroupSchema, clientReadingCaptureSchema, splitReadingTime, type ClientBookRef, type ReadingRecordCreateReq } from '@bookdock/shared'

import { splitReadingRecord } from '../reader/lib/reading-record-chunks'

export function localTimerCaptureGroup(book: ClientBookRef, record: ReadingRecordCreateReq) {
  const measuredSeconds = (record.fragments ?? []).reduce((sum, fragment) => sum + (fragment.endedAt - fragment.startedAt) / 1000, 0)
  // A floored duration can hide an oversized measured tail from the splitter.
  const chunks = splitReadingRecord({ ...record, durationSeconds: Math.max(record.durationSeconds, Math.ceil(measuredSeconds)) })
  const captures = (chunks.length === 1 ? [record] : chunks).map((chunk) => {
    const { bookId, expectedUserId, replaceSessionIds, finished, ...capture } = chunk
    if (bookId !== book.bookId || expectedUserId !== undefined || replaceSessionIds !== undefined || finished !== undefined) throw new Error('Timer capture belongs to a different operation')
    const first = capture.fragments?.[0]
    const date = chunks.length > 1 && first && capture.timezone ? splitReadingTime([{ startedAt: first.startedAt, endedAt: first.startedAt + 1 }], capture.timezone)[0]!.date : capture.date
    return clientReadingCaptureSchema.parse({ ...capture, date, book })
  })
  return clientReadingCaptureGroupSchema.parse({ id: record.requestId, book, captures })
}
