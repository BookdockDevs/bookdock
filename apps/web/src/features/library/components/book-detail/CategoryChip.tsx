import { useRef } from 'react'

import type { ClientCategoryView } from '@bookdock/shared'

import SmartMenu from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { useTranslation } from '@/hooks/useTranslation'

import { useLibraryCategories } from '../../hooks'
import CategoryPickerPanel, { type CategorySelection } from '../CategoryPickerPanel'
import TaxonomyIcon from '../TaxonomyIcon'
import { FilterChip } from './ui'

interface CategoryChipProps {
  /** The taxonomy this book belongs to: a shared library, or the private one. */
  libraryId: string | null
  categories?: ClientCategoryView[]
  categoryPath: string[] | null
  /** What the row already carried, for a category the taxonomy no longer has. */
  fallbackLabel?: string
  /** Only a caller that may write the book offers the quick edit. */
  editable: boolean
  onFilter: () => void
  onChange: (value: CategorySelection) => void
}

/**
 * The category chip in a detail header: click filters the list, right-click
 * edits - the same gesture the fact grid already uses for a single field, and
 * the same panel the edit dialog's select opens, so a quick edit and the full
 * form cannot disagree about what a category pick looks like.
 */
export default function CategoryChip({ libraryId, categories: choices, categoryPath, fallbackLabel, editable, onFilter, onChange }: CategoryChipProps) {
  const _ = useTranslation()
  const { data, isPending, isError } = useLibraryCategories(libraryId, { enabled: !choices })
  const categories = choices ?? data?.data ?? []
  // A taxonomy that failed to load must not be presented as a stale name: the
  // known values are unusable, so the chip says so instead of guessing.
  const loading = !choices && Boolean(libraryId) && isPending && !data
  const unresolved = !choices && (loading || isError)

  const label = categoryPath?.length
    ? categoryPath.join(' / ')
    : categoryPath
      ? (isError ? _('library.categoryUnavailable') : loading ? _('library.categories') : fallbackLabel ?? _('library.categoryUnavailable'))
      : _('library.uncategorized')

  const anchorRef = useRef<HTMLButtonElement>(null)
  const menu = useMenuAnchor()
  // Without a tree there is nothing honest to pick from.
  const canEdit = editable && !unresolved

  return (
    <>
      <FilterChip
        buttonRef={anchorRef}
        icon={<TaxonomyIcon kind="category" size={13} className="text-stone-400" />}
        label={label}
        onClick={onFilter}
        onContextMenu={canEdit ? (event) => {
          event.preventDefault()
          event.stopPropagation()
          menu.openFromEvent(event)
        } : undefined}
      />
      {menu.open && (
        <SmartMenu
          innerRef={menu.menuRef}
          triggerRef={anchorRef}
          anchor={menu.anchor}
          onClose={menu.close}
          size={{ width: 'auto', height: 288 }}
          minWidth={200}
          maxWidth={340}
          className="max-h-72 overflow-y-auto custom-scrollbar pr-1.5"
        >
          <CategoryPickerPanel
            categories={categories}
            categoryPath={categoryPath}
            // A shared library owns its taxonomy, and a quick edit must not
            // mint a category from a recommendation: only real ones are offered.
            allowTemplates={false}
            onChange={onChange}
            onDismiss={menu.close}
          />
        </SmartMenu>
      )}
    </>
  )
}
