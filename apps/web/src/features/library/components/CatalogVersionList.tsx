import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'

import type { CatalogBook, Library } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useCollectBook, useDeleteCatalogVersion, useMoveCatalogVersion, useUpdateCatalogVersion } from '../hooks'

/**
 * The versions one work has, and what can be done to each of them.
 *
 * A work is a set of versions; a reader picks one to read and a curator
 * publishes, moves or removes one. Both audiences look at the same list, so it
 * is one component - the row in the list and the detail dialog render it
 * identically rather than keeping a second copy that can fall behind.
 */
interface CatalogVersionListProps {
  work: CatalogBook
  library: Library
  canManage: boolean
  canCollect: boolean
  /** Works on the current page to move a version into; grouping is a choice. */
  moveCandidates: CatalogBook[]
}

export default function CatalogVersionList({ work, library, canManage, canCollect, moveCandidates }: CatalogVersionListProps) {
  const _ = useTranslation()
  const navigate = useNavigate()
  /** versionLinkId -> collected, so a repeat click reports the real outcome. */
  const [collected, setCollected] = useState<Record<string, boolean>>({})
  const [moveTarget, setMoveTarget] = useState('')
  const updateVersion = useUpdateCatalogVersion()
  const deleteVersion = useDeleteCatalogVersion()
  const moveVersion = useMoveCatalogVersion()
  const collect = useCollectBook()

  return (
    <>
      {work.versions.map((version) => (
        <li key={version.id} className="flex flex-wrap items-center gap-2 text-xs text-stone-600 dark:text-stone-300">
          <span className="min-w-0 flex-1 truncate">
            {version.name || version.effective.title}
            <span className="ml-1 text-stone-400">
              {version.format.toUpperCase()} · {version.chapterCount} {_('library.catalogChapters')}
              {version.wordCount ? ` · ${version.wordCount} ${_('library.catalogWords')}` : ''}
            </span>
            {version.status === 'unlisted' && (
              <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                {_('library.catalogUnlisted')}
              </span>
            )}
          </span>
          {/* Unlisted versions stay visible to managers but never openable:
              the backend rejects them and there is no manager preview. */}
          <button
            type="button"
            disabled={version.status === 'unlisted'}
            title={version.status === 'unlisted' ? _('library.catalogUnlistedReadHint') : undefined}
            className="rounded border border-stone-300 px-1.5 py-0.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 dark:border-stone-600"
            onClick={() => navigate({ to: '/books/$id', params: { id: version.bookVersionId } })}
          >
            {_('library.catalogRead')}
          </button>
          {canCollect && version.collected !== true && (
            <button
              type="button"
              disabled={collect.isPending}
              className="rounded border border-stone-300 px-1.5 py-0.5 font-medium disabled:opacity-60 dark:border-stone-600"
              onClick={() => collect.mutate(
                { libraryId: library.id, versionLinkId: version.id },
                {
                  onSuccess: (res) => {
                    setCollected((prev) => ({ ...prev, [version.id]: true }))
                    notify[res.data.alreadyExists ? 'info' : 'success'](
                      res.data.alreadyExists ? _('library.collectAlready') : _('library.collectSuccess'),
                    )
                  },
                  onError: (err) => notify.error(getUserErrorNotification(err, 'library.collectFailed')),
                },
              )}
            >
              {collected[version.id] ? _('library.collected') : _('library.collect')}
            </button>
          )}
          {canManage && (
            <>
              <button
                type="button"
                className="rounded border border-stone-200 px-1.5 py-0.5 dark:border-stone-600"
                onClick={() => updateVersion.mutate({
                  libraryId: library.id,
                  libraryBookId: work.id,
                  versionLinkId: version.id,
                  patch: { status: version.status === 'unlisted' ? 'published' : 'unlisted' },
                })}
              >
                {version.status === 'unlisted' ? _('library.catalogPublish') : _('library.catalogUnlist')}
              </button>
              {moveCandidates.length > 0 && (
                <select
                  aria-label={_('library.catalogMoveTo')}
                  className="max-w-32 rounded border border-stone-200 bg-transparent px-1 py-0.5 dark:border-stone-600"
                  value={moveTarget}
                  onChange={(e) => {
                    setMoveTarget(e.target.value)
                    if (!e.target.value) return
                    moveVersion.mutate({
                      libraryId: library.id,
                      libraryBookId: work.id,
                      versionLinkId: version.id,
                      targetLibraryBookId: e.target.value,
                    })
                    setMoveTarget('')
                  }}
                >
                  <option value="">{_('library.catalogMoveTo')}</option>
                  {moveCandidates.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>{candidate.title}</option>
                  ))}
                </select>
              )}
              <button
                type="button"
                className="rounded border border-red-200 px-1.5 py-0.5 text-red-600 dark:border-red-900/60 dark:text-red-300"
                onClick={() => deleteVersion.mutate({
                  libraryId: library.id, libraryBookId: work.id, versionLinkId: version.id,
                })}
              >
                {_('library.catalogDeleteVersion')}
              </button>
            </>
          )}
        </li>
      ))}
    </>
  )
}
