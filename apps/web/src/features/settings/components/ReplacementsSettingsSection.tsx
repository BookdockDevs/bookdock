import { useMemo, useState } from 'react'

import type { TextReplacementRes } from '@bookdock/shared'

import { useDeleteReplacement, useReplacements, useUpdateReplacement } from '@/api/hooks/useReplacements'
import { Button } from '@/components/ui/Button'
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

type FormState = { mode: 'create' } | { mode: 'edit'; rule: TextReplacementRes } | null

export default function ReplacementsSettingsSection() {
  const _ = useTranslation()
  const replacementsQuery = useReplacements()
  const { data } = replacementsQuery
  const updateReplacement = useUpdateReplacement()
  const deleteReplacement = useDeleteReplacement()
  // This section is the GLOBAL home: book-scoped rules and point patches are
  // managed per book in the reader dialog. Newest first, with named groups after ungrouped rules.
  const rules = useMemo(
    () => (data?.data ?? [])
      .filter((r) => r.matchType === 'pattern' && r.bookId === null)
      .sort((a, b) => b.createdAt - a.createdAt),
    [data],
  )
  const groups = useMemo(() => {
    const byName = new Map<string, TextReplacementRes[]>()
    for (const r of rules) {
      const key = r.group?.trim() || ''
      if (!byName.has(key)) byName.set(key, [])
      byName.get(key)!.push(r)
    }
    const named = Array.from(byName.entries())
      .filter(([key]) => key)
      .sort((a, b) => a[0].localeCompare(b[0]))
    const ungrouped = byName.get('') ?? []
    return [...(ungrouped.length ? [['', ungrouped] as const] : []), ...named]
  }, [rules])

  const existingGroups = useMemo(
    () => groups.filter(([key]) => Boolean(key)).map(([key]) => key),
    [groups],
  )

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const toggleGroup = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const [form, setForm] = useState<FormState>(null)
  const [pendingDelete, setPendingDelete] = useState<TextReplacementRes | null>(null)
  const [renameGroupTarget, setRenameGroupTarget] = useState<{ oldName: string; rules: TextReplacementRes[] } | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<{ name: string; rules: TextReplacementRes[] } | null>(null)
  const [editing, setEditing] = useState(false)
  const busy = updateReplacement.isPending || deleteReplacement.isPending
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error))

  function onToggle(rule: TextReplacementRes) {
    updateReplacement.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: showError },
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    deleteReplacement.mutate(pendingDelete.id, {
      onError: showError,
    })
    setPendingDelete(null)
  }

  function toggleEditing() {
    if (busy) return
    setEditing((current) => !current)
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm sm:p-6 dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="flex items-baseline gap-1 text-sm font-medium">
            <span>{_('settings.replacements')}</span>
            {rules.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {rules.length}</span>}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <EditModeButton active={editing} activeLabel={_('settings.replacementsEditModeExit')} disabled={busy || (!editing && rules.length === 0)} onClick={toggleEditing} />
          <button
            type="button"
            disabled={busy || editing}
            onClick={() => setForm({ mode: 'create' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('settings.replacementsNew')}
            title={_('settings.replacementsNew')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

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
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {groups.map(([key, list]) => {
            const isUngrouped = !key
            const isCollapsed = !isUngrouped && collapsed.has(key)
            return (
              <div key={key || '__ungrouped__'}>
                {!isUngrouped && (
                  <div className="flex w-full items-center justify-between gap-2 py-2">
                    <button
                      type="button"
                      onClick={() => toggleGroup(key)}
                      aria-expanded={!isCollapsed}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="truncate text-xs font-medium text-stone-500 dark:text-stone-400">
                        {key}
                      </span>
                      <span className="text-xs tabular-nums text-stone-400 dark:text-stone-500">
                        {_('settings.replacementsCount', { count: list.length })}
                      </span>
                    </button>
                    <div className="flex shrink-0 items-center gap-1">
                      {editing && (
                        <>
                          <button
                            type="button"
                            onClick={() => setRenameGroupTarget({ oldName: key, rules: list })}
                            disabled={busy}
                            aria-label={_('settings.replacementsRenameGroup')}
                            title={_('settings.replacementsRenameGroup')}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
                            </svg>
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteGroupTarget({ name: key, rules: list })}
                            disabled={busy}
                            aria-label={_('settings.replacementsDeleteGroup')}
                            title={_('settings.replacementsDeleteGroup')}
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-red-400"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M3 6h18M19 6v14c0 1-2 2-2 2H7a2 2 0 0 1-2-2V6M8 6V4c0-1 2-2 2-2h4c1 0 2 2 2 2v2" />
                            </svg>
                          </button>
                        </>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleGroup(key)}
                        aria-label={isCollapsed ? _('annotation.expand') : _('annotation.collapse')}
                        className="flex h-7 w-7 items-center justify-center text-stone-400 transition-colors hover:text-stone-700 dark:text-stone-500 dark:hover:text-stone-300"
                      >
                        <svg
                          width="12"
                          height="12"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className={cn('text-stone-400 transition-transform dark:text-stone-500', !isCollapsed && 'rotate-180')}
                        >
                          <path d="m6 9 6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                )}
                {!isCollapsed && (
                  <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                    {list.map((rule) => (
                      <ReplacementRow
                        key={rule.id}
                        rule={rule}
                        editing={editing}
                        disabled={busy}
                        onToggle={() => onToggle(rule)}
                        onEdit={() => setForm({ mode: 'edit', rule })}
                        onDelete={() => setPendingDelete(rule)}
                      />
                    ))}
                  </ul>
                )}
              </div>
            )
          })}
        </div>
      )}

      {pendingDelete && (
        <ConfirmDialog
          title={_('settings.confirmDeleteTitle')}
          message={_('settings.replacementsDeleteConfirm', { name: pendingDelete.name?.trim() || pendingDelete.pattern || _('library.unknown') })}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {renameGroupTarget && (
        <RenameGroupModal
          oldName={renameGroupTarget.oldName}
          rules={renameGroupTarget.rules}
          onClose={() => setRenameGroupTarget(null)}
        />
      )}

      {deleteGroupTarget && (
        <DeleteGroupModal
          name={deleteGroupTarget.name}
          rules={deleteGroupTarget.rules}
          onClose={() => setDeleteGroupTarget(null)}
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
    </section>
  )
}

function RenameGroupModal({ oldName, rules, onClose }: { oldName: string; rules: TextReplacementRes[]; onClose: () => void }) {
  const _ = useTranslation()
  const [name, setName] = useState(oldName)
  const updateReplacement = useUpdateReplacement()
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error))
  const [busy, setBusy] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || trimmed === oldName) {
      onClose()
      return
    }
    setBusy(true)
    try {
      await Promise.all(
        rules.map((r) =>
          new Promise<void>((resolve, reject) => {
            updateReplacement.mutate(
              { id: r.id, body: { group: trimmed } },
              { onSuccess: () => resolve(), onError: reject },
            )
          }),
        ),
      )
      notify.success({ key: 'toast.replacementGroupRenamed' })
      onClose()
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={_('settings.replacementsRenameGroup')} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-xs font-medium text-stone-500 dark:text-stone-400">
            {_('settings.replacementsNewGroupName')}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            autoFocus
            maxLength={100}
            className="w-full rounded-lg border border-stone-200 bg-transparent px-3 py-2 text-sm outline-none transition-colors focus:border-stone-400 dark:border-stone-700 dark:focus:border-stone-500"
          />
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {_('library.cancel')}
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={busy || !name.trim() || name.trim() === oldName}
          >
            {_('library.save')}
          </Button>
        </div>
      </form>
    </Modal>
  )
}

function DeleteGroupModal({ name, rules, onClose }: { name: string; rules: TextReplacementRes[]; onClose: () => void }) {
  const _ = useTranslation()
  const [deleteRules, setDeleteRules] = useState(false)
  const updateReplacement = useUpdateReplacement()
  const deleteReplacement = useDeleteReplacement()
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error))
  const [busy, setBusy] = useState(false)

  async function handleConfirm() {
    setBusy(true)
    try {
      if (deleteRules) {
        await Promise.all(
          rules.map(
            (r) =>
              new Promise<void>((resolve, reject) => {
                deleteReplacement.mutate(r.id, {
                  onSuccess: () => resolve(),
                  onError: reject,
                })
              }),
          ),
        )
      } else {
        await Promise.all(
          rules.map(
            (r) =>
              new Promise<void>((resolve, reject) => {
                updateReplacement.mutate(
                  { id: r.id, body: { group: null } },
                  { onSuccess: () => resolve(), onError: reject },
                )
              }),
          ),
        )
      }
      notify.success({ key: 'toast.replacementGroupDeleted' })
      onClose()
    } catch (err) {
      showError(err)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title={_('settings.replacementsDeleteGroup')} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm text-stone-600 dark:text-stone-300">
          {_('settings.replacementsDeleteGroupConfirm', { name })}
        </p>

        <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-stone-200/80 bg-stone-50/60 p-3 text-sm dark:border-stone-800 dark:bg-stone-800/40">
          <input
            type="checkbox"
            checked={deleteRules}
            onChange={(e) => setDeleteRules(e.target.checked)}
            disabled={busy}
            className="mt-0.5 h-4 w-4 rounded border-stone-300 text-stone-900 focus:ring-stone-500 dark:border-stone-600 dark:bg-stone-700"
          />
          <div className="flex-1">
            <span className={cn('block font-medium', deleteRules ? 'text-red-600 dark:text-red-400' : 'text-stone-800 dark:text-stone-200')}>
              {_('settings.replacementsDeleteGroupRules', { count: rules.length })}
            </span>
            <span className="mt-0.5 block text-xs text-stone-400 dark:text-stone-500">
              {deleteRules
                ? _('settings.replacementsDeleteGroupDangerHint')
                : _('settings.replacementsDeleteGroupKeepHint')}
            </span>
          </div>
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={busy}>
            {_('library.cancel')}
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            onClick={() => void handleConfirm()}
            disabled={busy}
          >
            {_('library.delete')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function ReplacementRow({ rule, editing, disabled, onToggle, onEdit, onDelete }: { rule: TextReplacementRes; editing: boolean; disabled: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const _ = useTranslation()
  // No arrow when the replacement is empty: a bare pattern means 净化 (the
  // match is removed), never a literal "delete" text.
  const replacementSummary = rule.replacement?.trim() ? `→ ${rule.replacement}` : ''
  const badge = 'rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400'
  const actionBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200'
  const deleteBtn =
    'flex h-7 w-7 items-center justify-center rounded-lg text-red-500 transition-colors hover:bg-red-50 hover:text-red-600 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-red-400'

  return (
    <li className={cn('flex items-center gap-3 py-2', !rule.enabled && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        {rule.name && (
          <p className="truncate text-sm">{rule.name}</p>
        )}
        <p className={cn('truncate font-mono text-xs text-stone-400 dark:text-stone-500', rule.name && 'mt-0.5')}>
          {rule.pattern}{replacementSummary && ` ${replacementSummary}`}
        </p>
        {/* Only the regex badge stays: the settings page shows global rules
            only, where the toggle already carries the on/off state. */}
        {!editing && rule.isRegex && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={badge}>{_('settings.replacementsRegex')}</span>
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
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={_('settings.replacementsDelete')}
            title={_('settings.replacementsDelete')}
            className={deleteBtn}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 6h18M19 6v14c0 1-2 2-2 2H7a2 2 0 0 1-2-2V6M8 6V4c0-1 2-2 2-2h4c1 0 2 2 2 2v2" />
            </svg>
          </button>
        </div>
      )}
    </li>
  )
}
