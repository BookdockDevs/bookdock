import { useTranslation } from '@/hooks/useTranslation'
import type { RecentlyReadStyle } from '@bookdock/shared'

import RecentlyReadCards from './RecentlyReadCards'
import RecentlyReadCovers from './RecentlyReadCovers'
import { useBooks } from '../hooks'
import QueryErrorState from '@/components/ui/QueryErrorState'

const MAX_RECENT = 12
const INITIAL_FETCH = 30

interface RecentlyReadProps {
  style: Exclude<RecentlyReadStyle, 'off'>
}

export default function RecentlyRead({ style }: RecentlyReadProps) {
  const _ = useTranslation()

  const { data, isLoading, isError, isFetching, refetch } = useBooks({
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

  if (isLoading && !data) {
    return (
      <section className="group mb-8" aria-busy="true">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">{_('library.recentlyRead')}</h2>
        <div className={style === 'covers' ? 'grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6' : 'grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3'}>
          {Array.from({ length: style === 'covers' ? 6 : 3 }, (_, index) => <div key={index} className={`animate-pulse rounded-xl bg-stone-200/60 motion-reduce:animate-none dark:bg-stone-800/60 ${style === 'covers' ? 'h-36' : 'h-16'}`} />)}
        </div>
      </section>
    )
  }
  if (isError && !data) {
    return <QueryErrorState className="mb-8 py-4" isRetrying={isFetching} onRetry={() => void refetch()} />
  }
  if (books.length === 0) return null

  return (
    <section className="group mb-8">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-400 dark:text-stone-500">
        {_('library.recentlyRead')}
      </h2>
      {style === 'covers' ? <RecentlyReadCovers books={books} /> : <RecentlyReadCards books={books} />}
    </section>
  )
}
