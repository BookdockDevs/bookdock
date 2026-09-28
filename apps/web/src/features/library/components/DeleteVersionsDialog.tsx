import { useState } from 'react'

import type { CatalogBook, CatalogVersion } from '@bookdock/shared'

import ConfirmDialog from '@/components/ui/ConfirmDialog'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useDeleteCatalogVersion } from '../hooks'
import { versionTabLabel } from '../book-row'

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
}

function labelOf(version: CatalogVersion, fallback: (n: number) => string, index: number): string {
  return `${versionTabLabel(version.name, fallback(index + 1))} · ${version.format.toUpperCase()}`
}

export default function DeleteVersionsDialog({ work, libraryId, preselectedIds, onClose, onDeleted }: DeleteVersionsDialogProps) {
  const _ = useTranslation()
  const deleteVersion = useDeleteCatalogVersion()
  const [checked, setChecked] = useState<string[]>(() =>
    work.versions.filter((v) => preselectedIds.includes(v.id)).map((v) => v.id),
  )

  const versions = work.versions
  const multi = versions.length > 1
  const checkedVersions = versions.filter((v) => checked.includes(v.id))
  const removesWork = multi && checkedVersions.length === versions.length
  const fallback = (n: number) => _('library.versionFallback', { n }) as string

  function toggle(id: string) {
    setChecked((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]))
  }

  async function runDelete() {
    try {
      for (const version of checkedVersions) {
        await deleteVersion.mutateAsync({ libraryId, libraryBookId: work.id, versionLinkId: version.id })
      }
      onDeleted(checkedVersions.length === versions.length)
    } catch (err) {
      notify.error(getUserErrorNotification(err, 'library.catalogDeleteVersionFailed'))
      onClose()
    }
  }

  const consequence = !multi || removesWork
    ? _('library.catalogDeleteLastVersionConfirm', { work: work.title })
    : _('library.catalogDeleteVersionConfirm', {
      name: checkedVersions.map((v) => labelOf(v, fallback, versions.indexOf(v))).join('、'),
    })

  return (
    <ConfirmDialog
      title={_('library.catalogDeleteVersion')}
      message={(
        <div className="flex flex-col gap-3">
          {multi && (
            <div className="flex flex-col gap-1.5">
              {versions.map((version, index) => (
                <label key={version.id} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={checked.includes(version.id)}
                    onChange={() => toggle(version.id)}
                    className="h-4 w-4 accent-stone-900 dark:accent-stone-100"
                  />
                  <span className="min-w-0 flex-1 truncate">
                    {labelOf(version, fallback, index)}
                    {version.status === 'unlisted' && (
                      <span className="ml-1.5 text-xs text-amber-600 dark:text-amber-400">
                        {_('library.catalogUnlisted')}
                      </span>
                    )}
                  </span>
                </label>
              ))}
              <p className="text-xs text-stone-400">
                {_('library.catalogDeleteVersionsSelected', { count: checkedVersions.length })}
              </p>
            </div>
          )}
          <p>{consequence}</p>
        </div>
      )}
      confirmLabel={_('library.delete')}
      confirmDisabled={multi && checkedVersions.length === 0}
      onClose={onClose}
      onConfirm={() => void runDelete()}
    />
  )
}
