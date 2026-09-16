import { useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { TocRuleRes } from '@bookdock/shared'

import { useDeleteTocRule, useReorderTocRules, useSeedTocRules, useTocRules, useUpdateTocRule } from '@/api/hooks/useTocRules'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import EditModeButton from './EditModeButton'
import TocRuleEditor from './TocRuleEditor'
import TocRuleRow from './TocRuleRow'

const EMPTY_RULES: TocRuleRes[] = []

export default function TocRulesSettingsSection() {
  const _ = useTranslation()
  const rulesQuery = useTocRules()
  const { data } = rulesQuery
  const serverRules = data?.data ?? EMPTY_RULES
  const [sorting, setSorting] = useState(false)
  const [draftRules, setDraftRules] = useState<TocRuleRes[] | null>(null)
  const rules = sorting ? draftRules ?? serverRules : serverRules
  const deleteRule = useDeleteTocRule()
  const reorderRules = useReorderTocRules()
  const seedRules = useSeedTocRules()
  const updateRule = useUpdateTocRule()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [editor, setEditor] = useState<{ open: boolean; initial: TocRuleRes | null }>({ open: false, initial: null })
  const [pendingDelete, setPendingDelete] = useState<TocRuleRes | null>(null)
  const busy = updateRule.isPending || deleteRule.isPending || reorderRules.isPending || seedRules.isPending
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error))

  function onToggle(rule: TocRuleRes) {
    const enabled = !rule.enabled
    if (sorting) setDraftRules((current) => current?.map((item) => item.id === rule.id ? { ...item, enabled } : item) ?? current)
    updateRule.mutate({ id: rule.id, body: { enabled } }, {
      onError: (error) => {
        if (sorting) setDraftRules((current) => current?.map((item) => item.id === rule.id ? { ...item, enabled: rule.enabled } : item) ?? current)
        showError(error)
      },
    })
  }

  function onDelete(rule: TocRuleRes) {
    setPendingDelete(rule)
  }

  function confirmDelete() {
    if (!pendingDelete) return
    deleteRule.mutate(pendingDelete.id, {
      onSuccess: () => {
        if (sorting) setDraftRules((current) => current?.filter((rule) => rule.id !== pendingDelete.id) ?? current)
        notify.success({ key: 'toast.tocRuleDeleted' })
      },
      onError: showError,
    })
    setPendingDelete(null)
  }

  function toggleSorting() {
    if (busy) return
    if (!sorting) {
      setDraftRules(serverRules)
      setSorting(true)
      return
    }
    const next = draftRules ?? serverRules
    const nextIds = next.map((rule) => rule.id)
    const serverIds = serverRules.map((rule) => rule.id)
    if (nextIds.length === serverIds.length && nextIds.every((id, index) => id === serverIds[index])) {
      setDraftRules(null)
      setSorting(false)
      return
    }
    reorderRules.mutate(nextIds, {
      onSuccess: () => {
        setDraftRules(null)
        setSorting(false)
      },
      onError: showError,
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!sorting || busy) return
    if (!over || active.id === over.id) return
    const currentRules = draftRules ?? serverRules
    const oldIndex = currentRules.findIndex((rule) => rule.id === active.id)
    const newIndex = currentRules.findIndex((rule) => rule.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDraftRules(arrayMove(currentRules, oldIndex, newIndex))
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="flex items-baseline gap-1 text-sm font-medium">
            <span>{_('settings.tocRules')}</span>
            {rules.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {rules.length}</span>}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <EditModeButton active={sorting} disabled={busy || (!sorting && rules.length === 0)} onClick={toggleSorting} />
          <button
            type="button"
            disabled={busy || sorting}
            onClick={() => seedRules.mutate(undefined, { onSuccess: () => notify.success({ key: 'toast.tocRulesRestored' }), onError: showError })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('settings.tocRulesRestore')}
            title={_('settings.tocRulesRestore')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="m9 14-5-5 5-5" />
              <path d="M4 9h10.5A5.5 5.5 0 1 1 9 19H8" />
            </svg>
          </button>
          <button
            type="button"
            disabled={busy || sorting}
            onClick={() => setEditor({ open: true, initial: null })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('settings.tocRulesNew')}
            title={_('settings.tocRulesNew')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {rulesQuery.isError ? (
        <QueryErrorState isRetrying={rulesQuery.isFetching} onRetry={rulesQuery.refetch} />
      ) : rulesQuery.isPending && !data ? (
        <div className="space-y-3 py-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
              <div className="space-y-1.5">
                <div className="h-4 w-32 rounded bg-stone-200/80 dark:bg-stone-800" />
                <div className="h-3 w-48 rounded bg-stone-100 dark:bg-stone-800/60" />
              </div>
              <div className="h-5 w-9 rounded-full bg-stone-200/80 dark:bg-stone-800" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <SettingsEmptyState>{_('settings.tocRulesEmpty')}</SettingsEmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rules.map((rule) => rule.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-stone-200 dark:divide-stone-800">
              {rules.map((rule) => (
                <TocRuleRow
                  key={rule.id}
                  rule={rule}
                  disabled={busy}
                  sorting={sorting}
                  onToggle={() => onToggle(rule)}
                  onEdit={() => setEditor({ open: true, initial: rule })}
                  onDelete={() => onDelete(rule)}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('settings.tocRulesDeleteConfirm', { name: pendingDelete.name })}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {editor.open && <TocRuleEditor initial={editor.initial} onClose={() => setEditor({ open: false, initial: null })} />}
    </section>
  )
}
