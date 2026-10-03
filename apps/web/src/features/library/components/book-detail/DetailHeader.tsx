import type { ReactNode } from 'react'

import { useTranslation } from '@/hooks/useTranslation'


/**
 * The presentation shell both detail bodies sit in: artwork with its hover
 * actions, title, byline, and whatever the context adds below them. A private
 * card fills the reading-progress and action slots; a catalog work fills the
 * action slot and puts its version tabs in the footer. Everything a work cannot
 * have stays absent rather than stubbed.
 */
interface DetailHeaderProps {
  cover: ReactNode
  hasCoverImage: boolean
  copyingCover: boolean
  onCopyCover: () => void
  onDownloadCover: () => void
  coverEditing?: boolean
  title: string
  authors: string[]
  author?: string | null
  onAuthorClick: (name: string) => void
  onEditTitle?: () => void
  onEditAuthors?: () => void
  chips?: ReactNode
  reading?: ReactNode
  actions?: ReactNode
  footer?: ReactNode
}

export default function DetailHeader({
  cover,
  hasCoverImage,
  copyingCover,
  onCopyCover,
  onDownloadCover,
  coverEditing = false,
  title,
  authors,
  author,
  onAuthorClick,
  onEditTitle,
  onEditAuthors,
  chips,
  reading,
  actions,
  footer,
}: DetailHeaderProps) {
  const _ = useTranslation()
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
      <div className="group/cover relative w-32 shrink-0 self-center overflow-hidden rounded-xl shadow-md shadow-stone-900/10 sm:self-start">
        {cover}
        {hasCoverImage && !coverEditing && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-center gap-2 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent opacity-0 transition-opacity duration-200 group-hover/cover:pointer-events-auto group-hover/cover:opacity-100 group-focus-within/cover:pointer-events-auto group-focus-within/cover:opacity-100">
            <button
              type="button"
              onClick={onCopyCover}
              disabled={copyingCover}
              title={_('library.copyCover')}
              aria-label={_('library.copyCover')}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-white backdrop-blur-xs transition hover:scale-110 hover:bg-white/30 active:scale-95 disabled:opacity-50"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
                <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onDownloadCover}
              title={_('library.downloadCover')}
              aria-label={_('library.downloadCover')}
              className="flex h-7 w-7 items-center justify-center rounded-md bg-white/20 text-white backdrop-blur-xs transition hover:scale-110 hover:bg-white/30 active:scale-95"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="7 10 12 15 17 10" />
                <line x1="12" x2="12" y1="15" y2="3" />
              </svg>
            </button>
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-1" onContextMenu={onEditTitle ? (event) => { event.preventDefault(); event.stopPropagation(); onEditTitle() } : undefined}>
          <h3 className="min-w-0 font-serif text-xl font-semibold leading-snug text-stone-900 dark:text-stone-100">{title}</h3>
        </div>
        <div className="flex items-center gap-1" onContextMenu={onEditAuthors ? (event) => { event.preventDefault(); event.stopPropagation(); onEditAuthors() } : undefined}>
        {authors.length > 0 ? (
          <div className="mt-1 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-sm">
            {authors.map((name, index) => (
              <span key={`${name}-${index}`} className="flex items-center gap-x-1">
                {index > 0 && <span aria-hidden="true" className="text-stone-300 dark:text-stone-600">·</span>}
                <button
                  type="button"
                  onClick={() => onAuthorClick(name)}
                  className="text-left text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
                >
                  {name}
                </button>
              </span>
            ))}
          </div>
        ) : author ? (
          <button
            type="button"
            onClick={() => onAuthorClick(author)}
            className="mt-1 text-left text-sm text-stone-500 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-400 dark:decoration-stone-600 dark:hover:text-stone-100"
          >
            {author}
          </button>
        ) : (
          <p className="mt-1 text-sm text-stone-400 dark:text-stone-500">
            {_('library.unknown')}
          </p>
        )}
        </div>
        {chips}
        {reading}
        {actions}
        {footer}
      </div>
    </div>
  )
}
