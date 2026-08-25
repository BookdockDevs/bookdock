import { useState } from 'react'

import { useReToc, useTocRules } from '@/api/hooks/useTocRules'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { cn } from '@/lib/utils'

interface TocRulePickerProps {
  bookId: string
  /** Currently pinned/auto-scored rule id from the book meta */
  currentRuleId?: string
  /** True when the id was chosen by auto-scoring rather than pinned */
  autoScored?: boolean
}

/** Pure single-select list of the user's TOC rules for one TXT book. Picking a
 *  rule pins it and re-splits the book immediately; "auto" clears the pin. */
export default function TocRulePicker({ bookId, currentRuleId, autoScored }: TocRulePickerProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { data } = useTocRules()
  const rules = data?.data ?? []
  const reToc = useReToc(bookId)
  const [busyId, setBusyId] = useState<string | null>(null)

  function pick(tocRuleId: string | null) {
    if (busyId) return
    setBusyId(tocRuleId ?? '__auto__')
    reToc.mutate(
      { tocRuleId },
      {
        onSuccess: () => {
          setBusyId(null)
          addToast(tocRuleId ? _('library.tocRulePinSuccess') : _('library.tocRuleUnpinned'), 'success')
        },
        onError: (err) => {
          setBusyId(null)
          addToast(err.message || _('library.tocRulePinFailed'), 'error')
        },
      },
    )
  }

  const selected = currentRuleId && rules.some((r) => r.id === currentRuleId) ? currentRuleId : null

  return (
    <div>
      <ul className="flex flex-col gap-1">
        <li>
          <button
            type="button"
            disabled={busyId !== null}
            onClick={() => pick(null)}
            className={cn(
              'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50',
              selected === null
                ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
            )}
          >
            <span>{_('library.tocRuleNone')}</span>
            <span className={cn('text-xs', selected === null ? 'text-white/70 dark:text-stone-700' : 'text-stone-400')}>
              {_('library.tocRuleNoneHint')}
            </span>
          </button>
        </li>
        {rules.map((rule) => (
          <li key={rule.id}>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => pick(rule.id)}
              className={cn(
                'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50',
                selected === rule.id
                  ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                  : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{rule.name || '—'}</span>
              {selected === rule.id && (
                <span className={cn('shrink-0 text-xs', autoScored ? 'text-amber-300 dark:text-amber-600' : 'text-white/70 dark:text-stone-700')}>
                  {autoScored ? _('library.tocRuleAutoScored') : _('library.tocRulePinned')}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {rules.length === 0 && (
        <p className="mt-1 text-xs text-stone-400 dark:text-stone-500">{_('library.tocRulePickerEmpty')}</p>
      )}
    </div>
  )
}
