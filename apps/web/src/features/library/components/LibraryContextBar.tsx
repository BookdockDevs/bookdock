import { useTranslation } from '@/hooks/useTranslation'
import type { LibrarySearch } from '@/routes/index'

interface LibraryContextBarProps {
  search: LibrarySearch
  navSearch: (patch: Partial<LibrarySearch>) => void
  onClear: () => void
}

export default function LibraryContextBar({ search, navSearch, onClear }: LibraryContextBarProps) {
  const _ = useTranslation()
  const conditions = [
    { key: 'q' as const, label: search.q },
    { key: 'format' as const, label: search.format?.toUpperCase() },
    { key: 'status' as const, label: search.status ? _(`library.readStatus${search.status.charAt(0).toUpperCase()}${search.status.slice(1)}`) : undefined },
    { key: 'author' as const, label: search.author },
    { key: 'series' as const, label: search.series },
  ].filter((condition) => condition.label)
  if (conditions.length === 0) {
    return null
  }
  return <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
    {conditions.map((condition) => <button type="button" key={condition.key} onClick={() => navSearch({ [condition.key]: undefined })} className="max-w-64 truncate rounded-full bg-stone-200/60 px-2.5 py-1 dark:bg-stone-800" title={condition.label}>{condition.label} ×</button>)}
    {conditions.length > 0 && <button type="button" onClick={onClear} className="ml-auto hover:underline">{_('library.clearFilters')}</button>}
  </div>
}
