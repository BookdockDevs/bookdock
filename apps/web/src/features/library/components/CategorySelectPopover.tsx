import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'

import { CATEGORY_TEMPLATES, type Category } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'

import { useCreateLibraryCategory } from '../hooks'
import { categoryPath } from '../taxonomy'
import TaxonomyIcon from './TaxonomyIcon'

interface CategorySelectPopoverProps {
  libraryId: string
  categories: Category[]
  categoryId: string | null | undefined
  categoryTemplateKey?: string
  allowTemplates?: boolean
  onChange: (value: { categoryId: string | null; categoryTemplateKey?: undefined } | { categoryId?: undefined; categoryTemplateKey: string }) => void
}

export default function CategorySelectPopover({
  libraryId,
  categories,
  categoryId,
  categoryTemplateKey,
  allowTemplates = true,
  onChange,
}: CategorySelectPopoverProps) {
  const _ = useTranslation()
  const createCategory = useCreateLibraryCategory()
  const containerRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const [open, setOpen] = useState(false)
  const [flipUp, setFlipUp] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newParentId, setNewParentId] = useState<string>('')
  const inputId = useId()
  const parentSelectId = useId()

  const currentPath = useMemo(() => {
    if (!categoryId) return []
    return categoryPath(categories, categoryId)
  }, [categories, categoryId])

  const selectedTemplateRoot = useMemo(() => {
    if (!categoryTemplateKey) return undefined
    return CATEGORY_TEMPLATES.find((root) => root.key === categoryTemplateKey || root.children?.some((child) => child.key === categoryTemplateKey))
  }, [categoryTemplateKey])

  const currentLabel = useMemo(() => {
    if (currentPath.length > 0) {
      return currentPath.map((c) => c.name).join(' / ')
    }
    if (selectedTemplateRoot && categoryTemplateKey) {
      return `${_(`library.categoryTemplate.${selectedTemplateRoot.key}.name`)}${selectedTemplateRoot.key === categoryTemplateKey ? '' : ` / ${_(`library.categoryTemplate.${categoryTemplateKey}`)}`}`
    }
    return _('library.uncategorized')
  }, [currentPath, selectedTemplateRoot, categoryTemplateKey, _])

  const isSelected = Boolean(categoryId || categoryTemplateKey)

  // Split into Level 1 (Roots) and Level 2 (Children)
  const rootCategories = useMemo(() => categories.filter((c) => !c.parentId), [categories])
  const childCategoriesMap = useMemo(() => {
    const map = new Map<string, Category[]>()
    for (const cat of categories) {
      if (cat.parentId) {
        const list = map.get(cat.parentId) ?? []
        list.push(cat)
        map.set(cat.parentId, list)
      }
    }
    return map
  }, [categories])

  useLayoutEffect(() => {
    if (!open || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - rect.bottom
    // If space below is less than 280px and space above is larger, flip upwards
    if (spaceBelow < 280 && rect.top > spaceBelow) {
      setFlipUp(true)
    } else {
      setFlipUp(false)
    }
  }, [open])

  useEffect(() => {
    if (!open) {
      setIsCreating(false)
      setNewName('')
      setNewParentId('')
      return
    }
    const onMouseDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false)
        setIsCreating(false)
      }
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        setOpen(false)
        setIsCreating(false)
      }
    }
    document.addEventListener('mousedown', onMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  useEffect(() => {
    if (isCreating) {
      inputRef.current?.focus()
    }
  }, [isCreating])

  async function handleCreateCategory() {
    const name = newName.trim()
    if (!name || createCategory.isPending) return
    try {
      const res = await createCategory.mutateAsync({
        libraryId,
        name,
        parentId: newParentId || undefined,
      })
      onChange({ categoryId: res.data.id })
      setIsCreating(false)
      setNewName('')
      setNewParentId('')
      setOpen(false)
    } catch {
      // toast error handled by mutation
    }
  }

  function startCreateChild(parentId: string) {
    setNewParentId(parentId)
    setIsCreating(true)
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      {/* Notion/Linear-style Attribute Pill Trigger */}
      <button
        type="button"
        aria-label={_('library.categories')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={`group inline-flex max-w-[320px] min-h-[30px] cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-all select-none ${
          open
            ? 'border-stone-400 bg-white ring-2 ring-stone-200 dark:border-stone-500 dark:bg-stone-900 dark:ring-stone-800'
            : isSelected
              ? 'border-stone-300 bg-stone-100/90 text-stone-800 hover:border-stone-400 hover:bg-stone-200/80 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-200 dark:hover:border-stone-600'
              : 'border-stone-200 bg-stone-50/80 text-stone-600 hover:border-stone-300 hover:bg-stone-100 dark:border-stone-700/80 dark:bg-stone-800/50 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800'
        }`}
      >
        <TaxonomyIcon kind="category" size={13} className="shrink-0 text-stone-500 dark:text-stone-400" />
        <span className="truncate">{currentLabel}</span>

        {isSelected && (
          <span
            role="button"
            tabIndex={0}
            aria-label={_('library.uncategorized')}
            title={_('library.uncategorized')}
            onClick={(e) => {
              e.stopPropagation()
              onChange({ categoryId: null })
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.stopPropagation()
                e.preventDefault()
                onChange({ categoryId: null })
              }
            }}
            className="ml-0.5 flex h-4 w-4 items-center justify-center rounded text-stone-400 transition-colors hover:bg-stone-200/80 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </span>
        )}

        <svg
          className={`h-3 w-3 shrink-0 text-stone-400 transition-transform duration-200 ${
            open ? (flipUp ? 'rotate-0' : 'rotate-180') : (flipUp ? 'rotate-180' : 'rotate-0')
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

      {/* Floating Popover Panel: compact width (w-72), adaptive flip-up to prevent clipping */}
      {open && (
        <div
          ref={panelRef}
          role="region"
          aria-label={_('library.categories')}
          className={`absolute left-0 z-30 w-72 max-h-72 overflow-y-auto rounded-xl border border-stone-200 bg-white p-1.5 shadow-xl custom-scrollbar dark:border-stone-700 dark:bg-stone-900 animate-modal-panel ${
            flipUp ? 'bottom-full mb-1.5' : 'top-full mt-1.5'
          }`}
        >
          {/* Create Category Action / Inline Form */}
          <div className="mb-1 border-b border-stone-100 pb-1.5 dark:border-stone-800">
            {isCreating ? (
              <div className="space-y-2 rounded-lg bg-stone-50 p-2 dark:bg-stone-800/60">
                <div className="flex items-center justify-between text-[11px] font-semibold text-stone-600 dark:text-stone-300">
                  <span>{newParentId ? _('library.newSubcategory') : _('library.newCategory')}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsCreating(false)
                      setNewName('')
                      setNewParentId('')
                    }}
                    className="text-stone-400 hover:text-stone-600 dark:hover:text-stone-200"
                  >
                    {_('library.cancel')}
                  </button>
                </div>

                {/* Level selection: Root vs Subcategory of an existing root */}
                <div className="space-y-1">
                  <label htmlFor={parentSelectId} className="block text-[11px] text-stone-400">
                    {_('library.parentCategory')}
                  </label>
                  <select
                    id={parentSelectId}
                    value={newParentId}
                    onChange={(e) => setNewParentId(e.target.value)}
                    className="h-7 w-full rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                  >
                    <option value="">{_('library.rootCategoryOption')}</option>
                    {rootCategories.map((root) => (
                      <option key={root.id} value={root.id}>
                        {root.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Name input */}
                <div className="flex items-center gap-1.5">
                  <input
                    ref={inputRef}
                    id={inputId}
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        void handleCreateCategory()
                      }
                    }}
                    placeholder={_('library.categoryName')}
                    className="h-7 flex-1 rounded-md border border-stone-200 bg-white px-2 text-xs text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                  />
                  <button
                    type="button"
                    disabled={!newName.trim() || createCategory.isPending}
                    onClick={() => void handleCreateCategory()}
                    className="flex h-7 items-center justify-center rounded-md bg-stone-900 px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-40 dark:bg-stone-100 dark:text-stone-900"
                  >
                    {createCategory.isPending ? '...' : _('library.create')}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="flex w-full items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-stone-600 transition-colors hover:bg-stone-100 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-800 dark:hover:text-stone-100"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                <span>{_('library.newCategory')}</span>
              </button>
            )}
          </div>

          {/* Uncategorized Option */}
          <div className="space-y-0.5">
            <button
              type="button"
              role="radio"
              aria-checked={categoryId === null && !categoryTemplateKey}
              aria-label={_('library.uncategorized')}
              onClick={() => {
                onChange({ categoryId: null })
                setOpen(false)
              }}
              className={`flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                categoryId === null && !categoryTemplateKey
                  ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                  : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50'
              }`}
            >
              <span>{_('library.uncategorized')}</span>
              {categoryId === null && !categoryTemplateKey && (
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-900 dark:text-stone-100">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>

            {/* Existing Categories Tree (Roots + Subcategories) */}
            {rootCategories.map((root) => {
              const children = childCategoriesMap.get(root.id) ?? []
              const isRootSelected = categoryId === root.id && !categoryTemplateKey

              return (
                <div key={root.id} className="space-y-0.5">
                  {/* Root Row */}
                  <div
                    className={`group flex items-center justify-between rounded-lg px-2.5 py-1.5 text-xs transition-colors ${
                      isRootSelected
                        ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                        : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800/50'
                    }`}
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isRootSelected}
                      aria-label={root.name}
                      onClick={() => {
                        onChange({ categoryId: root.id })
                        setOpen(false)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                    >
                      <TaxonomyIcon kind="category" size={13} className="shrink-0 text-stone-400" />
                      <span className="truncate">{root.name}</span>
                    </button>

                    <div className="flex shrink-0 items-center gap-1">
                      {/* Quick "+ Subcategory" shortcut */}
                      <button
                        type="button"
                        aria-label={`${_('library.newSubcategory')} (${root.name})`}
                        title={_('library.newSubcategory')}
                        onClick={(e) => {
                          e.stopPropagation()
                          startCreateChild(root.id)
                        }}
                        className="opacity-0 transition-opacity group-hover:opacity-100 p-0.5 text-stone-400 hover:text-stone-700 dark:hover:text-stone-200"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M12 5v14M5 12h14" />
                        </svg>
                      </button>

                      {isRootSelected && (
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-900 dark:text-stone-100">
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                      )}
                    </div>
                  </div>

                  {/* Children Rows */}
                  {children.map((child) => {
                    const isChildSelected = categoryId === child.id && !categoryTemplateKey
                    return (
                      <button
                        key={child.id}
                        type="button"
                        role="radio"
                        aria-checked={isChildSelected}
                        aria-label={child.name}
                        onClick={() => {
                          onChange({ categoryId: child.id })
                          setOpen(false)
                        }}
                        className={`flex w-full items-center justify-between rounded-lg py-1.5 pl-6 pr-2.5 text-xs transition-colors ${
                          isChildSelected
                            ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                            : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-1.5 truncate">
                          <span className="text-stone-300 dark:text-stone-600">└</span>
                          <span className="truncate">{child.name}</span>
                        </span>
                        {isChildSelected && (
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-stone-900 dark:text-stone-100">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )
            })}
          </div>

          {/* Recommended Categories Accordion */}
          {allowTemplates && (
            <details className="mt-2 border-t border-stone-100 pt-1.5 dark:border-stone-800">
              <summary className="cursor-pointer rounded-lg px-2 py-1 text-[11px] font-semibold text-stone-400 hover:text-stone-600 dark:hover:text-stone-300">
                {_('library.recommendedCategories')}
              </summary>
              <div className="mt-1 space-y-1.5 px-1 py-1">
                {CATEGORY_TEMPLATES.map((root) => {
                  const rootName = _(`library.categoryTemplate.${root.key}.name`)
                  const children = root.children ?? []
                  return (
                    <div key={root.key} className="space-y-0.5">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={categoryTemplateKey === root.key}
                        aria-label={rootName}
                        onClick={() => {
                          onChange({ categoryTemplateKey: root.key })
                          setOpen(false)
                        }}
                        className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-xs transition-colors ${
                          categoryTemplateKey === root.key
                            ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                            : 'text-stone-600 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50'
                        }`}
                      >
                        <span className="truncate">{rootName}</span>
                        {categoryTemplateKey === root.key && (
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </button>

                      {children.map((child) => {
                        const childLabel = _(`library.categoryTemplate.${child.key}`)
                        const fullChildLabel = `${rootName} / ${childLabel}`
                        const isChildTemplateSelected = categoryTemplateKey === child.key
                        return (
                          <button
                            key={child.key}
                            type="button"
                            role="radio"
                            aria-checked={isChildTemplateSelected}
                            aria-label={fullChildLabel}
                            onClick={() => {
                              onChange({ categoryTemplateKey: child.key })
                              setOpen(false)
                            }}
                            className={`flex w-full items-center justify-between rounded-md py-1 pl-5 pr-2 text-xs transition-colors ${
                              isChildTemplateSelected
                                ? 'bg-stone-100 font-medium text-stone-900 dark:bg-stone-800 dark:text-stone-100'
                                : 'text-stone-500 hover:bg-stone-50 dark:text-stone-400 dark:hover:bg-stone-800/50'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-1.5 truncate">
                              <span className="text-stone-300 dark:text-stone-600">└</span>
                              <span className="truncate">{childLabel}</span>
                            </span>
                            {isChildTemplateSelected && (
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  )
}
