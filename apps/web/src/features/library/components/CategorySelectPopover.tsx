import { useId, useMemo, useRef, useState } from 'react'

import { CATEGORY_TEMPLATES, type ClientCategoryView } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeDropdownPosition, type SmartPosition } from '@/lib/position'

import { categoryPath } from '../taxonomy'
import CategoryPickerPanel, { type CategorySelection } from './CategoryPickerPanel'
import TaxonomyIcon from './TaxonomyIcon'

interface CategorySelectPopoverProps {
  libraryId: string | null
  categories: ClientCategoryView[]
  categoryId: string | null | undefined
  categoryTemplateKey?: string
  allowTemplates?: boolean
  onChange: (value: CategorySelection) => void
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
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const id = useId()

  // The panel is portaled: the edit dialog body scrolls, so a panel positioned
  // in flow gets clipped at the body's edge and the lower half of a long
  // category tree cannot be reached.
  const [position, setPosition] = useState<SmartPosition | null>(null)
  const open = Boolean(position)

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

  function toggle() {
    if (position) {
      setPosition(null)
      return
    }
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    // Placement flips above the trigger by itself when the estimated panel
    // height does not fit below, and the panel is clamped into the viewport
    // once its real height is known.
    setPosition(
      computeDropdownPosition(
        { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        240,
        288,
        'start',
      ),
    )
  }

  return (
    <div ref={containerRef} className="relative inline-block text-left">
      {/* Notion/Linear-style Attribute Pill Trigger */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={_('library.categories')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
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

      {/* Portaled to the document: minsize keeps a two-level tree readable,
          the content decides the rest, and the max keeps long names from
          stretching the panel across the dialog. */}
      {position && (
        <SmartMenu
          id={id}
          innerRef={panelRef}
          triggerRef={containerRef}
          position={position}
          onClose={() => setPosition(null)}
          width="auto"
          minWidth={200}
          maxWidth={340}
          className="max-h-72 overflow-y-auto custom-scrollbar"
        >
          <CategoryPickerPanel
            libraryId={libraryId}
            categories={categories}
            categoryId={categoryId}
            categoryTemplateKey={categoryTemplateKey}
            allowTemplates={allowTemplates}
            onChange={onChange}
            onDismiss={() => setPosition(null)}
          />
        </SmartMenu>
      )}
    </div>
  )
}
