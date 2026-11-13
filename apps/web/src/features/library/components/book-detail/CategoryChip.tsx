import { useEffect, useRef, useState } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useTranslation } from '@/hooks/useTranslation'
import { computeAtPoint, type SmartPosition } from '@/lib/position'

import { useLibraryCategories } from '../../hooks'
import { categoryPath } from '../../taxonomy'
import CategoryPickerPanel, { type CategorySelection } from '../CategoryPickerPanel'
import TaxonomyIcon from '../TaxonomyIcon'
import { FilterChip } from './ui'

interface CategoryChipProps {
  /** The taxonomy this book belongs to: a shared library, or the private one. */
  libraryId: string | null
  categoryId: string | null
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
export default function CategoryChip({ libraryId, categoryId, fallbackLabel, editable, onFilter, onChange }: CategoryChipProps) {
  const _ = useTranslation()
  const { data, isPending, isError } = useLibraryCategories(libraryId)
  const categories = data?.data ?? []
  // A taxonomy that failed to load must not be presented as a stale name: the
  // known values are unusable, so the chip says so instead of guessing.
  const path = categoryId && !isError ? categoryPath(categories, categoryId) : []
  const loading = isPending && !data
  const unresolved = loading || isError

  const label = path.length > 0
    ? path.map((category) => category.name).join(' / ')
    : categoryId
      ? (isError ? _('library.categoryUnavailable') : loading ? _('library.categories') : fallbackLabel ?? _('library.categoryUnavailable'))
      : (loading ? _('library.categories') : _('library.uncategorized'))

  const anchorRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<SmartPosition | null>(null)
  // Without a tree there is nothing honest to pick from.
  const canEdit = editable && !unresolved

  useEffect(() => {
    if (!position) return
    const dismissOnScroll = (event: Event) => {
      if (!menuRef.current?.contains(event.target as Node)) setPosition(null)
    }
    const dismissOnResize = () => setPosition(null)
    window.addEventListener('scroll', dismissOnScroll, true)
    window.addEventListener('resize', dismissOnResize)
    return () => {
      window.removeEventListener('scroll', dismissOnScroll, true)
      window.removeEventListener('resize', dismissOnResize)
    }
  }, [position])

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
          setPosition(computeAtPoint({ x: event.clientX, y: event.clientY }, 240, 288))
        } : undefined}
      />
      {position && (
        <SmartMenu
          innerRef={menuRef}
          triggerRef={anchorRef}
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
            // A shared library owns its taxonomy, and a quick edit must not
            // mint a category from a recommendation: only real ones are offered.
            allowTemplates={false}
            onChange={onChange}
            onDismiss={() => setPosition(null)}
          />
        </SmartMenu>
      )}
    </>
  )
}
