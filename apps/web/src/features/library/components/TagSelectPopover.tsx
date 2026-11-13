import { useEffect, useMemo, useRef, useState } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import type { MenuAnchor } from '@/lib/menu-anchor'

interface TagSelectPopoverProps {
  tags: { id: string; name: string }[]
  selectedTagIds: Set<string>
  onToggleTag: (tagId: string) => void
  onAddTag: (tagId: string) => void
  onCreateTag: (name: string) => Promise<string>
  creating?: boolean
}

export default function TagSelectPopover({
  tags,
  selectedTagIds,
  onToggleTag,
  onAddTag,
  onCreateTag,
  creating,
}: TagSelectPopoverProps) {
  const _ = useTranslation()
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Portaled for the same reason as the category picker: the dialog body
  // scrolls, and an in-flow panel is clipped at its edge.
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null)
  const open = Boolean(anchor)
  const [query, setQuery] = useState('')

  const normalizedQuery = query.trim().toLocaleLowerCase()

  // Filter tags based on query
  const filteredTags = useMemo(() => {
    if (!normalizedQuery) return tags
    return tags.filter((t) => t.name.toLocaleLowerCase().includes(normalizedQuery))
  }, [tags, normalizedQuery])

  // Does the exact query exist?
  const exactMatch = useMemo(() => {
    if (!normalizedQuery) return true
    return tags.some((t) => t.name.toLocaleLowerCase() === normalizedQuery)
  }, [tags, normalizedQuery])

  useEffect(() => {
    if (open) return
    setQuery('')
  }, [open])

  function toggle() {
    if (anchor) {
      setAnchor(null)
      return
    }
    const el = triggerRef.current
    if (!el) return
    setAnchor({ kind: 'element', el, placement: 'below', align: 'start' })
  }

  useEffect(() => {
    if (open) {
      inputRef.current?.focus()
    }
  }, [open])

  async function handleCreateTag() {
    const name = query.trim()
    if (!name || creating) return
    try {
      const id = await onCreateTag(name)
      onAddTag(id)
      setQuery('')
    } catch {
      // toast error handled by the caller's mutation
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      {/* Trigger Button */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={_('library.newTag')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className={`inline-flex min-h-[28px] cursor-pointer items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all select-none ${
          open
            ? 'border-stone-400 bg-white ring-2 ring-stone-200 dark:border-stone-500 dark:bg-stone-900 dark:ring-stone-800'
            : 'border-dashed border-stone-300 bg-stone-50/60 text-stone-500 hover:border-stone-400 hover:bg-stone-100 hover:text-stone-800 dark:border-stone-700 dark:bg-stone-800/40 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800 dark:hover:text-stone-200'
        }`}
      >
        <span className="text-stone-400 dark:text-stone-500">+</span>
        <span>{selectedTagIds.size > 0 ? _('library.tags') : _('library.newTag')}</span>
        <svg
          className={`h-3 w-3 shrink-0 text-stone-400 transition-transform duration-200 ${
            open ? 'rotate-180' : 'rotate-0'
          }`}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {/* Compact multi-select list, portaled so the dialog body cannot clip it */}
      {anchor && (
        <SmartMenu
          innerRef={panelRef}
          triggerRef={containerRef}
          anchor={anchor}
          onClose={() => setAnchor(null)}
          size={{ width: 'auto', height: 288 }}
          minWidth={208}
          maxWidth={304}
          className="max-h-72 overflow-y-auto custom-scrollbar"
        >
          <div role="region" aria-label={_('library.tags')}>
          {/* Search & Quick-Create Input */}
          <div className="mb-1 border-b border-stone-100 pb-1.5 dark:border-stone-800">
            <div className="flex items-center gap-1.5 rounded-lg border border-stone-200 bg-stone-50/80 px-2 py-1 focus-within:border-stone-400 focus-within:bg-white dark:border-stone-700 dark:bg-stone-800/60 dark:focus-within:border-stone-500 dark:focus-within:bg-stone-900">
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0 text-stone-400"
              >
                <circle cx="11" cy="11" r="8" />
                <path d="m21 21-4.3-4.3" />
              </svg>
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    e.preventDefault()
                    e.stopPropagation()
                    setAnchor(null)
                  } else if (e.key === 'Enter') {
                    e.preventDefault()
                    if (!exactMatch && query.trim()) {
                      void handleCreateTag()
                    }
                  }
                }}
                placeholder={_('library.findTags')}
                className="w-full bg-transparent text-xs text-stone-700 outline-none placeholder:text-stone-400 dark:text-stone-200"
              />
            </div>
          </div>

          {/* Quick Create Entry when query does not match existing tags */}
          {!exactMatch && query.trim() && (
            <button
              type="button"
              disabled={creating}
              onClick={() => void handleCreateTag()}
              className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-400">
                <path d="M12 5v14M5 12h14" />
              </svg>
              <span className="truncate">
                {creating ? '...' : `${_('library.create')} “${query.trim()}”`}
              </span>
            </button>
          )}

          {/* Tag items (checkable rows; stays open on click) */}
          <div className="space-y-0.5">
            {filteredTags.map((tag) => {
              const isChecked = selectedTagIds.has(tag.id)
              return (
                <button
                  key={tag.id}
                  type="button"
                  role="checkbox"
                  aria-checked={isChecked}
                  onClick={() => onToggleTag(tag.id)}
                  className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                    isChecked
                      ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                      : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50'
                  }`}
                >
                  <span className="truncate">{tag.name}</span>
                  {isChecked && (
                    <svg
                      width="13"
                      height="13"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="shrink-0 text-stone-900 dark:text-stone-100"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              )
            })}

            {filteredTags.length === 0 && exactMatch && (
              <p className="px-2 py-3 text-center text-xs text-stone-400 dark:text-stone-500">
                {_('library.noTags')}
              </p>
            )}
          </div>
          </div>
        </SmartMenu>
      )}
    </div>
  )
}
