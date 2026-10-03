import { useMemo, useState } from 'react'

import type { LibraryListItem } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import LibraryDetailsDialog from './LibraryDetailsDialog'
import { useJoinLibrary, useLibraries } from '../hooks'
import LibraryCounts from './LibraryCounts'

interface LibraryDiscoveryDialogProps {
  open: boolean
  onClose: () => void
  onSelectLibrary: (libraryId: string) => void
  onJoinWithPassword: (library: LibraryListItem) => void
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.35-4.35" />
    </svg>
  )
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
}

function LibraryIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m16 6 4 14" />
      <path d="M12 6v14" />
      <path d="M8 8v12" />
      <path d="M4 4v16" />
    </svg>
  )
}

export default function LibraryDiscoveryDialog({
  open,
  onClose,
  onSelectLibrary,
  onJoinWithPassword,
}: LibraryDiscoveryDialogProps) {
  const _ = useTranslation()
  const { data: librariesData, isLoading, isError, isFetching, refetch } = useLibraries()
  const join = useJoinLibrary()
  const [search, setSearch] = useState('')
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const [detailsTarget, setDetailsTarget] = useState<LibraryListItem | null>(null)

  const discoverableLibraries = useMemo(() => {
    const list = librariesData?.data ?? []
    // Invite-only shared libraries are reachable through their link only; the
    // server lists them for the owner and members, exploration is not the place.
    return list.filter((l) => l.type === 'shared' && l.visibility !== 'private')
  }, [librariesData?.data])

  const filteredLibraries = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return discoverableLibraries
    return discoverableLibraries.filter(
      (l) => l.name.toLowerCase().includes(q) || (l.description && l.description.toLowerCase().includes(q)),
    )
  }, [discoverableLibraries, search])

  function handleDirectJoin(libraryId: string) {
    setJoiningId(libraryId)
    join.mutate(
      { libraryId },
      {
        onSuccess: () => {
          setJoiningId(null)
          notify.success(_('library.joinLibrarySuccess'))
        },
        onError: (err) => {
          setJoiningId(null)
          notify.error(getUserErrorNotification(err, 'library.joinFailed'))
        },
      },
    )
  }

  if (!open) return null

  return (
    <>
      <Modal
        title={_('library.exploreLibraries')}
        onClose={onClose}
      >
        <div className="flex flex-col gap-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={_('library.searchLibrariesPlaceholder')}
              className="w-full rounded-xl border border-stone-200 bg-stone-50/60 py-2 pl-9 pr-3 text-xs text-stone-800 outline-none transition-all placeholder:text-stone-400 focus:border-stone-900 focus:bg-white focus:ring-1 focus:ring-stone-900 dark:border-stone-700 dark:bg-stone-900/60 dark:text-stone-100 dark:focus:border-stone-200 dark:focus:bg-stone-900 dark:focus:ring-stone-200"
            />
          </div>

          {isLoading ? (
            <div className="space-y-3 py-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex animate-pulse items-center justify-between rounded-xl border border-stone-100 p-4 dark:border-stone-800">
                  <div className="space-y-2">
                    <div className="h-4 w-32 rounded bg-stone-200/80 dark:bg-stone-800" />
                    <div className="h-3 w-48 rounded bg-stone-100 dark:bg-stone-800/60" />
                  </div>
                  <div className="h-8 w-20 rounded-lg bg-stone-200/80 dark:bg-stone-800" />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="py-4">
              <QueryErrorState isRetrying={isFetching} onRetry={refetch} />
            </div>
          ) : filteredLibraries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
                <LibraryIcon className="h-6 w-6" />
              </div>
              <p className="mt-3 text-xs text-stone-500 dark:text-stone-400">
                {_('library.noDiscoverableLibraries')}
              </p>
            </div>
          ) : (
            <div className="max-h-[60vh] space-y-2.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-0.5">
              {filteredLibraries.map((lib) => {
                const isJoined = lib.relation === 'owner' || lib.relation === 'admin' || lib.relation === 'member'
                const isPasswordProtected = lib.visibility === 'password'

                return (
                  <div
                    key={lib.id}
                    tabIndex={0}
                    role="button"
                    onClick={() => setDetailsTarget(lib)}
                    onKeyDown={(e) => {
                      if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                        e.preventDefault()
                        setDetailsTarget(lib)
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setDetailsTarget(lib)
                    }}
                    className="group flex flex-col gap-3 rounded-xl border border-stone-200/80 bg-white p-3.5 text-left transition-colors hover:border-stone-300 hover:bg-stone-50/50 cursor-pointer sm:flex-row sm:items-center sm:justify-between dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700 dark:hover:bg-stone-800/60"
                  >
                    <div className="min-w-0 flex-1 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-stone-900 dark:text-stone-100 truncate">
                          {lib.name}
                        </span>
                        {isPasswordProtected ? (
                          <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                            <LockIcon className="h-3 w-3" />
                            {_('library.visibilityPassword')}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400">
                            <GlobeIcon className="h-3 w-3" />
                            {_('library.visibilityPublic')}
                          </span>
                        )}
                      </div>

                      {lib.description ? (
                        <p className="line-clamp-2 text-xs text-stone-500 dark:text-stone-400">
                          {lib.description}
                        </p>
                      ) : null}

                      <LibraryCounts
                        workCount={lib.workCount}
                        memberCount={lib.memberCount}
                        className="pt-0.5"
                      />
                    </div>

                    <div
                      className="flex shrink-0 items-center gap-2 self-end sm:self-center"
                      onClick={(e) => e.stopPropagation()}
                      onKeyDown={(e) => e.stopPropagation()}
                    >
                      {isJoined ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            onSelectLibrary(lib.id)
                            onClose()
                          }}
                        >
                          {_('library.enterLibrary')}
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={joiningId === lib.id}
                          onClick={() => {
                            if (isPasswordProtected) {
                              onJoinWithPassword(lib)
                            } else {
                              handleDirectJoin(lib.id)
                            }
                          }}
                        >
                          {joiningId === lib.id ? _('library.joining') : _('library.join')}
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal>

      {detailsTarget && (
        <LibraryDetailsDialog
          library={detailsTarget}
          onClose={() => setDetailsTarget(null)}
        />
      )}
    </>
  )
}
