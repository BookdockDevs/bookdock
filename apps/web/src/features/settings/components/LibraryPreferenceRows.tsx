import { LIBRARY_SORT_MODES, type LibrarySortMode } from '@bookdock/shared'

import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { nextSidebarSort, sidebarSortDir, type SortDir } from '@/features/library/sort-modes'
import { useLibraryPrefs, useUpdateLibraryPrefs } from '@/features/library/hooks'
import { useUiStore, type RecentlyReadStyle } from '@/stores/ui.store'

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

interface ToggleRowProps {
  label: string
  hint: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function ToggleRow({ label, hint, checked, onChange }: ToggleRowProps) {
  return (
    <div className="flex items-center justify-between gap-x-4 py-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-stone-700 dark:text-stone-200">{label}</p>
        <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative h-5 w-9 shrink-0 rounded-full transition-colors focus:outline-hidden',
          checked ? 'bg-stone-900 dark:bg-stone-100' : 'bg-stone-200 dark:bg-stone-700',
        )}
      >
        <span
          className={cn(
            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-xs transition-transform dark:bg-stone-900',
            checked && 'translate-x-4',
          )}
        />
      </button>
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

  const readingStatsEnabled = useUiStore((s) => s.readingStatsEnabled)
  const setReadingStatsEnabled = useUiStore((s) => s.setReadingStatsEnabled)
  const recentlyReadStyle = useUiStore((s) => s.recentlyReadStyle)
  const setRecentlyReadStyle = useUiStore((s) => s.setRecentlyReadStyle)
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

  const recentlyReadOptions: SegOption[] = [
    { value: 'off', label: _('library.recentlyReadOff'), active: recentlyReadStyle === 'off' },
    { value: 'covers', label: _('library.recentlyReadCovers'), active: recentlyReadStyle === 'covers' },
    { value: 'cards', label: _('library.recentlyReadCards'), active: recentlyReadStyle === 'cards' },
  ]

  return (
    <>
      <Divider />
      <ToggleRow
        label={_('settings.prefReadingStats')}
        hint={_('settings.prefReadingStatsHint')}
        checked={readingStatsEnabled}
        onChange={setReadingStatsEnabled}
      />
      <Divider />
      <SegRow
        label={_('settings.prefRecentlyRead')}
        hint={_('settings.prefRecentlyReadHint')}
        options={recentlyReadOptions}
        onSelect={(value) => setRecentlyReadStyle(value as RecentlyReadStyle)}
      />
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
