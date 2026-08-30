import { useEffect, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { TocRuleRes } from '@bookdock/shared'

import { useDeleteTocRule, useReorderTocRules, useSeedTocRules, useTocRules } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'

import TocRuleEditor from './TocRuleEditor'
import TocRuleRow from './TocRuleRow'

const EMPTY_RULES: TocRuleRes[] = []

export default function TocRulesSettingsSection() {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { data } = useTocRules()
  const serverRules = data?.data ?? EMPTY_RULES
  const [optimisticRules, setOptimisticRules] = useState<TocRuleRes[] | null>(null)
  const rules = optimisticRules ?? serverRules
  const deleteRule = useDeleteTocRule()
  const reorderRules = useReorderTocRules()
  const seedRules = useSeedTocRules()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [editor, setEditor] = useState<{ open: boolean; initial: TocRuleRes | null }>({ open: false, initial: null })

  useEffect(() => {
    if (!optimisticRules) return
    const serverIds = serverRules.map((rule) => rule.id)
    const optimisticIds = optimisticRules.map((rule) => rule.id)
    const sameOrder = serverIds.length === optimisticIds.length && serverIds.every((id, index) => id === optimisticIds[index])
    const sameRules = serverIds.length === optimisticIds.length && serverIds.every((id) => optimisticIds.includes(id))
    if (sameOrder || !sameRules) setOptimisticRules(null)
  }, [optimisticRules, serverRules])

  function onDelete(rule: TocRuleRes) {
    if (!window.confirm(_('settings.tocRulesDeleteConfirm'))) return
    deleteRule.mutate(rule.id, {
      onSuccess: () => addToast(_('toast.tocRuleDeleted'), 'success'),
      onError: (err) => addToast(err.message, 'error'),
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return
    const oldIndex = rules.findIndex((rule) => rule.id === active.id)
    const newIndex = rules.findIndex((rule) => rule.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    const next = arrayMove(rules, oldIndex, newIndex)
    setOptimisticRules(next)
    reorderRules.mutate(next.map((rule) => rule.id), {
      onError: (err) => {
        setOptimisticRules(rules)
        addToast(err.message, 'error')
      },
    })
  }

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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rules.map((rule) => rule.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {rules.map((rule) => (
                <TocRuleRow
                  key={rule.id}
                  rule={rule}
                  onEdit={() => setEditor({ open: true, initial: rule })}
                  onDelete={() => onDelete(rule)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {editor.open && <TocRuleEditor initial={editor.initial} onClose={() => setEditor({ open: false, initial: null })} />}
    </section>
  )
}
