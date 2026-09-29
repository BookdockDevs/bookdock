import { useEffect, useState } from 'react'

import type { LibraryListItem } from '@bookdock/shared'

import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import { useUpdateLibrary } from '../hooks'

interface PrivateLibraryRenameDialogProps {
  library: LibraryListItem
  onClose: () => void
}

export default function PrivateLibraryRenameDialog({ library, onClose }: PrivateLibraryRenameDialogProps) {
  const _ = useTranslation()
  const [name, setName] = useState(library.name || _('library.myLibrary'))
  const updateLibrary = useUpdateLibrary()

  useEffect(() => {
    setName(library.name || _('library.myLibrary'))
  }, [library.name, _])

  function submit() {
    const trimmed = name.trim()
    if (!trimmed || trimmed === library.name || updateLibrary.isPending) return
    updateLibrary.mutate({ libraryId: library.id, patch: { name: trimmed } }, {
      onSuccess: onClose,
      onError: (error) => notify.error(getUserErrorNotification(error, 'library.renameLibraryFailed')),
    })
  }

  return (
    <Modal title={_('library.renameLibrary')} onClose={onClose} size="sm">
      <div className="mb-6 mt-1 flex items-center gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M2 3h6a4 4 0 0 1 4 4v14a4 4 0 0 0-3-3H2z" />
            <path d="M22 3h-6a4 4 0 0 0-4 4v14a4 4 0 0 1 3-3h7z" />
          </svg>
        </div>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
          onKeyDown={(event) => { if (event.key === 'Enter') submit() }}
          placeholder={_('library.libraryName')}
          maxLength={64}
          autoFocus
          className="h-11 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
        />
      </div>
      <div className="flex gap-3">
        <button type="button" onClick={onClose} className="h-11 flex-1 rounded-xl bg-stone-100 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700">
          {_('library.cancel')}
        </button>
        <button type="button" onClick={submit} disabled={!name.trim() || name.trim() === library.name || updateLibrary.isPending} className="h-11 flex-1 rounded-xl bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-300">
          {_('library.save')}
        </button>
      </div>
    </Modal>
  )
}
