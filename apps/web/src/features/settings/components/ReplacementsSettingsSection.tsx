import { useLocalCatalog } from '@/features/reading-data/catalog-source-context'
import { useMemo, useState } from 'react'

import { DndContext, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

import { serializeReplacementsForExport, type TextReplacementRes } from '@bookdock/shared'

import { useDeleteGlobalReplacements, useReorderReplacements, useReplacements, useUpdateReplacement } from '@/api/hooks/useReplacements'
import Badge from '@/components/ui/Badge'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { downloadJsonFile, timestampSuffix } from '@/lib/download'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import EditModeButton from './EditModeButton'
import ExportConfirmDialog from './ExportConfirmDialog'
import ReplacementForm from './ReplacementForm'
import ReplacementImportDialog from './ReplacementImportDialog'
import RuleSelectAllBar from './RuleSelectAllBar'
import RuleSelectionActions from './RuleSelectionActions'
import SettingsCard from './SettingsCard'
import { DragHandleIcon, EditIcon, ExportIcon, ImportIcon, PlusIcon, TrashIcon } from './row-icons'

type FormState = { mode: 'create' } | { mode: 'edit'; rule: TextReplacementRes } | null

function ReplaceIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="m14 4 4 4-4 4" />
      <path d="M4 8h14" />
      <path d="m10 20-4-4 4-4" />
      <path d="M20 16H6" />
    </svg>
  )
}

