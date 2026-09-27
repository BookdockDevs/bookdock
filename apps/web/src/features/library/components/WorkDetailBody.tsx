import type { CatalogBook, Library } from '@bookdock/shared'

import BookCover from './BookCover'
import CatalogVersionList from './CatalogVersionList'
import { catalogWorkRow } from '../book-row'

/**
 * What a work in a shared library knows about itself: what it is, and which
 * versions it has. It is a shorter story than a private book's - no reading
 * state, no shelf, no derived metadata - and it is the same story in the same
 * order: artwork, title, author, then the things that belong to it.
 */
export default function WorkDetailBody({
  work, library, canManage, canCollect, moveCandidates,
}: {
  work: CatalogBook
  library: Library
  canManage: boolean
  canCollect: boolean
  moveCandidates: CatalogBook[]
}) {
  const row = catalogWorkRow(work)
  return (
    <div>
      <div className="flex flex-col gap-4 sm:flex-row sm:gap-5">
        <div className="group/cover w-32 shrink-0 self-center overflow-hidden rounded-xl shadow-md shadow-stone-900/10 sm:self-start">
          <BookCover book={{ id: row.id, title: row.title, format: row.format, coverKey: row.coverKey }} coverSrc={row.coverSrc ?? undefined} />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate font-serif text-lg font-semibold text-stone-900 dark:text-stone-100">{work.title}</h3>
          {work.author && <p className="mt-1 truncate text-sm text-stone-500 dark:text-stone-400">{work.author}</p>}
          {work.description && (
            <p className="mt-2 line-clamp-4 text-xs leading-relaxed text-stone-500 dark:text-stone-400">{work.description}</p>
          )}
          {work.tags.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1">
              {work.tags.map((tag) => (
                <li key={tag.id} className="rounded-full bg-stone-100 px-2 py-0.5 text-[11px] text-stone-600 dark:bg-stone-700 dark:text-stone-300">
                  {tag.name}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <ul className="mt-5 flex flex-col gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
        <CatalogVersionList
          work={work}
          library={library}
          canManage={canManage}
          canCollect={canCollect}
          moveCandidates={moveCandidates}
        />
      </ul>
    </div>
  )
}
