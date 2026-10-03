import { useRef, useState } from 'react'

import type { CatalogBook, CatalogVersion } from '@bookdock/shared'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { useDeleteCatalogVersion, useLibraries } from '../hooks'
import { versionOrdinal, versionTabLabel } from '../book-row'

/**
 * The single delete entry for catalog versions, wherever it opens from. One
 * version reads exactly like the old confirm; several versions become a
 * checklist. The caller presets the check state (a card menu presets all, a
 * detail panel presets the visible one) but the reader always decides.
 *
 * Deletes run sequentially: the backend removes the whole work when its last
 * version goes, and that rule only holds when each delete sees the previous
 * one's result.
 */
interface DeleteVersionsDialogProps {
  work: CatalogBook
  libraryId: string
  preselectedIds: string[]
  onClose: () => void
  /** True when the batch removed every version, so the work itself is gone. */
  onDeleted: (workDeleted: boolean) => void
  /**
   * Version ids this caller may delete. Omitted for a manager, who may delete
   * any; a member contributor only their own uploads, so the dialog lists only
   * those versions rather than showing everyone else's.
   */
  deletableIds?: ReadonlySet<string>
}

function labelOf(versions: CatalogVersion[], version: CatalogVersion, fallback: (n: number) => string): string {
  return `${versionTabLabel(version.name, fallback(versionOrdinal(versions, version.id)))} · ${version.format.toUpperCase()}`
}

export default function DeleteVersionsDialog({ work, libraryId, preselectedIds, onClose, onDeleted, deletableIds }: DeleteVersionsDialogProps) {
  const _ = useTranslation()
  const deleteVersion = useDeleteCatalogVersion()
  const [deleting, setDeleting] = useState(false)
  const deleteLock = useRef(false)
  const deletable = (id: string) => !deletableIds || deletableIds.has(id)
  const versions = work.versions
  const removableVersions = versions.filter((v) => deletable(v.id))
  const [checked, setChecked] = useState<string[]>(() => {
    const selected = removableVersions.filter((v) => preselectedIds.includes(v.id)).map((v) => v.id)
    return selected.length > 0 ? selected : removableVersions.slice(0, 1).map((v) => v.id)
  })

  // A single deletable version is one direct confirmation, not a checklist.
  const multi = removableVersions.length > 1
  const checkedVersions = removableVersions.filter((v) => checked.includes(v.id))
  const removesWork = checkedVersions.length === versions.length
  const fallback = (n: number) => _('library.versionFallback', { n }) as string
  // Per-library switch (owner sees the value, others get null); default on.
  const { data: librariesData } = useLibraries()
  const trashEnabled = (librariesData?.data ?? []).find((library) => library.id === libraryId)?.trashEnabled ?? true

  function toggle(id: string) {
    setChecked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  async function runDelete() {
    if (deleteLock.current || checkedVersions.length === 0) return
    deleteLock.current = true
    setDeleting(true)
    const deletedIds = new Set<string>()
    try {
      for (const version of checkedVersions) {
        await deleteVersion.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: version.id })
        deletedIds.add(version.id)
      }
      notify.success(removesWork
        ? { key: trashEnabled ? 'library.catalogWorkTrashed' : 'library.catalogWorkDeleted', params: { title: work.title } }
        : { key: 'library.catalogVersionsDeleted', params: { count: deletedIds.size } })
      onDeleted(checkedVersions.length === versions.length)
    } catch (err) {
      setChecked((current) => current.filter((id) => !deletedIds.has(id)))
      if (deletedIds.size) {
        notify.warning({ key: 'library.catalogVersionsDeletePartial', params: { succeeded: deletedIds.size, failed: checkedVersions.length - deletedIds.size } })
      } else notify.error(getUserErrorNotification(err, 'library.catalogDeleteVersionFailed'))
    } finally {
      deleteLock.current = false
      setDeleting(false)
    }
  }

  // Trash is work-scoped: removing some (not all) versions deletes those
  // links immediately and never enters the trash, so its copy is always the
  // permanent one. Only removing the whole work follows the trash switch.
  const consequence = removesWork
    ? (trashEnabled
      ? _('library.catalogDeleteLastVersionTrashConfirm', { work: work.title })
      : _('library.catalogDeleteLastVersionConfirm', { work: work.title }))
    : _('library.catalogDeleteVersionConfirm', {
      name: checkedVersions.map((v) => labelOf(versions, v, fallback)).join('、'),
    })

  return (
    <ConfirmDialog
      title={_('library.catalogDeleteVersion')}
      message={(
        <div className="flex flex-col gap-3">
          {multi && (
            <div className="flex flex-col gap-2">
              <div className="flex max-h-56 flex-col gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-0.5">
                {removableVersions.map((version) => {
                  const isChecked = checked.includes(version.id)
                  return (
                    <label
                      key={version.id}
                      className={cn(
                        'flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-2.5 text-sm transition-all select-none',
                        isChecked
                          ? 'border-stone-900/40 bg-stone-50/80 dark:border-stone-700 dark:bg-stone-800/60'
                          : 'border-stone-200/70 bg-white hover:border-stone-300 hover:bg-stone-50/40 dark:border-stone-800 dark:bg-stone-900/60 dark:hover:border-stone-700',
                      )}
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          disabled={deleting}
                          onChange={() => toggle(version.id)}
                          aria-label={versionTabLabel(version.name, fallback(versionOrdinal(versions, version.id)))}
                          className="h-4 w-4 shrink-0 rounded accent-stone-900 dark:accent-stone-100"
                        />
                        <span className="truncate font-medium text-stone-800 dark:text-stone-200">
                          {versionTabLabel(version.name, fallback(versionOrdinal(versions, version.id)))}
                        </span>
                        <span className="inline-flex shrink-0 items-center rounded-md bg-stone-100 px-1.5 py-0.5 text-[11px] font-medium text-stone-500 uppercase dark:bg-stone-800 dark:text-stone-400">
                          {version.format}
                        </span>
                        {version.status === 'unlisted' && (
                          <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">
                            {_('library.catalogUnlisted')}
                          </span>
                        )}
                      </div>
                    </label>
                  )
                })}
              </div>
              <p className="text-xs text-stone-400">
                {_('library.catalogDeleteVersionsSelected', { count: checkedVersions.length })}
              </p>
            </div>
          )}
          <p>{consequence}</p>
        </div>
      )}
      confirmLabel={_('library.delete')}
      confirmDisabled={deleting || checkedVersions.length === 0}
      onClose={() => { if (!deleting) onClose() }}
      onConfirm={() => void runDelete()}
    />
  )
}
