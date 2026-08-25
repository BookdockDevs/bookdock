import { useMemo, useState } from 'react'

import type { TextTransformRes } from '@bookdock/shared'

import { useDeleteTransform, useTransforms, useUpdateTransform } from '@/api/hooks/useTransforms'
import ConfirmDialog from '@/components/ui/ConfirmDialog'
import Modal from '@/components/ui/Modal'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import { useToastStore } from '@/stores/toast.store'

import TransformForm from './TransformForm'

type FormState = { mode: 'create' } | { mode: 'edit'; rule: TextTransformRes } | null

export default function TransformsSettingsSection() {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const { data } = useTransforms()
  const updateTransform = useUpdateTransform()
  const deleteTransform = useDeleteTransform()
  // This section is the GLOBAL home: book-scoped rules and point patches are
  // managed per book in the reader dialog. Newest first, grouped by 分组.
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
    return [...named, ...(ungrouped.length ? [['', ungrouped] as const] : [])]
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

  function onToggle(rule: TextTransformRes) {
    updateTransform.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: (err) => addToast(err.message, 'error') },
    )
  }

  function confirmDelete() {
    if (!pendingDelete) return
    deleteTransform.mutate(pendingDelete.id, {
      onError: (err) => addToast(err.message, 'error'),
    })
    setPendingDelete(null)
  }

  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm dark:border-stone-800 dark:bg-stone-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="text-sm font-medium">{_('settings.transforms')}</h2>
          <p className="mt-0.5 text-xs text-stone-400 dark:text-stone-500">
            {_('settings.transformsCount', { count: rules.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setForm({ mode: 'create' })}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
          aria-label={_('settings.transformsNew')}
          title={_('settings.transformsNew')}
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-stone-400 dark:text-stone-500">{_('settings.transformsEmpty')}</p>
      ) : (
        <div className="divide-y divide-stone-100 dark:divide-stone-800">
          {groups.map(([key, list]) => {
            const isCollapsed = collapsed.has(key)
            return (
              <div key={key || '__ungrouped__'}>
                <button
                  type="button"
                  onClick={() => toggleGroup(key)}
                  aria-expanded={!isCollapsed}
                  className="flex w-full items-center justify-between gap-2 py-2 text-left"
                >
                  <span className="text-xs font-medium text-stone-500 dark:text-stone-400">
                    {key || _('settings.transformsUngrouped')}
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
                {!isCollapsed && (
                  <ul className="divide-y divide-stone-100 dark:divide-stone-800">
                    {list.map((rule) => (
                      <TransformRow
                        key={rule.id}
                        rule={rule}
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
          message={_('settings.transformsDeleteConfirm')}
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

function TransformRow({ rule, onToggle, onEdit, onDelete }: { rule: TextTransformRes; onToggle: () => void; onEdit: () => void; onDelete: () => void }) {
  const _ = useTranslation()
  // No arrow when the replacement is empty: a bare pattern means 净化 (the
  // match is removed), never a literal "delete" text.
  const replacementSummary = rule.replacement?.trim() ? `→ ${rule.replacement}` : ''
  const badge = 'rounded border border-stone-200 px-1.5 py-0.5 text-[11px] text-stone-500 dark:border-stone-700 dark:text-stone-400'
  const actionBtn =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        {rule.name && (
          <p className={cn('truncate text-sm', !rule.enabled && 'text-stone-400 dark:text-stone-500')}>{rule.name}</p>
        )}
        <p className={cn('truncate font-mono text-xs text-stone-400 dark:text-stone-500', rule.name && 'mt-0.5')}>
          {rule.pattern}{replacementSummary && ` ${replacementSummary}`}
        </p>
        {/* Only the regex badge stays: the settings page shows global rules
            only, where the toggle already carries the on/off state. */}
        {rule.isRegex && (
          <div className="mt-1 flex flex-wrap gap-1.5">
            <span className={badge}>{_('settings.transformsRegex')}</span>
          </div>
        )}
      </div>
      <Toggle checked={rule.enabled} onChange={onToggle} ariaLabel={_('settings.transformsEnabled')} />
      <button type="button" onClick={onEdit} aria-label={_('library.edit')} title={_('library.edit')} className={actionBtn}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
        </svg>
      </button>
      <button
        type="button"
        onClick={onDelete}
        aria-label={_('settings.fontsDelete')}
        title={_('settings.fontsDelete')}
        className={`${actionBtn} hover:bg-red-50 hover:text-red-600 dark:hover:bg-stone-800 dark:hover:text-red-400`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
          <path d="M10 11v6M14 11v6" />
        </svg>
      </button>
    </li>
  )
}
