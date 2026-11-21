import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'

import TaxonomyIcon from './TaxonomyIcon'

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
  const pending = createShelf.isPending || renameShelf.isPending
  useEffect(() => { if (open) setName(initialName) }, [open, initialName])
  if (!open) return null
  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || pending) return
    if (shelfId) renameShelf.mutate({ id: shelfId, name: trimmed }, { onSuccess: onClose })
    else createShelf.mutate(trimmed, { onSuccess: onClose })
  }
  return <Modal title={shelfId ? _('library.editShelfTitle') : _('library.createShelf')} onClose={() => { if (!pending) onClose() }} size="sm" footer={<div className="flex w-full gap-3"><Button type="button" variant="secondary" className="flex-1" disabled={pending} onClick={onClose}>{_('library.cancel')}</Button><Button type="button" variant="primary" className="flex-1" disabled={!name.trim() || pending} onClick={submit}>{pending ? _(shelfId ? 'passwordInput.saving' : 'passwordInput.creating') : shelfId ? _('library.save') : _('library.create')}</Button></div>}>
    <div className="relative flex items-center">
      <span className="pointer-events-none absolute left-3 flex h-5 w-5 items-center justify-center text-stone-400 dark:text-stone-500"><TaxonomyIcon kind="shelf" size={17} /></span>
      <input type="text" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder={_('library.shelfName')} autoFocus className="h-10 w-full rounded-xl border border-stone-200/90 bg-stone-50/50 pl-10 pr-3.5 text-sm text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-400/20 dark:border-stone-700/80 dark:bg-stone-900/60 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20" />
    </div>
  </Modal>
}
