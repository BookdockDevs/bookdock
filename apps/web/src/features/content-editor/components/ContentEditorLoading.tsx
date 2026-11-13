import { useTranslation } from '@/hooks/useTranslation'

interface ContentEditorLoadingProps {
  bookId: string
  title: string
  format?: 'txt' | 'epub'
  chapters?: readonly { id: string; title: string; level: number }[]
}

/**
 * Paints the workbench layout before the book text arrives: the chapter list is
 * usually warm from the reader and can render immediately, so only the body has
 * to wait. A bare spinner made a cached opening feel like a full reload.
 */
export default function ContentEditorLoading({ bookId, title, format = 'txt', chapters }: ContentEditorLoadingProps) {
  const _ = useTranslation()
  const minLevel = chapters?.length ? Math.min(...chapters.map((chapter) => chapter.level)) : 0

  return (
    <main role="status" aria-busy="true" className="flex h-screen flex-col overflow-hidden bg-stone-100/60 text-stone-900 antialiased dark:bg-stone-950 dark:text-stone-100">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-stone-200 bg-white/90 px-3 backdrop-blur-md dark:border-stone-800 dark:bg-stone-900/90 sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
          <a
            href={`/books/${encodeURIComponent(bookId)}`}
            aria-label={_('editor.backReading') || '返回阅读'}
            title={_('editor.backTooltip') || '返回上一页'}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-stone-500 transition-colors hover:bg-stone-200/60 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M19 12H5" />
              <path d="m12 19-7-7 7-7" />
            </svg>
          </a>
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-sm font-semibold text-stone-800 dark:text-stone-100 sm:text-base">{title}</h1>
            <span className="shrink-0 rounded-md bg-stone-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-stone-500 dark:bg-stone-800 dark:text-stone-400">
              {format}
            </span>
          </div>
        </div>
        <span className="flex shrink-0 items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
          <svg aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M21 12a9 9 0 11-6.219-8.56" />
          </svg>
          {_('editor.loadingContent')}
        </span>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(0,2fr)_minmax(0,3fr)] md:grid-cols-[280px_minmax(0,1fr)] md:grid-rows-[minmax(0,1fr)] lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col overflow-hidden border-b border-stone-200 bg-white dark:border-stone-800 dark:bg-stone-900 md:border-b-0 md:border-r">
          <div className="flex h-11 shrink-0 items-center border-b border-stone-200 px-3 text-xs font-medium text-stone-500 dark:border-stone-800 dark:text-stone-400">
            {_('editor.tocTitle')}
          </div>
          <ol aria-label={_('editor.tocTitle')} className="min-h-0 flex-1 space-y-0.5 overflow-y-auto pl-2 pr-3 pt-1 pb-2 custom-scrollbar">
            {chapters?.length
              ? chapters.map((chapter) => (
                <li key={chapter.id} className="list-none">
                  <div
                    className="flex w-full items-center gap-1.5 rounded-lg py-1.5 pr-2 text-sm text-stone-400 dark:text-stone-500"
                    style={{ paddingLeft: `${(Math.max(1, chapter.level - minLevel + 1) - 1) * 14 + 8}px` }}
                  >
                    <span className="w-3.5 shrink-0" />
                    <span className="flex-1 truncate">{chapter.title || '（未命名章节）'}</span>
                  </div>
                </li>
              ))
              : Array.from({ length: 12 }, (_, index) => (
                <li key={index} className="list-none py-1.5 pr-2 pl-2">
                  <div className="h-4 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" style={{ width: `${52 + ((index * 17) % 40)}%` }} />
                </li>
              ))}
          </ol>
        </aside>

        <section className="min-h-0 overflow-hidden bg-white p-4 dark:bg-stone-900 sm:p-6">
          <div className="mx-auto max-w-2xl space-y-3">
            <div className="h-7 w-1/3 animate-pulse rounded bg-stone-200/70 dark:bg-stone-800" />
            {Array.from({ length: 10 }, (_, index) => (
              <div key={index} className="h-4 animate-pulse rounded bg-stone-200/60 dark:bg-stone-800/80" style={{ width: `${72 + ((index * 13) % 28)}%` }} />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}
