import { useMemo, useState } from 'react'

import { prepareRuleTransferExport, serializeReplacementsForExport, type ReplacementTransferFile, type TextReplacementRes } from '@bookdock/shared'

import { useDeleteGlobalReplacements, useReplacements, useUpdateReplacement } from '@/api/hooks/useReplacements'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import EditModeButton from './EditModeButton'
import ReplacementForm from './ReplacementForm'
import ReplacementImportDialog from './ReplacementImportDialog'
import RuleSelectionActions from './RuleSelectionActions'
import SettingsCard from './SettingsCard'

type FormState = { mode: 'create' } | { mode: 'edit'; rule: TextReplacementRes } | null

function downloadJsonFile(fileName: string, data: ReplacementTransferFile) {
  const prepared = prepareRuleTransferExport(data)
  if (!prepared.success) {
    notify.error({ key: prepared.reason === 'limit' ? 'settings.ruleExportLimit' : 'settings.ruleExportInvalid' })
    return
  }
  const blob = new Blob([prepared.text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function timestampSuffix(): string {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}
 
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
  const _ = useTranslation()
  const replacementsQuery = useReplacements()
  const { data } = replacementsQuery
  const updateReplacement = useUpdateReplacement()
  const deleteReplacement = useDeleteGlobalReplacements()
  // This section is the GLOBAL home: book-scoped rules and point patches are
  // managed per book in the reader dialog. Order is the persisted execution
  // order (sortOrder ascending); `group` is a display label only and never
  // re-sorts the list, so an import truly lands at the end of the whole list.
  const rules = useMemo(
    () => (data?.data ?? [])
      .filter((r) => r.matchType === 'pattern' && r.bookId === null)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt - b.createdAt),
    [data],
  )

  const existingGroups = useMemo(() => {
    const names = new Set<string>()
    for (const r of rules) {
      const key = r.group?.trim()
      if (key) names.add(key)
    }
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [rules])

  const [form, setForm] = useState<FormState>(null)
  const [pendingDelete, setPendingDelete] = useState<TextReplacementRes[] | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const selectedRules = rules.filter((rule) => selectedIds.includes(rule.id))
  const busy = updateReplacement.isPending || deleteReplacement.isPending
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
    deleteReplacement.mutate({ ruleIds }, {
      onSuccess: () => {
        setSelectedIds([])
        setPendingDelete(null)
        notify.success({ key: 'toast.rulesDeleted', params: { count: ruleIds.length } })
      },
      onError: showError,
    })
  }

  function toggleEditing() {
    if (busy) return
    setSelectedIds([])
    setEditing((current) => !current)
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
            {editing && <RuleSelectionActions disabled={busy || !listReady} selectedCount={selectedRules.length} onExport={() => exportRules(selectedRules)} onDelete={() => setPendingDelete(selectedRules)} />}
            <EditModeButton
              active={editing}
              activeLabel={_('settings.replacementsEditModeExit')}
              disabled={busy || !listReady || (!editing && rules.length === 0)}
              onClick={toggleEditing}
            />
            {!editing && <>
              <button
                type="button"
                disabled={busy || !listReady}
                onClick={() => setImportOpen(true)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.replacementsImport')}
                title={_('settings.replacementsImport')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4" />
                  <path d="M12 3v11m-5-5 5 5 5-5" />
                </svg>
              </button>
              <button
                type="button"
                disabled={busy || !listReady || rules.length === 0}
                onClick={() => exportRules(rules)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.replacementsExportAll')}
                title={_('settings.replacementsExportAll')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M3 16v4a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1v-4" />
                  <path d="M12 14V3m-5 5 5-5 5 5" />
                </svg>
              </button>
              <button
                type="button"
                disabled={busy || !listReady}
                onClick={() => setForm({ mode: 'create' })}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                aria-label={_('settings.replacementsNew')}
                title={_('settings.replacementsNew')}
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </button>
            </>}
          </div>
        }
      >
      {editing && (
        <div className="flex items-center gap-3 pb-2 text-xs text-stone-500 dark:text-stone-400">
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" checked={rules.length > 0 && selectedRules.length === rules.length}
              ref={(node) => { if (node) node.indeterminate = selectedRules.length > 0 && selectedRules.length < rules.length }}
              disabled={busy || !listReady || rules.length === 0}
              onChange={(event) => setSelectedIds(event.target.checked ? rules.map((rule) => rule.id) : [])}
              className="h-4 w-4 shrink-0 accent-stone-700 dark:accent-stone-300" />
            {_('settings.ruleSelectAll')}
          </label>
          <span>{_('settings.ruleSelectedCount', { count: selectedRules.length })}</span>
        </div>
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
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {rules.map((rule, index) => (
            <ReplacementRow
              key={rule.id}
              rule={rule}
              position={index + 1}
              editing={editing}
              disabled={busy || !listReady}
              onToggle={() => onToggle(rule)}
              onEdit={() => setForm({ mode: 'edit', rule })}
              selected={selectedIds.includes(rule.id)}
              onSelect={() => setSelectedIds((current) => current.includes(rule.id) ? current.filter((id) => id !== rule.id) : [...current, rule.id])}
            />
          ))}
        </ul>
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
          onClose={() => setForm(null)}
        >
          <ReplacementForm
            initial={form.mode === 'edit' ? form.rule : null}
            groups={existingGroups}
            onDone={() => setForm(null)}
          />
        </Modal>
      )}

      {importOpen && (
        <ReplacementImportDialog
          existingNames={rules.map((rule) => rule.name ?? '')}
          onClose={() => setImportOpen(false)}
        />
      )}
    </>
  )
}

function ReplacementRow({ rule, position, editing, disabled, onToggle, onEdit, selected, onSelect }: { rule: TextReplacementRes; position: number; editing: boolean; disabled: boolean; onToggle: () => void; onEdit: () => void; selected: boolean; onSelect: () => void }) {
  const _ = useTranslation()
  // No arrow when the replacement is empty: a bare pattern means 净化 (the
  // match is removed), never a literal "delete" text.
  const replacementSummary = rule.replacement?.trim() ? `→ ${rule.replacement}` : ''
  const badge = 'rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400'
  const actionBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  return (
    <li className={cn('flex items-center gap-3 py-2', !editing && !rule.enabled && 'opacity-60')}>
      {editing && <input type="checkbox" checked={selected} onChange={onSelect} disabled={disabled}
        aria-label={_('settings.ruleSelect', { name: rule.name?.trim() || rule.pattern || '—' })}
        className="h-4 w-4 shrink-0 accent-stone-700 dark:accent-stone-300" />}
      <span className="w-6 shrink-0 text-right text-xs tabular-nums text-stone-400 dark:text-stone-500">
        {position}
      </span>
      <div className="min-w-0 flex-1">
        {rule.name && (
          <p className="truncate text-sm">{rule.name}</p>
        )}
        <p className={cn('truncate font-mono text-xs text-stone-400 dark:text-stone-500', rule.name && 'mt-0.5')}>
          {rule.pattern}{replacementSummary && ` ${replacementSummary}`}
        </p>
        {/* Badges stay read-only: the toggle carries on/off, position is the
            execution order, and group is a label that never re-sorts. */}
        {!editing && (rule.isRegex || rule.group?.trim()) && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            {rule.isRegex && <span className={badge}>{_('settings.replacementsRegex')}</span>}
            {rule.group?.trim() && <span className={badge}>{rule.group.trim()}</span>}
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-1">
          <Toggle checked={rule.enabled} onChange={onToggle} disabled={disabled} ariaLabel={_('settings.replacementsEnabled')} />
        </div>
      )}
      {editing && (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onEdit} disabled={disabled} aria-label={_('settings.replacementsEditShort')} title={_('settings.replacementsEditShort')} className={actionBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>

        </div>
      )}
    </li>
  )
}
