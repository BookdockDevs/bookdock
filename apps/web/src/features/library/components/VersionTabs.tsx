import type { CatalogVersion } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { versionTabLabel } from '../book-row'

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
      {versions.map((version, index) => {
        const selected = version.id === selectedId
        return (
          <button
            key={version.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(version.id)}
            className={cn(
              'flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-all',
              selected
                ? 'border-stone-900 bg-stone-900 text-white shadow-xs dark:border-stone-100 dark:bg-stone-100 dark:text-stone-900'
                : 'border-stone-200 bg-white text-stone-600 hover:border-stone-300 hover:bg-stone-50 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-300 dark:hover:border-stone-600',
            )}
          >
            <span className="max-w-32 truncate">
              {versionTabLabel(version.name, _('library.versionFallback', { n: index + 1 }))}
            </span>
            <span className={cn('text-[10px]', selected ? 'opacity-70' : 'text-stone-400')}>
              {version.format.toUpperCase()}
            </span>
            {version.status === 'unlisted' && (
              <span className={cn(
                'rounded px-1 py-px text-[10px]',
                selected
                  ? 'bg-white/20 text-white dark:bg-stone-900/20 dark:text-stone-900'
                  : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300',
              )}
              >
                {_('library.catalogUnlisted')}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
