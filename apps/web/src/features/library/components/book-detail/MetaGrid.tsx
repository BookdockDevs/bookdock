import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'

import { resolveMetaSpanClasses, resolveMetaValueSizeClasses } from './meta-grid'
import { copyValueOnClick } from './types'
import { ExpandableRowValue } from './ui'

export interface MetaRow {
  label: string
  value: string
  copyable?: boolean
  onClick?: () => void
  expandable?: boolean
  hint?: string
}

/**
 * The fact grid under the description. Column spans and the smaller type for
 * wrapped values are resolved from the values themselves, so a long file name
 * or subject list pushes its own cell wider instead of relying on the caller to
 * guess - which is how the two detail bodies had drifted apart.
 */
export default function MetaGrid({ rows, isLoading }: { rows: MetaRow[]; isLoading?: boolean }) {
  const _ = useTranslation()
  const values = rows.map((row) => row.value)
  const spanClasses = resolveMetaSpanClasses(values)
  const valueSizeClasses = resolveMetaValueSizeClasses(values)

  return (
    <section className="mt-5">
      <div className="rounded-xl border border-stone-200/70 bg-stone-50/70 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
        <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
          {rows.map((row, index) => (
            <div key={row.label} className={cn('min-w-0', spanClasses[index])}>
              <dt className="text-xs text-stone-400 dark:text-stone-500">{row.label}</dt>
              {row.copyable ? (
                <dd className="mt-0.5">
                  {row.expandable ? (
                    <ExpandableRowValue
                      value={row.value}
                      mono
                      textClass={valueSizeClasses[index] || 'text-sm'}
                      onCopy={() => copyValueOnClick(row.value)}
                      copyHint={row.hint}
                      expandLabel={_('library.expand')}
                      collapseLabel={_('library.collapse')}
                    />
                  ) : (
                    <button
                      type="button"
                      title={row.hint ?? row.value}
                      onClick={() => copyValueOnClick(row.value)}
                      className="block max-w-full cursor-pointer truncate text-left font-mono text-sm text-stone-700 hover:underline dark:text-stone-200"
                    >
                      {row.value}
                    </button>
                  )}
                </dd>
              ) : row.onClick ? (
                <dd className="mt-0.5">
                  <button
                    type="button"
                    title={row.value}
                    onClick={row.onClick}
                    className={cn('line-clamp-2 break-words text-left text-stone-700 underline decoration-stone-300 underline-offset-2 transition-colors hover:text-stone-900 dark:text-stone-200 dark:decoration-stone-600 dark:hover:text-stone-100', valueSizeClasses[index] || 'text-sm')}
                  >
                    {row.value}
                  </button>
                </dd>
              ) : row.expandable ? (
                <dd className="mt-0.5">
                  <ExpandableRowValue
                    value={row.value}
                    wrapClass="break-words"
                    textClass={valueSizeClasses[index] || 'text-sm'}
                    expandLabel={_('library.expand')}
                    collapseLabel={_('library.collapse')}
                  />
                </dd>
              ) : (
                <dd title={row.hint} className={cn('mt-0.5 line-clamp-2 break-words text-stone-700 dark:text-stone-200', valueSizeClasses[index] || 'text-sm')}>{row.value}</dd>
              )}
            </div>
          ))}
          {isLoading && (
            <>
              <div className="min-w-0 space-y-1">
                <div className="h-3 w-12 animate-pulse rounded bg-stone-200/70 dark:bg-stone-700/50" />
                <div className="h-4 w-20 animate-pulse rounded bg-stone-200/50 dark:bg-stone-700/30" />
              </div>
              <div className="min-w-0 space-y-1">
                <div className="h-3 w-10 animate-pulse rounded bg-stone-200/70 dark:bg-stone-700/50" />
                <div className="h-4 w-24 animate-pulse rounded bg-stone-200/50 dark:bg-stone-700/30" />
              </div>
            </>
          )}
        </dl>
      </div>
    </section>
  )
}
