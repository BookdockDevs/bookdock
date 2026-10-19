import type { ReadingRecordCreateReq } from '@bookdock/shared'

const MAX_CHUNK_MS = 24 * 3600 * 1000

export function splitReadingRecord(record: ReadingRecordCreateReq): ReadingRecordCreateReq[] {
  if (record.durationSeconds <= MAX_CHUNK_MS / 1000 && (record.fragments?.length ?? 0) <= 5000) return [record]
  if (!record.fragments?.length) return [record]

  const chunks: Array<Array<{ startedAt: number; endedAt: number }>> = [[]]
  let chunkMs = 0
  for (const fragment of record.fragments) {
    let startedAt = fragment.startedAt
    while (startedAt < fragment.endedAt) {
      if (chunkMs === MAX_CHUNK_MS || chunks.at(-1)!.length === 5000) {
        chunks.push([])
        chunkMs = 0
      }
      const endedAt = Math.min(fragment.endedAt, startedAt + MAX_CHUNK_MS - chunkMs)
      chunks.at(-1)!.push({ startedAt, endedAt })
      chunkMs += endedAt - startedAt
      startedAt = endedAt
    }
  }
  return chunks.filter((fragments) => fragments.length).map((fragments, index) => ({
    ...record,
    requestId: `${record.requestId}.${index}`,
    startedAt: fragments[0].startedAt,
    endedAt: fragments.at(-1)!.endedAt,
    durationSeconds: Math.max(1, Math.round(fragments.reduce((sum, item) => sum + item.endedAt - item.startedAt, 0) / 1000)),
    fragments,
    // Coverage has no per-fragment timestamps; preserve it once for the session.
    coverage: index === 0 ? record.coverage : [],
  }))
}
