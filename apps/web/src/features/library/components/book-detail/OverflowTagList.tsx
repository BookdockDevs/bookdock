import { useRef } from 'react'

import SmartMenu from '@/components/ui/SmartMenu'
import { useMenuAnchor } from '@/hooks/useMenuAnchor'
import { useTranslation } from '@/hooks/useTranslation'

import { FilterChip } from './ui'

type TagItem = string | { id?: string; name: string }

function getTagLabel(tag: TagItem): string {
  return typeof tag === 'string' ? tag : tag.name
}

function getTagFilterValue(tag: TagItem): string {
  return typeof tag === 'string' ? tag : (tag.id ?? tag.name)
}

interface OverflowTagListProps {
  tags: TagItem[]
  maxVisible?: number
  onTagClick?: (tag: string) => void
  prefix?: string
  size?: 'sm' | 'md'
}

export default function OverflowTagList({
  tags,
  maxVisible = 4,
  onTagClick,
  prefix = '#',
  size = 'md',
}: OverflowTagListProps) {
  const _ = useTranslation()
  const anchorRef = useRef<HTMLButtonElement>(null)
  const menu = useMenuAnchor()

  if (!tags?.length) return null

  // If tags are within threshold (e.g. <= 5 when maxVisible is 4),
  // showing 5 tags is better than 4 tags + "+1" (which takes identical space).
  const isOverflow = tags.length > maxVisible + 1
  const visibleTags = isOverflow ? tags.slice(0, maxVisible) : tags
  const overflowCount = tags.length - visibleTags.length

  const chipHeightClass = size === 'sm' ? 'min-h-[24px]' : 'min-h-7'
  const chipPadClass = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'

  return (
    <>
      {visibleTags.map((tag) => {
        const label = getTagLabel(tag)
        const filterVal = getTagFilterValue(tag)
        return onTagClick ? (
          <FilterChip
            key={filterVal}
            prefix={prefix}
            label={label}
            onClick={() => onTagClick(filterVal)}
          />
        ) : (
          <span
            key={filterVal}
            className={`inline-flex ${chipHeightClass} items-center rounded-md bg-stone-100/90 ${chipPadClass} text-xs text-stone-600 dark:bg-stone-800/90 dark:text-stone-300`}
          >
            {prefix && <span aria-hidden="true" className="opacity-60 font-mono text-[11px] mr-1">{prefix}</span>}
            <span>{label}</span>
          </span>
        )
      })}

      {isOverflow && (
        <>
          <button
            ref={anchorRef}
            type="button"
            aria-label={`${_('library.allTags')} (${tags.length})`}
            title={`${_('library.allTags')} (${tags.length})`}
            onClick={(e) => menu.toggleFromButton(e, 'below')}
            className={`inline-flex ${chipHeightClass} items-center justify-center gap-0.5 rounded-md ${chipPadClass} text-xs font-medium transition-colors select-none ${
              menu.open
                ? 'bg-stone-200 text-stone-900 dark:bg-stone-700 dark:text-stone-100'
                : 'bg-stone-100/90 text-stone-600 hover:bg-stone-200/90 hover:text-stone-900 dark:bg-stone-800/90 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-stone-100'
            }`}
          >
            <span>+{overflowCount}</span>
          </button>

          {menu.open && (
            <SmartMenu
              innerRef={menu.menuRef}
              triggerRef={anchorRef}
              anchor={menu.anchor}
              size={{ width: 'auto', height: 200 }}
              onClose={menu.close}
              className="max-h-72 overflow-y-auto custom-scrollbar"
              minWidth={200}
              maxWidth={340}
            >
              <div className="p-2">
                <div className="mb-2 flex items-center justify-between border-b border-stone-100 pb-1.5 px-0.5 dark:border-stone-800">
                  <span className="text-xs font-semibold text-stone-600 dark:text-stone-300">
                    {_('library.allTags')} ({tags.length})
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => {
                    const label = getTagLabel(tag)
                    const filterVal = getTagFilterValue(tag)
                    return onTagClick ? (
                      <FilterChip
                        key={filterVal}
                        prefix={prefix}
                        label={label}
                        onClick={() => {
                          menu.close()
                          onTagClick(filterVal)
                        }}
                      />
                    ) : (
                      <span
                        key={filterVal}
                        className={`inline-flex ${chipHeightClass} items-center rounded-md bg-stone-100/90 ${chipPadClass} text-xs text-stone-600 dark:bg-stone-800/90 dark:text-stone-300`}
                      >
                        {prefix && <span aria-hidden="true" className="opacity-60 font-mono text-[11px] mr-1">{prefix}</span>}
                        <span>{label}</span>
                      </span>
                    )
                  })}
                </div>
              </div>
            </SmartMenu>
          )}
        </>
      )}
    </>
  )
}
