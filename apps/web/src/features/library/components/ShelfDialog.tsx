import { useEffect, useState } from 'react'

import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import TaxonomyIcon from './TaxonomyIcon'
import { useContextMenu } from './use-context-menu'

import { useCreateLibraryCategory, useCreateShelf, useLibraryCategories, useRenameShelf, useUpdateLibraryCategory } from '../hooks'

interface ShelfDialogProps {
  open: boolean
  /** Set when the library in context is shared: the same dialog curates its categories. */
  libraryId?: string
  shelfId?: string
  initialName?: string
  initialParentId?: string
  onClose: () => void
}

export default function ShelfDialog({ open, libraryId, shelfId, initialName = '', initialParentId, onClose }: ShelfDialogProps) {
  const _ = useTranslation()
  const createShelf = useCreateShelf()
  const renameShelf = useRenameShelf()
  const createCategory = useCreateLibraryCategory()
  const renameCategory = useUpdateLibraryCategory()
  const [name, setName] = useState(initialName)
  const { data: taxonomy, isLoading: taxonomyLoading, isError: taxonomyFailed } = useLibraryCategories(libraryId ?? null)
  const [parentId, setParentId] = useState(initialParentId ?? '')
  const categories = taxonomy?.data ?? []
  const hasChildren = Boolean(shelfId && categories.some((category) => category.parentId === shelfId))

  const isRename = Boolean(shelfId)
  const isPending = createShelf.isPending || renameShelf.isPending
    || createCategory.isPending || renameCategory.isPending

  useEffect(() => {
    if (open) {
      setName(initialName)
      setParentId(initialParentId ?? '')
    }
  }, [open, initialName, initialParentId])

  const dropdown = useContextMenu()
  const dropdownOpen = dropdown.open
  const parentChoices = hasChildren ? [] : categories.filter((category) => category.parentId === null && category.id !== shelfId)
  const anchor = dropdown.btnRef.current?.getBoundingClientRect()
  const dropdownWidth = Math.min(anchor?.width ?? 280, window.innerWidth - 16)
  const dropdownHeight = Math.min(192, (parentChoices.length + 1) * 32 + 10) + 10
  const anchoredPosition = dropdown.position(dropdownWidth, dropdownHeight)
  const dropdownPosition = anchoredPosition && anchor
    ? { ...anchoredPosition, left: Math.max(8, Math.min(anchor.left, window.innerWidth - dropdownWidth - 8)) }
    : null

  useEffect(() => {
    if (!dropdownOpen) return
    const closeOnLayoutChange = (event: Event) => {
      if (event.target instanceof Node && dropdown.menuRef.current?.contains(event.target)) return
      dropdown.close()
    }
    window.addEventListener('resize', closeOnLayoutChange)
    window.addEventListener('scroll', closeOnLayoutChange, true)
    return () => {
      window.removeEventListener('resize', closeOnLayoutChange)
      window.removeEventListener('scroll', closeOnLayoutChange, true)
    }
  }, [dropdownOpen, dropdown])

  if (!open) return null

  const submit = () => {
    const trimmed = name.trim()
    if (!trimmed || isPending) return
    if (libraryId) {
      // A private shelf and a shared library's category are the same row in the
      // same table, so this is the same dialog pointed at the other library.
      if (isRename && shelfId) renameCategory.mutate({ libraryId, categoryId: shelfId, patch: { name: trimmed, parentId: parentId || null } }, { onSuccess: onClose })
      else createCategory.mutate({ libraryId, name: trimmed, ...(parentId ? { parentId } : {}) }, { onSuccess: onClose })
      return
    }
    if (isRename && shelfId) {
      renameShelf.mutate({ id: shelfId, name: trimmed }, { onSuccess: onClose })
    } else {
      createShelf.mutate(trimmed, { onSuccess: onClose })
    }
  }


  return (
    <Modal
      title={isRename
        ? _(libraryId ? 'library.editCategory' : 'library.editShelfTitle')
        : _(libraryId ? 'library.createCategory' : 'library.createShelf')}
      onClose={() => { if (!isPending) onClose() }}
      size="sm"
      footer={
        <div className="flex w-full gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isPending}
            className="h-10 flex-1 rounded-xl bg-stone-100 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700 cursor-pointer"
          >
            {_('library.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!name.trim() || isPending || Boolean(libraryId && (taxonomyLoading || taxonomyFailed))}
            className="h-10 flex-1 rounded-xl bg-stone-900 text-sm font-medium text-white transition-colors hover:bg-stone-800 disabled:cursor-not-allowed disabled:opacity-40 dark:bg-white dark:text-stone-900 dark:hover:bg-stone-300 cursor-pointer"
          >
            {isRename ? _('library.save') : _('library.create')}
          </button>
        </div>
      }
    >
      <div className="space-y-4 pt-1">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-3 flex h-5 w-5 items-center justify-center text-stone-400 dark:text-stone-500">
            <TaxonomyIcon kind={libraryId ? 'category' : 'shelf'} size={17} />
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder={_(libraryId ? 'library.categoryName' : 'library.shelfName')}
            autoFocus
            className="h-10 w-full rounded-xl border border-stone-200/90 bg-stone-50/50 pl-10 pr-3.5 text-sm text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-400/20 dark:border-stone-700/80 dark:bg-stone-900/60 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20"
          />
        </div>

        {libraryId && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
              {_('library.parentCategory')}
            </label>
            <div className="relative">
              <button
                ref={dropdown.btnRef}
                type="button"
                disabled={isPending || taxonomyLoading || taxonomyFailed}
                onClick={dropdown.toggleFromButton}
                aria-haspopup="listbox"
                aria-expanded={dropdownOpen}
                className={cn(
                  'flex h-10 w-full items-center justify-between rounded-xl border border-stone-200/90 bg-stone-50/50 px-3 text-left text-sm transition-all focus:outline-none dark:border-stone-700/80 dark:bg-stone-900/60 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed',
                  dropdownOpen
                    ? 'border-stone-400 bg-white ring-2 ring-stone-400/20 dark:border-stone-500 dark:bg-stone-900 dark:ring-stone-500/20'
                    : 'hover:bg-stone-100/60 dark:hover:bg-stone-800/60',
                )}
              >
                <span className="flex min-w-0 items-center gap-2 truncate text-stone-800 dark:text-stone-200">
                  <TaxonomyIcon kind="category" size={15} className="shrink-0 text-stone-400 dark:text-stone-500" />
                  <span className="truncate">
                    {parentId
                      ? categories.find((c) => c.id === parentId)?.name ?? _('library.rootCategoryOption')
                      : _('library.rootCategoryOption')}
                  </span>
                </span>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={cn('shrink-0 text-stone-400 transition-transform dark:text-stone-500', dropdownOpen && 'rotate-180')}
                >
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </button>

              {dropdownOpen && (
                <SmartMenu triggerRef={dropdown.btnRef} innerRef={dropdown.menuRef} position={dropdownPosition} onClose={dropdown.close} width={dropdownWidth}>
                <div className="max-h-[min(12rem,calc(100dvh-2rem))] overflow-y-auto overscroll-contain custom-scrollbar">
                  {/* Root / Top-level option */}
                  <button
                    type="button"
                    onClick={() => {
                      setParentId('')
                      dropdown.close()
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                      !parentId
                        ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <TaxonomyIcon kind="category" size={14} className="shrink-0 text-stone-400 dark:text-stone-500" />
                      <span>{_('library.rootCategoryOption')}</span>
                    </span>
                    {!parentId && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600 dark:text-stone-300">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>

                  {parentChoices.length > 0 && (
                    <div className="my-1 border-t border-stone-100 dark:border-stone-800" />
                  )}

                  {parentChoices.map((category) => {
                    const isSelected = parentId === category.id
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => {
                          setParentId(category.id)
                          dropdown.close()
                        }}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                          isSelected
                            ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                            : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                        )}
                      >
                        <span className="flex items-center gap-2 truncate">
                          <span className="text-stone-400 dark:text-stone-500 text-[10px]">↳</span>
                          <TaxonomyIcon kind="category" size={14} className="shrink-0 text-stone-400 dark:text-stone-500" />
                          <span className="truncate">{category.name}</span>
                        </span>
                        {isSelected && (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600 dark:text-stone-300">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
                </SmartMenu>
              )}
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}
