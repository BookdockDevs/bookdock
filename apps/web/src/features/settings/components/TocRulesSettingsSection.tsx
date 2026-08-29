import { useState } from 'react'

import type { TocRuleRes } from '@bookdock/shared'

import { useDeleteTocRule, useReorderTocRules, useSeedTocRules, useTocRules } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { cn } from '@/lib/utils'

import TocRuleEditor from './TocRuleEditor'

export default function TocRulesSettingsSection() {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { data } = useTocRules()
  const rules = data?.data ?? []
  const deleteRule = useDeleteTocRule()
  const reorderRules = useReorderTocRules()
  const seedRules = useSeedTocRules()
  const [editor, setEditor] = useState<{ open: boolean; initial: TocRuleRes | null }>({ open: false, initial: null })

  function onDelete(rule: TocRuleRes) {
    if (!window.confirm(_('settings.tocRulesDeleteConfirm'))) return
    deleteRule.mutate(rule.id, {
      onSuccess: () => addToast(_('toast.tocRuleDeleted'), 'success'),
      onError: (err) => addToast(err.message, 'error'),
    })
  }

  function onMove(index: number, dir: -1 | 1) {
    const target = index + dir
    if (target < 0 || target >= rules.length) return
    const next = [...rules]
    ;[next[index], next[target]] = [next[target], next[index]]
    reorderRules.mutate(next.map((r) => r.id), {
      onError: (err) => addToast(err.message, 'error'),
    })
  }

  const arrowBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-sm font-medium">{_('settings.tocRules')}</h2>
          {rules.length > 0 && (
            <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
              {_('settings.tocRulesCount', { count: rules.length })}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setEditor({ open: true, initial: null })}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={_('settings.tocRulesNew')}
          title={_('settings.tocRulesNew')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="flex flex-col items-start gap-2">
          <p className="text-xs text-stone-400 dark:text-stone-500">{_('settings.tocRulesEmpty')}</p>
          <Button type="button" variant="secondary" size="sm" onClick={() => {
            seedRules.mutate(undefined, {
              onSuccess: () => addToast(_('toast.tocRulesRestored'), 'success'),
              onError: (err) => addToast(err.message, 'error'),
            })
          }}>
            {_('settings.tocRulesRestore')}
          </Button>
        </div>
      ) : (
        <ul className="divide-y divide-stone-200 dark:divide-stone-800">
          {rules.map((rule, index) => (
            <li key={rule.id} className="flex items-center gap-3 py-2.5">
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={index === 0}
                  onClick={() => onMove(index, -1)}
                  aria-label={_('settings.moveUp')}
                  className={arrowBtn}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m18 15-6-6-6 6" />
                  </svg>
                </button>
                <button
                  type="button"
                  disabled={index === rules.length - 1}
                  onClick={() => onMove(index, 1)}
                  aria-label={_('settings.moveDown')}
                  className={arrowBtn}
                >
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className={cn('truncate text-sm', !rule.enabled && 'text-stone-400 line-through dark:text-stone-500')}>
                    {rule.name || '—'}
                  </p>
                  {!rule.enabled && (
                    <span className="rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-400 dark:border-stone-700">
                      {_('settings.tocRulesDisabled')}
                    </span>
                  )}
                </div>
                <p className="mt-0.5 truncate font-mono text-[11px] text-stone-400 dark:text-stone-500">
                  {rule.patterns.map((p) => `L${p.level}`).join(' · ') || '—'}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setEditor({ open: true, initial: rule })}
                  aria-label={_('settings.tocRulesEditShort')}
                  title={_('settings.tocRulesEditShort')}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(rule)}
                  aria-label={_('settings.tocRulesDelete')}
                  title={_('settings.tocRulesDelete')}
                  className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h18M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
                  </svg>
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {editor.open && <TocRuleEditor initial={editor.initial} onClose={() => setEditor({ open: false, initial: null })} />}
    </section>
  )
}
