import { useTranslation } from '@/hooks/useTranslation'
import type { RecentlyReadStyle } from '@/stores/ui.store'

import RecentlyReadCards from './RecentlyReadCards'
import RecentlyReadCovers from './RecentlyReadCovers'
import { useBooks } from '../hooks'

const MAX_RECENT = 12
const INITIAL_FETCH = 30

interface RecentlyReadProps {
  style: Exclude<RecentlyReadStyle, 'off'>
}

export default function RecentlyRead({ style }: RecentlyReadProps) {
  const _ = useTranslation()

  const { data, isLoading } = useBooks({
    page: 1,
    pageSize: INITIAL_FETCH,
    search: '',
    sortBy: 'lastReadAt',
    sortOrder: 'desc',
    shelfId: null,
    tagId: null,
    format: null,
    readStatus: null,
    trash: false,
  })

  const books = (data?.data ?? [])
    .filter(
      (b) =>
        b.progress != null &&
        b.readStatus !== 'finished' &&
        b.readStatus !== 'wishlist' &&
        b.readStatus !== 'idle' &&
        b.readStatus !== 'abandoned',
    )
    .slice(0, MAX_RECENT)

  if (isLoading || books.length === 0) return null

  return (
    <section className="group mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {_('library.recentlyRead')}
      </h2>
      {style === 'covers' ? <RecentlyReadCovers books={books} /> : <RecentlyReadCards books={books} />}
    </section>
  )
}
