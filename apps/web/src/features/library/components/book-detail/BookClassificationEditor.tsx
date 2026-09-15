import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

import { useTranslation } from '@/hooks/useTranslation'

import { useCreateShelf, useCreateTag, useShelves, useTags } from '../../hooks'
import { toggleSetItem } from './types'
import { Chip } from './ui'

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
    <section className="mt-5 border-t border-stone-100 pt-4 dark:border-stone-800">
      <p className="mb-2 text-xs font-semibold text-stone-500 dark:text-stone-400">{_('library.shelves')}</p>
      <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
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
          <span ref={newShelfEditorRef} className="inline-flex items-center gap-1">
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
              className="h-[26px] w-24 rounded-full border border-stone-200 bg-white px-2.5 text-xs text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
            />
            <button
              type="button"
              onClick={() => void handleCreateShelf()}
              disabled={!newShelf.trim() || createShelf.isPending}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 disabled:opacity-40 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
              aria-label={_('library.newShelf')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 13 4 4 10-10" />
              </svg>
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`+ ${_('library.newShelf')}`}
            onClick={() => setNewShelfOpen(true)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            + {_('library.new')}
          </button>
        )}
      </div>

      <p className="mb-2 mt-4 text-xs font-semibold text-stone-500 dark:text-stone-400">{_('library.tags')}</p>
      <div className="flex max-h-28 flex-wrap items-center gap-1.5 overflow-y-auto custom-scrollbar [scrollbar-gutter:stable] pr-1">
        {(tagsData?.data ?? []).map((tag) => (
          <Chip
            key={tag.id}
            label={tag.name}
            selected={tagIds.has(tag.id)}
            showCheck
            onClick={() => onTagChange((current) => toggleSetItem(current, tag.id))}
          />
        ))}
        {newTagOpen ? (
          <span ref={newTagEditorRef} className="inline-flex items-center gap-1">
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
              className="h-[26px] w-24 rounded-full border border-stone-200 bg-white px-2.5 text-xs text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500"
            />
            <button
              type="button"
              onClick={() => void handleCreateTag()}
              disabled={!newTag.trim() || createTag.isPending}
              className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-stone-100 text-stone-600 transition-colors hover:bg-stone-200 hover:text-stone-900 disabled:opacity-40 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100"
              aria-label={_('library.newTag')}
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 13 4 4 10-10" />
              </svg>
            </button>
          </span>
        ) : (
          <button
            type="button"
            aria-label={`+ ${_('library.newTag')}`}
            onClick={() => setNewTagOpen(true)}
            className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          >
            + {_('library.new')}
          </button>
        )}
      </div>
    </section>
  )
}
