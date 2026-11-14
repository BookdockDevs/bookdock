import { useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { TocRuleRes } from '@bookdock/shared'

import { serializeTocRulesForExport } from '@bookdock/shared'

import { useDeleteTocRules, useReorderTocRules, useSeedTocRules, useTocRules, useUpdateTocRule } from '@/api/hooks/useTocRules'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import { useTranslation } from '@/hooks/useTranslation'
import { downloadJsonFile, timestampSuffix } from '@/lib/download'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'

import EditModeButton from './EditModeButton'
import RuleSelectAllBar from './RuleSelectAllBar'
import RuleSelectionActions from './RuleSelectionActions'
import SettingsCard from './SettingsCard'
import TocRuleEditor from './TocRuleEditor'
import TocRuleImportDialog from './TocRuleImportDialog'
import TocRuleRow from './TocRuleRow'
import { ExportIcon, ImportIcon, PlusIcon } from './row-icons'

const EMPTY_RULES: TocRuleRes[] = []

export default function TocRulesSettingsSection() {
  const _ = useTranslation()
  const rulesQuery = useTocRules()
  const { data } = rulesQuery
  const serverRules = data?.data ?? EMPTY_RULES
  // The restore button only appears when a built-in preset is actually missing.
  const restoreAvailable = data?.restoreAvailable ?? false
  const [sorting, setSorting] = useState(false)
  const [draftIds, setDraftIds] = useState<string[] | null>(null)
  const rulesById = new Map(serverRules.map((rule) => [rule.id, rule]))
  const draftIdSet = new Set(draftIds)
  const rules = sorting && draftIds
    ? [...draftIds.flatMap((id) => rulesById.get(id) ? [rulesById.get(id)!] : []),
      ...serverRules.filter((rule) => !draftIdSet.has(rule.id))]
    : serverRules
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedRules = rules.filter((rule) => selectedIds.includes(rule.id))
  // Published rules from another account run here (and can be switched off or
  // reordered) but their definition belongs to the publisher: no edit, no
  // delete, no selection for a batch that would be rejected server-side.
  const ownRules = rules.filter((rule) => rule.mine !== false)
  const deleteRule = useDeleteTocRules()
  const reorderRules = useReorderTocRules()
  const seedRules = useSeedTocRules()
  const updateRule = useUpdateTocRule()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const [editor, setEditor] = useState<{ open: boolean; initial: TocRuleRes | null }>({ open: false, initial: null })
  const [pendingDelete, setPendingDelete] = useState<TocRuleRes[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const busy = updateRule.isPending || deleteRule.isPending || reorderRules.isPending || seedRules.isPending
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.tocRuleOperationFailed'))
  const listReady = !rulesQuery.isError && (!rulesQuery.isPending || data)

  function onToggle(rule: TocRuleRes) {
    updateRule.mutate({ id: rule.id, body: { enabled: !rule.enabled } }, { onError: showError })
  }

  function confirmDelete() {
    if (!pendingDelete || busy) return
    const ruleIds = pendingDelete.map((rule) => rule.id)
    deleteRule.mutate({ ruleIds }, {
      onSuccess: () => {
        setDraftIds((current) => current?.filter((id) => !ruleIds.includes(id)) ?? current)
        setSelectedIds([])
        setPendingDelete(null)
        notify.success({ key: 'toast.rulesDeleted', params: { count: ruleIds.length } })
      },
      onError: showError,
    })
  }

  function exportRules(targets: TocRuleRes[]) {
    if (!listReady || targets.length === 0) return
    downloadJsonFile(
      `bookdock-toc-rules-${timestampSuffix()}.json`,
      serializeTocRulesForExport(targets.map((rule) => ({
        name: rule.name,
        enabled: rule.enabled,
        patterns: rule.patterns.map((pattern) => ({
          level: pattern.level,
          regex: pattern.regex,
          replacement: pattern.replacement,
          enabled: pattern.enabled,
        })),
      }))),
    )
  }

  function toggleSorting() {
    if (busy) return
    if (!sorting) {
      setDraftIds(serverRules.map((rule) => rule.id))
      setSelectedIds([])
      setSorting(true)
      return
    }
    const next = rules
    const nextIds = next.map((rule) => rule.id)
    const serverIds = serverRules.map((rule) => rule.id)
    if (nextIds.length === serverIds.length && nextIds.every((id, index) => id === serverIds[index])) {
      setDraftIds(null)
      setSelectedIds([])
      setSorting(false)
      return
    }
    reorderRules.mutate(nextIds, {
      onSuccess: () => {
        setDraftIds(null)
        setSelectedIds([])
        setSorting(false)
      },
      onError: showError,
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!sorting || busy) return
    if (!over || active.id === over.id) return
    const currentRules = rules
    const oldIndex = currentRules.findIndex((rule) => rule.id === active.id)
    const newIndex = currentRules.findIndex((rule) => rule.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDraftIds(arrayMove(currentRules, oldIndex, newIndex).map((rule) => rule.id))
  }

  return (
    <>
      <SettingsCard
        icon={<BookmarkIcon className="h-5 w-5" />}
        iconBgClass="bg-teal-500/10 text-teal-600 dark:bg-teal-500/20 dark:text-teal-400"
        title={
          <span className="flex items-baseline gap-1.5">
            <span>{_('settings.tocRules')}</span>
            {rules.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {rules.length}</span>}
          </span>
        }
        action={
          <div className="flex shrink-0 items-center gap-1">
            {sorting && <RuleSelectionActions disabled={busy || !listReady} selectedCount={selectedRules.length} onExport={() => exportRules(selectedRules)} onDelete={() => setPendingDelete(selectedRules.filter((rule) => rule.mine !== false))} />}
            {!sorting && <>
              <button
                type="button"
                disabled={busy || !listReady}
                onClick={() => setImportOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.tocImport')}
                title={_('settings.tocImport')}
              >
                <ImportIcon />
              </button>
              <button
                type="button"
                disabled={busy || !listReady || serverRules.length === 0}
                onClick={() => exportRules(serverRules)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.tocExportAll')}
                title={_('settings.tocExportAll')}
              >
                <ExportIcon />
              </button>
            </>}
            {sorting && restoreAvailable && <button
              type="button"
              disabled={busy || !listReady}
              onClick={() => seedRules.mutate(undefined, {
                onSuccess: (response) => {
                  const added = response.data.filter((rule) => rule.builtIn && !serverRules.some((current) => current.id === rule.id)).length
                  if (added === 0) notify.info({ key: 'toast.tocRulesAlreadyPresent' })
                  else notify.success({ key: 'toast.tocRulesRestored', params: { count: added } })
                },
                onError: showError,
              })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('settings.tocRulesRestore')}
              title={_('settings.tocRulesRestore')}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="m9 14-5-5 5-5" />
                <path d="M4 9h10.5A5.5 5.5 0 1 1 9 19H8" />
              </svg>
            </button>}
            {!sorting && <EditModeButton active={false} disabled={busy || !listReady} onClick={toggleSorting} />}
            {sorting && <EditModeButton active disabled={busy || !listReady} onClick={toggleSorting} />}
            {!sorting && <button
              type="button"
              disabled={busy || !listReady}
              onClick={() => setEditor({ open: true, initial: null })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('settings.tocRulesNew')}
              title={_('settings.tocRulesNew')}
            >
              <PlusIcon />
            </button>}
          </div>
        }
        bodyClassName={sorting ? undefined : 'pt-3'}
      >
      {sorting && (
        <RuleSelectAllBar
          disabled={busy || !listReady || ownRules.length === 0}
          allSelected={ownRules.length > 0 && ownRules.every((rule) => selectedIds.includes(rule.id))}
          indeterminate={selectedRules.length > 0 && selectedRules.length < ownRules.length}
          selectedCount={selectedRules.length}
          onToggleAll={(checked) => setSelectedIds(checked ? ownRules.map((rule) => rule.id) : [])}
        />
      )}
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
                  disabled={busy || !listReady}
                  sorting={sorting}
                  onToggle={() => onToggle(rule)}
                  onEdit={() => setEditor({ open: true, initial: rule })}
                  onDelete={rule.mine !== false ? () => setPendingDelete([rule]) : undefined}
                  editable={rule.mine !== false}
                  selectable={rule.mine !== false}
                  selected={selectedIds.includes(rule.id)}
                  onSelect={() => setSelectedIds((current) => current.includes(rule.id) ? current.filter((id) => id !== rule.id) : [...current, rule.id])}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      </SettingsCard>

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={<>
            <p>{_('settings.ruleDeleteSelectedConfirm', { count: pendingDelete.length })}</p>
            <ul className="mt-2 max-h-40 overflow-y-auto break-words pl-4 list-disc">
              {pendingDelete.map((rule) => <li key={rule.id}>{rule.name}</li>)}
            </ul>
          </>}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          confirmDisabled={busy}
          onClose={() => { if (!busy) setPendingDelete(null) }}
        />
      )}

      {editor.open && <TocRuleEditor initial={editor.initial} onClose={() => setEditor({ open: false, initial: null })} />}

      {importOpen && (
        <TocRuleImportDialog
          // Only our own names can conflict: a published rule keeps its name
          // with the publisher, and the server compares against the caller.
          existingNames={ownRules.map((rule) => rule.name)}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}

function BookmarkIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
    </svg>
  )
}
