import { useMemo, useState } from 'react'

import type { TextTransformRes } from '@bookdock/shared'

import { useDeleteTransform, useTransforms, useUpdateTransform } from '@/api/hooks/useTransforms'
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
import TransformForm from './TransformForm'

type FormState = { mode: 'create' } | { mode: 'edit'; rule: TextTransformRes } | null

export default function TransformsSettingsSection() {
  const _ = useTranslation()
  const transformsQuery = useTransforms()
  const { data } = transformsQuery
  const updateTransform = useUpdateTransform()
  const deleteTransform = useDeleteTransform()
  // This section is the GLOBAL home: book-scoped rules and point patches are
  // managed per book in the reader dialog. Newest first, with named groups after ungrouped rules.
  const rules = useMemo(
    () => (data?.data ?? [])
      .filter((r) => r.matchType === 'pattern' && r.bookId === null)
      .sort((a, b) => b.createdAt - a.createdAt),
    [data],
  )
  const groups = useMemo(() => {
    const byName = new Map<string, TextTransformRes[]>()
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
  const [pendingDelete, setPendingDelete] = useState<TextTransformRes | null>(null)
  const [editing, setEditing] = useState(false)
  const busy = updateTransform.isPending || deleteTransform.isPending
  const showError = (error: unknown) => notify.error(getUserErrorNotification(error))

  function onToggle(rule: TextTransformRes) {
    updateTransform.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: showError },
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    deleteTransform.mutate(pendingDelete.id, {
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
            <span>{_('settings.transforms')}</span>
            {rules.length > 0 && <span className="text-xs font-normal tabular-nums text-stone-400 dark:text-stone-500">· {rules.length}</span>}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <EditModeButton active={editing} activeLabel={_('settings.transformsEditModeExit')} disabled={busy || (!editing && rules.length === 0)} onClick={toggleEditing} />
          <button
            type="button"
            disabled={busy || editing}
            onClick={() => setForm({ mode: 'create' })}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            aria-label={_('settings.transformsNew')}
            title={_('settings.transformsNew')}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </div>
      </div>

      {transformsQuery.isError ? (
        <QueryErrorState isRetrying={transformsQuery.isFetching} onRetry={transformsQuery.refetch} />
      ) : rules.length === 0 ? (
        <SettingsEmptyState>{_('settings.transformsEmpty')}</SettingsEmptyState>
      ) : (
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {groups.map(([key, list]) => {
            const isUngrouped = !key
            const isCollapsed = !isUngrouped && collapsed.has(key)
            return (
              <div key={key || '__ungrouped__'}>
                {!isUngrouped && (
                  <button
                    type="button"
                    onClick={() => toggleGroup(key)}
                    aria-expanded={!isCollapsed}
                    className="flex w-full items-center justify-between gap-2 py-2 text-left"
                  >
                    <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                      {key}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="text-xs tabular-nums text-stone-400 dark:text-stone-500">
                        {_('settings.transformsCount', { count: list.length })}
                      </span>
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
                    </span>
                  </button>
                )}
                {!isCollapsed && (
                  <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                    {list.map((rule) => (
                      <TransformRow
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
          message={_('settings.transformsDeleteConfirm', { name: pendingDelete.name?.trim() || pendingDelete.pattern || _('library.unknown') })}
          confirmLabel={_('settings.confirmDeleteAction')}
          onConfirm={confirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}

      {form && (
        <Modal
          title={_(form.mode === 'create' ? 'settings.transformsNew' : 'settings.transformsEdit')}
          onClose={() => setForm(null)}
        >
          <TransformForm
            initial={form.mode === 'edit' ? form.rule : null}
            onDone={() => setForm(null)}
          />
        </Modal>
      )}
    </section>
  )
}

function TransformRow({ rule, editing, disabled, onToggle, onEdit, onDelete }: { rule: TextTransformRes; editing: boolean; disabled: boolean; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
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
            <span className={badge}>{_('settings.transformsRegex')}</span>
          </div>
        )}
      </div>
      {!editing && (
        <div className="flex shrink-0 items-center gap-1">
          <Toggle checked={rule.enabled} onChange={onToggle} disabled={disabled} ariaLabel={_('settings.transformsEnabled')} />
        </div>
      )}
      {editing && (
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={onEdit} disabled={disabled} aria-label={_('settings.transformsEditShort')} title={_('settings.transformsEditShort')} className={actionBtn}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={disabled}
            aria-label={_('settings.transformsDelete')}
            title={_('settings.transformsDelete')}
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
