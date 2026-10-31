import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

import { useCreateLibraryTag, useCreateTag, useRenameTag, useUpdateLibraryTag } from '../hooks'

interface TagDialogProps {
  open: boolean
  /** Set when the library in context is shared: the same dialog curates its tags. */
  libraryId?: string
  tagId?: string
  initialName?: string
  onClose: () => void
}

export default function TagDialog({ open, libraryId, tagId, initialName = '', onClose }: TagDialogProps) {
  const _ = useTranslation()
  const createTag = useCreateTag()
  const renameTag = useRenameTag()
  const createLibraryTag = useCreateLibraryTag()
  const renameLibraryTag = useUpdateLibraryTag()
  const [name, setName] = useState(initialName)

  const isRename = Boolean(tagId)
  const isPending = createTag.isPending || renameTag.isPending
    || createLibraryTag.isPending || renameLibraryTag.isPending

  useEffect(() => {
    if (open) setName(initialName)
  }, [open, initialName])

  if (!open) return null

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || isPending) return
    if (libraryId) {
      if (isRename && tagId) renameLibraryTag.mutate({ libraryId, tagId, patch: { name: trimmed } }, { onSuccess: onClose })
      else createLibraryTag.mutate({ libraryId, name: trimmed }, { onSuccess: onClose })
      return
    }
    if (isRename && tagId) {
      renameTag.mutate({ id: tagId, name: trimmed }, { onSuccess: onClose })
    } else {
      createTag.mutate(trimmed, { onSuccess: onClose })
    }
  }

  return (
    <Modal
      title={isRename ? _('library.editTag') : _('library.newTag')}
      onClose={() => { if (!isPending) onClose() }}
      size="sm"
      footer={
        <div className="flex w-full gap-3">
          <Button
            type="button"
            onClick={onClose}
            disabled={isPending}
            variant="secondary"
            className="flex-1"
          >
            {_('library.cancel')}
          </Button>
          <Button
            type="button"
            onClick={submit}
            disabled={!name.trim() || isPending}
            variant="primary"
            className="flex-1"
          >
            {isRename ? _('library.save') : _('library.create')}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 pt-1">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-3 flex h-5 w-5 items-center justify-center text-stone-400 dark:text-stone-500">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" />
              <circle cx="7" cy="7" r="1" />
            </svg>
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder={_('library.tagName')}
            autoFocus
            className="h-10 w-full rounded-xl border border-stone-200/90 bg-stone-50/50 pl-10 pr-3.5 text-sm text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-400/20 dark:border-stone-700/80 dark:bg-stone-900/60 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20"
          />
        </div>
      </div>
    </Modal>
  )
}
