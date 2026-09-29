import type { CatalogVersion } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { versionTabLabel, versionOrdinal } from '../book-row'

/**
 * Version picker for a multi-version work. A single version is the work
 * itself, so there is nothing to pick and the tabs stay hidden. Rows only
 * select; every action (read, collect, publish, delete, move, edit, upload)
 * lives in the selected-version panel, so there is exactly one place where
 * "which version" can be ambiguous - and it is always the visible one.
 */
interface VersionTabsProps {
  versions: CatalogVersion[]
  selectedId: string | null
  onSelect: (versionLinkId: string) => void
}

export default function VersionTabs({ versions, selectedId, onSelect }: VersionTabsProps) {
  const _ = useTranslation()

  if (versions.length <= 1) return null

  return (
    <div role="tablist" aria-label={_('library.catalogVersions')} className="flex flex-wrap gap-1.5">
      {versions.map((version) => {
        const selected = version.id === selectedId
        return (
          <button
            key={version.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(version.id)}
            className={cn(
              'flex items-center rounded-lg border px-2.5 py-1.5 text-xs transition-all',
              selected
                ? 'border-stone-400 bg-stone-100 font-semibold text-stone-900 shadow-2xs dark:border-stone-600 dark:bg-stone-800 dark:text-stone-100'
                : 'border-stone-200 bg-white font-medium text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600',
            )}
          >
            <span className="max-w-40 truncate">
              {versionTabLabel(version.name, _('library.versionFallback', { n: versionOrdinal(versions, version.id) }))}
            </span>
          </button>
        )
      })}
    </div>
  )
}
