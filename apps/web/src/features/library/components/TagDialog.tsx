import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

import { useUpdateLibraryTag } from '../hooks'

interface TagDialogProps {
  open: boolean
  libraryId?: string
  source?: 'local' | 'server' | null
  tagId?: string
  initialName?: string
  onClose: () => void
}

export default function TagDialog({ open, libraryId, source, tagId, initialName = '', onClose }: TagDialogProps) {
  const _ = useTranslation()
  const updateTag = useUpdateLibraryTag()
  const [name, setName] = useState(initialName)
  useEffect(() => { if (open) setName(initialName) }, [open, initialName])
  if (!open || !tagId) return null
  const submit = () => { const renamedTo = name.trim(); if (!renamedTo || updateTag.isPending) return; updateTag.mutate({ libraryId: libraryId ?? null, name: tagId, source, patch: { renamedTo } }, { onSuccess: onClose }) }
  return <Modal title={_('library.editTag')} onClose={() => { if (!updateTag.isPending) onClose() }} size="sm" footer={<div className="flex w-full gap-3"><Button type="button" variant="secondary" className="flex-1" disabled={updateTag.isPending} onClick={onClose}>{_('library.cancel')}</Button><Button type="button" variant="primary" className="flex-1" disabled={!name.trim() || updateTag.isPending} onClick={submit}>{_('library.save')}</Button></div>}>
    <div className="relative flex items-center">
      <span className="pointer-events-none absolute left-3 flex h-5 w-5 items-center justify-center text-stone-400 dark:text-stone-500"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2H2v10l9.29 9.29a1 1 0 0 0 1.42 0l8.58-8.58a1 1 0 0 0 0-1.42z" /><circle cx="7" cy="7" r="1" /></svg></span>
      <input type="text" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder={_('library.tagName')} autoFocus className="h-10 w-full rounded-xl border border-stone-200/90 bg-stone-50/50 pl-10 pr-3.5 text-sm text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-400/20 dark:border-stone-700/80 dark:bg-stone-900/60 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20" />
    </div>
  </Modal>
}
