import { LIBRARY_SORT_MODES, type LibrarySortMode } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { nextSidebarSort, sidebarSortDir, type SortDir } from '@/features/library/sort-modes'
import { useLibraryPrefs, useUpdateLibraryPrefs } from '@/features/library/hooks'

// N-06: default sidebar sort modes for shelves and tags. These are defaults
// only — an explicit URL still overrides them, and a shelf/tag drag flips the
// sidebar mode back to 'manual' from the library page. Book-list sort/view
// defaults are configured from the library page's view menu, not here.

const SORT_MODE_LABEL_KEYS: Record<LibrarySortMode, string> = {
  manual: 'library.sortMode.manual',
  name: 'library.sortMode.name',
  bookCount: 'library.sortMode.bookCount',
  recentlyAdded: 'library.sortMode.recentlyAdded',
  recentlyUpdated: 'library.sortMode.recentlyUpdated',
}

interface SegOption {
  value: string
  label: string
  active: boolean
  dir?: SortDir
}

interface SegRowProps {
  label: string
  hint: string
  options: SegOption[]
  onSelect: (value: string) => void
}

function SegRow({ label, hint, options, onSelect }: SegRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{label}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{hint}</p>
      </div>
      <div className="flex flex-wrap items-center gap-0.5 rounded-lg bg-stone-100 p-0.5 dark:bg-stone-800" role="group" aria-label={label}>
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            aria-pressed={opt.active}
            onClick={() => onSelect(opt.value)}
            className={cn(
              'flex h-7 items-center justify-center gap-0.5 rounded-md px-2 text-xs font-medium transition-all',
              opt.active
                ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
            )}
          >
            {opt.label}
            {opt.active && opt.dir && (
              <span className="text-stone-400 dark:text-stone-500" aria-hidden>
                {opt.dir === 'asc' ? '↑' : '↓'}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

function Divider() {
  return <div className="border-t border-stone-100 dark:border-stone-800" />
}

export default function LibraryPreferenceRows() {
  const _ = useTranslation()
  const prefs = useLibraryPrefs()
  const update = useUpdateLibraryPrefs()

  const shelfSort = prefs?.shelfSort
  const tagSort = prefs?.tagSort

  function sidebarOptions(pref: typeof shelfSort): SegOption[] {
    const dir = sidebarSortDir(pref)
    return LIBRARY_SORT_MODES.map((mode) => ({
      value: mode,
      label: _(SORT_MODE_LABEL_KEYS[mode]),
      active: (pref?.mode ?? 'manual') === mode,
      dir: mode === 'manual' ? undefined : dir,
    }))
  }

  return (
    <>
      <Divider />
      <SegRow
        label={_('settings.prefShelfSort')}
        hint={_('settings.prefShelfSortHint')}
        options={sidebarOptions(shelfSort)}
        onSelect={(value) => update.mutate({ shelfSort: nextSidebarSort(shelfSort, value as LibrarySortMode) })}
      />
      <Divider />
      <SegRow
        label={_('settings.prefTagSort')}
        hint={_('settings.prefTagSortHint')}
        options={sidebarOptions(tagSort)}
        onSelect={(value) => update.mutate({ tagSort: nextSidebarSort(tagSort, value as LibrarySortMode) })}
      />
    </>
  )
}
