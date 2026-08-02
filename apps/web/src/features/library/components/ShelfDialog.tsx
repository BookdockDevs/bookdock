import { useEffect, useState } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { useCreateShelf, useRenameShelf } from '../hooks'

interface ShelfDialogProps {
  open: boolean
  shelfId?: string
  initialName?: string
  onClose: () => void
}

export default function ShelfDialog({ open, shelfId, initialName = '', onClose }: ShelfDialogProps) {
  const _ = useTranslation()
  const createShelf = useCreateShelf()
  const renameShelf = useRenameShelf()
  const [name, setName] = useState(initialName)

  const isRename = Boolean(shelfId)
  const isPending = createShelf.isPending || renameShelf.isPending

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || isPending) return
    if (isRename && shelfId) {
      renameShelf.mutate({ id: shelfId, name: trimmed }, { onSuccess: onClose })
    } else {
      createShelf.mutate(trimmed, { onSuccess: onClose })
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-stone-200 bg-white p-6 shadow-xl dark:border-stone-800 dark:bg-stone-950"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="mb-5 text-center font-serif text-base font-medium text-stone-900 dark:text-stone-100">
          {isRename ? _('library.renameShelf') : _('library.createShelf')}
        </h2>

        <div className="mb-8 flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-stone-100 text-stone-400 dark:bg-stone-800 dark:text-stone-500">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
              <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20v-5" />
            </svg>
          </div>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder={_('library.shelfName')}
            autoFocus
            className="h-11 min-w-0 flex-1 rounded-lg border border-stone-200 bg-white px-3 text-sm text-stone-700 outline-none placeholder:text-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
          />
        </div>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || isPending}
            className="h-11 flex-1 rounded-xl bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-300"
          >
            {isRename ? _('library.save') : _('library.create')}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-xl bg-stone-100 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
          >
            {_('library.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
