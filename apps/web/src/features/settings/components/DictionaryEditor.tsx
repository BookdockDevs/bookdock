import { useState } from 'react'

import type { DictionaryItem, DictionaryScope } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { cn, formatBytes } from '@/lib/utils'

interface DictionaryEditorProps {
  item: DictionaryItem
  isOwner: boolean
  saving: boolean
  onClose: () => void
  onSave: (payload: { name: string; scope: DictionaryScope }) => void
}

function FileTextIcon() {
  return (
    <svg className="h-4 w-4 shrink-0 text-stone-400 dark:text-stone-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 3h8l4 4v14H6z" />
      <path d="M14 3v5h5M9 13h6M9 17h6" />
    </svg>
  )
}

export default function DictionaryEditor({ item, isOwner, saving, onClose, onSave }: DictionaryEditorProps) {
  const _ = useTranslation()
  const [name, setName] = useState(item.name)
  const [scope, setScope] = useState<DictionaryScope>(item.scope ?? 'user')

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return
    onSave({ name: trimmed, scope })
  }

  return (
    <Modal title={_('dictionary.edit')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <label className="block">
          <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('dictionary.name')}</span>
          <input
            type="text"
            autoFocus
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={100}
            className="h-9 w-full rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
          />
        </label>

        <fieldset className="space-y-1.5">
          <legend className="text-xs text-stone-400 dark:text-stone-500">{_('settings.fontsScope')}</legend>
          <div className="flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" role="group" aria-label={_('settings.fontsScope')}>
            {(['user', 'instance'] as DictionaryScope[]).map((value) => {
              const selected = scope === value
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScope(value)}
                  disabled={!isOwner || saving}
                  aria-pressed={selected}
                  className={cn(
                    'flex h-9 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    selected
                      ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100',
                  )}
                >
                  {_(value === 'user' ? 'settings.fontsScopeUser' : 'settings.fontsScopeInstance')}
                </button>
              )
            })}
          </div>
          {!isOwner && <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{_('settings.fontsScopeOwnerHint')}</p>}
        </fieldset>

        <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2.5 text-xs text-stone-500 dark:border-stone-800 dark:bg-stone-800/60 dark:text-stone-400">
          {item.fileNames.map((fileName, idx) => (
            <div key={fileName} className="flex min-w-0 items-center justify-between gap-2.5">
              <div className="flex min-w-0 items-center gap-2">
                <FileTextIcon />
                <span className="min-w-0 truncate font-mono text-[11px]" title={fileName}>{fileName}</span>
              </div>
              {idx === 0 && (
                <span className="shrink-0 tabular-nums text-stone-400 dark:text-stone-500">{formatBytes(item.size)}</span>
              )}
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={saving}>
            {_('library.cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={saving || !name.trim()}>
            {_('library.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
