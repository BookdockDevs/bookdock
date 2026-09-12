import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { useCreateShelf, useCreateTag, useShelves, useTags } from '../../hooks'
import { toggleSetItem } from './types'
import { Chip, GroupLabel } from './ui'

interface BookClassificationEditorProps {
  shelfId: string | null
  tagIds: Set<string>
  onShelfChange: (shelfId: string | null) => void
  onTagChange: Dispatch<SetStateAction<Set<string>>>
}

export default function BookClassificationEditor({
  shelfId,
  tagIds,
  onShelfChange,
  onTagChange,
}: BookClassificationEditorProps) {
  const _ = useTranslation()
  const { data: shelvesData } = useShelves()
  const { data: tagsData } = useTags()
  const createShelf = useCreateShelf()
  const createTag = useCreateTag()

  const [newShelf, setNewShelf] = useState('')
  const [newShelfOpen, setNewShelfOpen] = useState(false)
  const [newTag, setNewTag] = useState('')
  const [newTagOpen, setNewTagOpen] = useState(false)
  const newShelfEditorRef = useRef<HTMLSpanElement>(null)
  const newTagEditorRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!newShelfOpen && !newTagOpen) return
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target
      if (!(target instanceof Node)) return
      if (newShelfEditorRef.current?.contains(target) || newTagEditorRef.current?.contains(target)) return
      setNewShelf('')
      setNewShelfOpen(false)
      setNewTag('')
      setNewTagOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [newShelfOpen, newTagOpen])

  async function handleCreateShelf() {
    const name = newShelf.trim()
    if (!name) return
    try {
      const res = await createShelf.mutateAsync(name)
      onShelfChange(res.data.id)
      setNewShelf('')
      setNewShelfOpen(false)
    } catch {
      // toast handled by the hook
    }
  }

  async function handleCreateTag() {
    const name = newTag.trim()
    if (!name) return
    try {
      const res = await createTag.mutateAsync(name)
      onTagChange((current) => new Set(current).add(res.data.id))
      setNewTag('')
      setNewTagOpen(false)
    } catch {
      // toast handled by the hook
    }
  }

  return (
    <section className="mt-6">
      <GroupLabel>{_('library.membershipSection')}</GroupLabel>
      <p className="mb-2 text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.shelves')}</p>
      <div className="flex max-h-28 flex-wrap gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
        <Chip
          label={_('library.uncategorized')}
          selected={shelfId === null}
          onClick={() => onShelfChange(null)}
        />
        {(shelvesData?.data ?? []).map((shelf) => (
          <Chip
            key={shelf.id}
            label={shelf.name}
            selected={shelfId === shelf.id}
            onClick={() => onShelfChange(shelf.id)}
          />
        ))}
        {newShelfOpen ? (
          <span ref={newShelfEditorRef} className="flex items-center gap-1">
            <input
              type="text"
              value={newShelf}
              autoFocus
              onChange={(e) => setNewShelf(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleCreateShelf()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNewShelf('')
                  setNewShelfOpen(false)
                }
              }}
              placeholder={_('library.newShelfPlaceholder')}
              className="h-8 w-28 rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
            />
            <button
              type="button"
              onClick={() => void handleCreateShelf()}
              disabled={!newShelf.trim() || createShelf.isPending}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800 disabled:opacity-40 dark:border-stone-700 dark:hover:text-stone-200"
              aria-label={_('library.newShelf')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 13 4 4 10-10" />
              </svg>
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNewShelfOpen(true)}
            className="rounded-full border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-600 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:text-stone-300"
          >
            + {_('library.newShelf')}
          </button>
        )}
      </div>

      <p className="mb-2 mt-4 text-xs font-medium text-stone-500 dark:text-stone-400">{_('library.tags')}</p>
      <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
        {(tagsData?.data ?? []).map((tag) => (
          <Chip
            key={tag.id}
            label={tag.name}
            selected={tagIds.has(tag.id)}
            onClick={() => onTagChange((current) => toggleSetItem(current, tag.id))}
          />
        ))}
        {newTagOpen ? (
          <span ref={newTagEditorRef} className="flex items-center gap-1">
            <input
              type="text"
              value={newTag}
              autoFocus
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void handleCreateTag()
                } else if (e.key === 'Escape') {
                  e.stopPropagation()
                  setNewTag('')
                  setNewTagOpen(false)
                }
              }}
              placeholder={_('library.newTagPlaceholder')}
              className="h-8 w-28 rounded-full border border-stone-200 bg-white px-3 text-xs text-stone-700 outline-none placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
            />
            <button
              type="button"
              onClick={() => void handleCreateTag()}
              disabled={!newTag.trim() || createTag.isPending}
              className="flex h-8 w-8 items-center justify-center rounded-full border border-stone-200 text-stone-500 transition-colors hover:border-stone-300 hover:text-stone-800 disabled:opacity-40 dark:border-stone-700 dark:hover:text-stone-200"
              aria-label={_('library.newTag')}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 13 4 4 10-10" />
              </svg>
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setNewTagOpen(true)}
            className="rounded-full border border-dashed border-stone-300 px-3 py-1.5 text-xs text-stone-400 transition-colors hover:border-stone-400 hover:text-stone-600 dark:border-stone-600 dark:hover:border-stone-500 dark:hover:text-stone-300"
          >
            + {_('library.newTag')}
          </button>
        )}
      </div>
    </section>
  )
}