export default function ReplacementsSettingsSection() {
  const local = useLocalCatalog()
  const _ = useTranslation()
  const replacementsQuery = useReplacements()
  const { data } = replacementsQuery
  const updateReplacement = useUpdateReplacement()
  const deleteReplacement = useDeleteGlobalReplacements()
  const reorderReplacements = useReorderReplacements()
  // This section is the GLOBAL home: book-scoped rules and point patches are
  // managed per book in the reader dialog. The order is the list the server
  // returns — its personal execution order, where the caller's own rules and
  // instance-published ones are interleaved as they were arranged. `group` is a
  // display label only and never re-sorts the list.
  const serverRules = useMemo(
    () => (data?.data ?? []).filter((r) => r.matchType === 'pattern' && r.bookId === null),
    [data],
  )
  const [draftIds, setDraftIds] = useState<string[] | null>(null)
  const [pendingExport, setPendingExport] = useState<TextReplacementRes[] | null>(null)
  const rules = useMemo(() => {
    if (!draftIds) return serverRules
    const rulesById = new Map(serverRules.map((rule) => [rule.id, rule]))
    const drafted = new Set(draftIds)
    return [...draftIds.flatMap((id) => (rulesById.get(id) ? [rulesById.get(id)!] : [])),
      ...serverRules.filter((rule) => !drafted.has(rule.id))]
  }, [draftIds, serverRules])

  const existingGroups = useMemo(() => {
    const names = new Set<string>()
    for (const r of rules) {
      const key = r.group?.trim()
      if (key) names.add(key)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [rules])

  const [form, setForm] = useState<FormState>(null)
  // Mirrors ReplacementForm's save state so the host modal can hold its close
  // entries while a submission is in flight.
  const [formSaving, setFormSaving] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<TextReplacementRes[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const selectedRules = rules.filter((rule) => selectedIds.includes(rule.id))
  // Rules published by another account show up here so their switch and order
  // can be managed, but the definition is the publisher's: no edit, no delete.
  const ownRules = rules.filter((rule) => rule.mine !== false)
  const busy = updateReplacement.isPending || deleteReplacement.isPending || reorderReplacements.isPending
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error, 'settings.replacementOperationFailed'))
  const listReady = !replacementsQuery.isError && (!replacementsQuery.isPending || replacementsQuery.data)

  function onToggle(rule: TextReplacementRes) {
    updateReplacement.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: showError },
    )
  }

  function confirmDelete() {
    if (!pendingDelete || busy) return
    const ruleIds = pendingDelete.map((rule) => rule.id)
    deleteReplacement.mutate({ ruleIds, ...(local ? { expectedVersions: Object.fromEntries(pendingDelete.map((rule) => [rule.id, rule.clientVersion!])) } : {}) }, {
      onSuccess: () => {
        setDraftIds((current) => current?.filter((id) => !ruleIds.includes(id)) ?? current)
        setSelectedIds([])
        setPendingDelete(null)
        notify.success({ key: 'toast.rulesDeleted', params: { count: ruleIds.length } })
      },
      onError: showError,
    })
  }

  function toggleEditing() {
    if (busy) return
    if (!editing) {
      setDraftIds(serverRules.map((rule) => rule.id))
      setSelectedIds([])
      setEditing(true)
      return
    }
    const nextIds = rules.map((rule) => rule.id)
    const serverIds = serverRules.map((rule) => rule.id)
    const unchanged = nextIds.length === serverIds.length && nextIds.every((id, index) => id === serverIds[index])
    if (unchanged) {
      setDraftIds(null)
      setSelectedIds([])
      setEditing(false)
      return
    }
    reorderReplacements.mutate(nextIds, {
      onSuccess: () => {
        setDraftIds(null)
        setSelectedIds([])
        setEditing(false)
      },
      onError: showError,
    })
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!editing || busy) return
    if (!over || active.id === over.id) return
    const oldIndex = rules.findIndex((rule) => rule.id === active.id)
    const newIndex = rules.findIndex((rule) => rule.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDraftIds(arrayMove(rules, oldIndex, newIndex).map((rule) => rule.id))
  }

  function requestExportRules(targets: TextReplacementRes[]) {
    if (!listReady || targets.length === 0) return
    setPendingExport(targets)
  }

  function exportRules(targets: TextReplacementRes[]) {
    if (!listReady || targets.length === 0) return
    downloadJsonFile(
      `bookdock-replacements-${timestampSuffix()}.json`,
      serializeReplacementsForExport(targets.map((rule) => ({
        name: rule.name,
        group: rule.group,
        pattern: rule.pattern ?? '',
        replacement: rule.replacement,
        isRegex: rule.isRegex,
        applyTo: rule.applyTo,
        enabled: rule.enabled,
      }))),
    )
  }

  return (
    <>
      <SettingsCard
        icon={<ReplaceIcon className="h-5 w-5" />}
        iconBgClass="bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400"
        title={
          <span className="flex items-baseline gap-1.5">
            <span>{_('settings.replacements')}</span>
            {rules.length > 0 && (
              <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">
                · {rules.length}
              </span>
            )}
          </span>
        }
        action={
          <div className="flex shrink-0 items-center gap-1">
            {editing && <RuleSelectionActions disabled={busy || !listReady} selectedCount={selectedRules.length} onExport={local ? undefined : () => requestExportRules(selectedRules)} onDelete={() => setPendingDelete(selectedRules.filter((rule) => rule.mine !== false))} />}
            {!editing && <>
              {!local && <button
                type="button"
                disabled={busy || !listReady}
                onClick={() => setImportOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.replacementsImport')}
                title={_('settings.replacementsImport')}
              >
                <ImportIcon />
              </button>}
              {!local && <button
                type="button"
                disabled={busy || !listReady || rules.length === 0}
                onClick={() => requestExportRules(rules)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.replacementsExportAll')}
                title={_('settings.replacementsExportAll')}
              >
                <ExportIcon />
              </button>}
            </>}
            <EditModeButton
              active={editing}
              disabled={busy || !listReady || (!editing && rules.length === 0)}
              onClick={toggleEditing}
            />
            {!editing && <button
              type="button"
              disabled={busy || !listReady}
              onClick={() => setForm({ mode: 'create' })}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
              aria-label={_('settings.replacementsNew')}
              title={_('settings.replacementsNew')}
            >
              <PlusIcon />
            </button>}
          </div>
        }
      >
      {editing && (
        <RuleSelectAllBar
          disabled={busy || !listReady || ownRules.length === 0}
          allSelected={ownRules.length > 0 && ownRules.every((rule) => selectedIds.includes(rule.id))}
          indeterminate={selectedRules.length > 0 && selectedRules.length < ownRules.length}
          selectedCount={selectedRules.length}
          onToggleAll={(checked) => setSelectedIds(checked ? ownRules.map((rule) => rule.id) : [])}
        />
      )}

      {replacementsQuery.isError ? (
        <QueryErrorState isRetrying={replacementsQuery.isFetching} onRetry={replacementsQuery.refetch} />
      ) : replacementsQuery.isPending && !replacementsQuery.data ? (
        <div className="space-y-3 py-1">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex animate-pulse items-center justify-between py-2.5">
              <div className="space-y-1.5">
                <div className="h-4 w-28 rounded bg-stone-200/80 dark:bg-stone-800" />
                <div className="h-3 w-40 rounded bg-stone-100 dark:bg-stone-800/60" />
              </div>
              <div className="h-5 w-9 rounded-full bg-stone-200/80 dark:bg-stone-800" />
            </div>
          ))}
        </div>
      ) : rules.length === 0 ? (
        <SettingsEmptyState>{_('settings.replacementsEmpty')}</SettingsEmptyState>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={rules.map((rule) => rule.id)} strategy={verticalListSortingStrategy}>
            <ul className="divide-y divide-stone-100 dark:divide-stone-800">
              {rules.map((rule) => (
                <ReplacementRow
                  key={rule.id}
                  rule={rule}
                  editing={editing}
                  disabled={busy || !listReady}
                  editable={rule.mine !== false}
                  selectable={rule.mine !== false}
                  onToggle={() => onToggle(rule)}
                  onEdit={() => setForm({ mode: 'edit', rule })}
                  onDelete={rule.mine !== false ? () => setPendingDelete([rule]) : undefined}
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
              {pendingDelete.map((rule) => <li key={rule.id}>{rule.name?.trim() || rule.pattern}</li>)}
            </ul>
          </>}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          confirmDisabled={busy}
          onClose={() => { if (!busy) setPendingDelete(null) }}
        />
      )}

      {form && (
        <Modal
          title={_(form.mode === 'create' ? 'settings.replacementsNew' : 'settings.replacementsEdit')}
          onClose={() => { if (!formSaving) setForm(null) }}
        >
          <ReplacementForm
            initial={form.mode === 'edit' ? form.rule : null}
            groups={existingGroups}
            onSavingChange={setFormSaving}
            onDone={() => { setFormSaving(false); setForm(null) }}
          />
        </Modal>
      )}

      {pendingExport && (
        <ExportConfirmDialog
          items={pendingExport.map((rule) => rule.name || rule.pattern || '')}
          onConfirm={() => {
            exportRules(pendingExport)
            setPendingExport(null)
          }}
          onClose={() => setPendingExport(null)}
        />
      )}

      {importOpen && (
        <ReplacementImportDialog
          // Only our own names can conflict: the server checks the caller's
          // rows, and a published rule keeps its name with the publisher.
          existingNames={ownRules.map((rule) => rule.name ?? '')}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}

function ReplacementRow({ rule, editing, disabled, editable, selectable, onToggle, onEdit, onDelete, selected, onSelect }: { rule: TextReplacementRes; editing: boolean; disabled: boolean; editable: boolean; selectable: boolean; onToggle: () => void; onEdit: () => void; onDelete?: () => void; selected: boolean; onSelect: () => void }) {
  const _ = useTranslation()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: rule.id,
    animateLayoutChanges: () => false,
  })
  // No arrow when the replacement is empty: a bare pattern means 净化 (the
  // match is removed), never a literal "delete" text.
  const replacementSummary = rule.replacement?.trim() ? `→ ${rule.replacement}` : ''
  const actionBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn('flex items-center gap-3 py-2', !editing && !rule.enabled && 'opacity-60', isDragging && 'relative z-10 opacity-60')}
    >
      {editing && selectable && <input type="checkbox" checked={selected} onChange={onSelect} disabled={disabled}
        aria-label={_('settings.ruleSelect', { name: rule.name?.trim() || rule.pattern || '—' })}
        className="h-4 w-4 shrink-0 accent-stone-700 dark:accent-stone-300" />}
      {editing && !selectable && <span className="h-4 w-4 shrink-0" aria-hidden="true" />}
      {editing && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          disabled={disabled}
          aria-label={_('settings.replacementsReorder')}
          title={_('settings.replacementsReorder')}
          className="flex h-8 w-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
        >
          <DragHandleIcon />
        </button>
      )}
      <div className="min-w-0 flex-1">
        {rule.name && (
          <p className="truncate text-sm">{rule.name}</p>
        )}
        <p className={cn('truncate font-mono text-xs text-stone-400 dark:text-stone-500', rule.name && 'mt-0.5')}>
          {rule.pattern}{replacementSummary && ` ${replacementSummary}`}
        </p>
      </div>
      {!editing && (
        <>
          {/* Badges stay read-only: the toggle carries on/off, and group is a
              label that never re-sorts. */}
          {rule.availability === 'instance' && <Badge>{_('settings.resourceScopeInstance')}</Badge>}
          {rule.isRegex && <Badge>{_('settings.replacementsRegex')}</Badge>}
          {rule.group?.trim() && <Badge>{rule.group.trim()}</Badge>}
          <div className="flex shrink-0 items-center gap-1">
            <Toggle checked={rule.enabled} onChange={onToggle} disabled={disabled} ariaLabel={_('settings.replacementsEnabled')} />
          </div>
        </>
      )}
      {editing && editable && (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onEdit} disabled={disabled} aria-label={_('settings.replacementsEditShort')} title={_('settings.replacementsEditShort')} className={actionBtn}>
            <EditIcon />
          </button>
          {onDelete && (
            <button type="button" onClick={onDelete} disabled={disabled} aria-label={_('settings.ruleDelete')} title={_('settings.ruleDelete')} className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-red-950/40">
              <TrashIcon />
            </button>
          )}
        </div>
      )}
    </li>
  )
}
