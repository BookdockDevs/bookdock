import { useEffect, useState } from 'react'

import type { ClientCategoryView } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import SmartMenu from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/hooks/useTranslation'

import TaxonomyIcon from './TaxonomyIcon'

import { useUpdateLibraryCategory } from '../hooks'

interface CategoryValueDialogProps {
  open: boolean
  libraryId: string | null
  source?: 'local' | 'server' | null
  categories: ClientCategoryView[]
  path?: string[]
  initialName?: string
  onClose: () => void
}

export default function CategoryValueDialog({ open, libraryId, source, categories, path, initialName = '', onClose }: CategoryValueDialogProps) {
  const _ = useTranslation()
  const updateCategory = useUpdateLibraryCategory()
  const [name, setName] = useState(initialName)
  const [parentName, setParentName] = useState('')
  const dropdown = useMenuAnchor()
  const dropdownOpen = dropdown.open
  useEffect(() => {
    if (!open) return
    setName(initialName)
    setParentName(path?.length === 2 ? path[0]! : '')
  }, [open, initialName, path])
  if (!open || !path) return null
  const roots = categories.filter((category) => !category.parentId)
  const currentCategory = categories.find((category) => category.path.length === path.length && category.path.every((part, index) => part === path[index]))
  const canChangeParent = path.length === 2 || !categories.some((category) => category.parentId === currentCategory?.id)
  const parentOptions = roots.filter((root) => path.length === 2 || root.id !== currentCategory?.id)
  const anchor = dropdown.btnRef.current?.getBoundingClientRect()
  const dropdownWidth = Math.min(anchor?.width ?? 280, window.innerWidth - 16)
  const dropdownHeight = Math.min(192, (parentOptions.length + 1) * 32 + 10) + 10
  const submit = () => {
    const value = name.trim()
    if (!value || updateCategory.isPending) return
    const parentPath = canChangeParent && parentName ? [parentName] : null
    updateCategory.mutate({ libraryId, path, source, patch: { name: value, parentPath } }, { onSuccess: onClose })
  }
  return <Modal title={_('library.editCategory')} onClose={() => { if (!updateCategory.isPending) onClose() }} size="sm" footer={<div className="flex w-full gap-3"><Button type="button" variant="secondary" className="flex-1" disabled={updateCategory.isPending} onClick={onClose}>{_('library.cancel')}</Button><Button type="button" variant="primary" className="flex-1" disabled={!name.trim() || updateCategory.isPending} onClick={submit}>{_('library.save')}</Button></div>}>
    <div className="space-y-3">
      <div className="relative flex items-center">
        <span className="pointer-events-none absolute left-3 flex h-5 w-5 items-center justify-center text-stone-400 dark:text-stone-500"><TaxonomyIcon kind="category" size={17} /></span>
        <input type="text" value={name} onChange={(event) => setName(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') submit() }} placeholder={_('library.categoryName')} autoFocus className="h-10 w-full rounded-xl border border-stone-200/90 bg-stone-50/50 pl-10 pr-3.5 text-sm text-stone-900 outline-none transition-all placeholder:text-stone-400 focus:border-stone-400 focus:bg-white focus:ring-2 focus:ring-stone-400/20 dark:border-stone-700/80 dark:bg-stone-900/60 dark:text-stone-100 dark:placeholder:text-stone-500 dark:focus:border-stone-500 dark:focus:bg-stone-900 dark:focus:ring-stone-500/20" />
      </div>
        {canChangeParent && (
          <div>
            <label className="mb-1.5 block text-xs font-medium text-stone-600 dark:text-stone-300">
              {_('library.parentCategory')}
            </label>
            <div className="relative">
              <button
                ref={dropdown.btnRef}
                type="button"
                disabled={updateCategory.isPending}
                onClick={(event) => dropdown.toggleFromButton(event, 'below')}
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
                    {parentName
                      ? categories.find((c) => c.name === parentName)?.name ?? _('library.rootCategoryOption')
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
                <SmartMenu triggerRef={dropdown.btnRef} innerRef={dropdown.menuRef} anchor={dropdown.anchor} size={{ width: dropdownWidth, height: dropdownHeight }} onClose={dropdown.close}>
                <div className="max-h-[min(12rem,calc(100dvh-2rem))] overflow-y-auto overscroll-contain custom-scrollbar">
                  {/* Root / Top-level option */}
                  <button
                    type="button"
                    onClick={() => {
                      setParentName('')
                      dropdown.close()
                    }}
                    className={cn(
                      'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-xs transition-colors cursor-pointer',
                      !parentName
                        ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-600 hover:bg-stone-100/70 hover:text-stone-900 dark:text-stone-400 dark:hover:bg-stone-800/70 dark:hover:text-stone-100',
                    )}
                  >
                    <span className="flex items-center gap-2">
                      <TaxonomyIcon kind="category" size={14} className="shrink-0 text-stone-400 dark:text-stone-500" />
                      <span>{_('library.rootCategoryOption')}</span>
                    </span>
                    {!parentName && (
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-600 dark:text-stone-300">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </button>

                  {parentOptions.length > 0 && (
                    <div className="my-1 border-t border-stone-100 dark:border-stone-800" />
                  )}

                  {parentOptions.map((category) => {
                    const isSelected = parentName === category.name
                    return (
                      <button
                        key={category.name}
                        type="button"
                        onClick={() => {
                          setParentName(category.name)
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
}
