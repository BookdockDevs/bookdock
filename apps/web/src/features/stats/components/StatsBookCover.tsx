import { useState } from 'react'

import type { ReadingRecordBookItem } from '@bookdock/shared'

interface StatsBookCoverProps {
  item: ReadingRecordBookItem
}

export default function StatsBookCover({ item }: StatsBookCoverProps) {
  const [error, setError] = useState(false)

  if (item.coverKey && !error) {
    return (
      <img
        src={`/api/v1/books/${item.bookId}/cover?v=${encodeURIComponent(item.coverKey)}`}
        alt={item.title}
        className="h-14 w-10 shrink-0 rounded-lg border border-stone-200/70 object-cover dark:border-stone-800/60"
        onError={() => setError(true)}
        loading="lazy"
      />
    )
  }

  const initial = item.title.trim().match(/[\p{L}\p{N}]/u)?.[0]?.toUpperCase() ?? '?'
  return (
    <div className="flex h-14 w-10 shrink-0 items-center justify-center rounded-lg border border-stone-200/70 bg-stone-100 text-stone-500 dark:border-stone-800/60 dark:bg-stone-800 dark:text-stone-400">
      <span className="select-none font-serif text-base font-medium">{initial}</span>
    </div>
  )
}
