import { useTranslation } from '@/hooks/useTranslation'
import { readLibrarySearchExpression, simpleLibrarySearch } from '@bookdock/shared'
import { expressionDisplay, removeSearchCondition } from '../library-search-state'
import type { LibrarySearch } from '@/routes/index'

interface LibraryContextBarProps {
  search: LibrarySearch
  navSearch: (patch: Partial<LibrarySearch>) => void
  onClear: () => void
}

export default function LibraryContextBar({ search, navSearch, onClear }: LibraryContextBarProps) {
  const _ = useTranslation()
  let simple: ReturnType<typeof simpleLibrarySearch>
  if (search.expression) {
    try { simple = simpleLibrarySearch(readLibrarySearchExpression(search.expression)) } catch { /* The list reports invalid URLs. */ }
  }
  const conditions = [
    { key: 'expression' as const, label: search.expression && !simple ? expressionDisplay(search.expression) : undefined },
    { key: 'q' as const, label: search.q },
    { key: 'format' as const, label: search.format?.toUpperCase() },
    { key: 'status' as const, label: search.status ? _(`library.readStatus${search.status.charAt(0).toUpperCase()}${search.status.slice(1)}`) : undefined },
    { key: 'author' as const, label: search.author },
    { key: 'series' as const, label: search.series },
  ].filter((condition) => condition.label)
  const expressionConditions = simple?.map((node, index) => ({ node, index })).filter(({ node }) => {
    if (node.kind === 'text') return true
    return !['tag', 'shelf', 'category'].includes(node.field) || simple!.filter((entry) => entry.kind === 'field' && entry.field === node.field).length > 1
  }) ?? []
  if (conditions.length === 0 && expressionConditions.length === 0) {
    return null
  }
  return <div className="mb-5 flex flex-wrap items-center gap-2 text-xs text-stone-500 dark:text-stone-400">
    {expressionConditions.map(({ node, index }) => {
      const label = node.kind === 'text' ? node.value : node.field === 'format' ? node.value.toUpperCase()
        : node.field === 'status' ? _(`library.readStatus${node.value.charAt(0).toUpperCase()}${node.value.slice(1)}`) : `${node.field}:${node.value}`
      return <button type="button" key={`expression-${index}`} onClick={() => navSearch({ expression: removeSearchCondition(search.expression!, index) })} className="max-w-64 truncate rounded-full bg-stone-200/60 px-2.5 py-1 dark:bg-stone-800" title={label}>{label} ×</button>
    })}
    {conditions.map((condition) => <button type="button" key={condition.key} onClick={() => navSearch({ [condition.key]: undefined })} className="max-w-64 truncate rounded-full bg-stone-200/60 px-2.5 py-1 dark:bg-stone-800" title={condition.label}>{condition.label} ×</button>)}
    <button type="button" onClick={onClear} className="ml-auto hover:underline">{_('library.clearFilters')}</button>
  </div>
}
