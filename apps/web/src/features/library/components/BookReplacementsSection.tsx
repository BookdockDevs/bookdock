import type { TextReplacementRes } from '@bookdock/shared'

import { useBookReplacements, useSetReplacementOverride, useUpdateReplacement } from '@/api/hooks/useReplacements'
import QueryErrorState from '@/components/ui/QueryErrorState'
import SettingsEmptyState from '@/components/ui/SettingsEmptyState'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import { nextOverrideValue } from '../replacement-overrides'

interface BookReplacementsSectionProps {
  bookId: string
  /** Per-rule match counts ("N 处"), computed per book by the reader renderer */
  counts?: Record<string, number>
  /** This book's point patches, merged into one list */
  points?: TextReplacementRes[]
  /** spineHref → chapter label (from the reader's TOC) */
  chapterOf?: (href: string | null) => string | null
  /** Point patches that failed to apply, marked with a red 失效 badge */
  invalidIds?: string[]
  /** When provided, pattern rows get edit/delete buttons (reader dialog) */
  onEdit?: (rule: TextReplacementRes) => void
  onDelete?: (rule: TextReplacementRes) => void
}

export default function BookReplacementsSection({
  bookId,
  counts,
  points,
  chapterOf,
  invalidIds,
  onEdit,
  onDelete,
}: BookReplacementsSectionProps) {
  const _ = useTranslation()
  const replacementsQuery = useBookReplacements(bookId)
  const { data } = replacementsQuery
  const setOverride = useSetReplacementOverride()
  const updateReplacement = useUpdateReplacement()

  // Global pattern rules take their per-book state from overrides; rules
  // already scoped to this book toggle their own enabled switch instead.
  // Groups are ordered newest-first (stable — the user looks for recent edits).
  const byNewest = (a: TextReplacementRes, b: TextReplacementRes) => b.createdAt - a.createdAt
  const globalRules = (data?.data ?? [])
    .filter((r) => r.matchType === 'pattern' && r.bookId === null)
    .sort(byNewest)
  const bookRules = (data?.data ?? [])
    .filter((r) => r.matchType === 'pattern' && r.bookId === bookId)
    .sort(byNewest)
  const rows = [...bookRules, ...globalRules, ...(points ?? [])]

  function onGlobalToggle(rule: TextReplacementRes) {
    setOverride.mutate(
      { replacementId: rule.id, body: { bookId, enabled: nextOverrideValue(rule) } },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'errors.updateFailed')) },
    )
  }

  function onBookRuleToggle(rule: TextReplacementRes) {
    updateReplacement.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'errors.updateFailed')) },
    )
  }

  function onPointToggle(rule: TextReplacementRes) {
    updateReplacement.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'errors.updateFailed')) },
    )
  }

  return (
    <section>
      {replacementsQuery.isError ? (
        <QueryErrorState isRetrying={replacementsQuery.isFetching} onRetry={replacementsQuery.refetch} />
      ) : rows.length === 0 ? (
        <SettingsEmptyState>{_('reader.replacementsEmptyCreate')}</SettingsEmptyState>
      ) : (
        <ul className="divide-y divide-stone-100 dark:divide-stone-800">
          {rows.map((rule) =>
            rule.matchType === 'point' ? (
              <PointRow
                key={rule.id}
                patch={rule}
                invalid={!!invalidIds?.includes(rule.id)}
                chapter={chapterOf?.(rule.spineHref) ?? null}
                onToggle={() => onPointToggle(rule)}
                onEdit={onEdit ? () => onEdit(rule) : undefined}
                onDelete={onDelete ? () => onDelete(rule) : undefined}
              />
            ) : rule.bookId === bookId ? (
              <BookScopedRow
                key={rule.id}
                rule={rule}
                count={counts?.[rule.id]}
                onToggle={() => onBookRuleToggle(rule)}
                onEdit={onEdit ? () => onEdit(rule) : undefined}
                onDelete={onDelete ? () => onDelete(rule) : undefined}
              />
            ) : (
              <BookReplacementRow
                key={rule.id}
                rule={rule}
                count={counts?.[rule.id]}
                onToggle={() => onGlobalToggle(rule)}
                onEdit={onEdit ? () => onEdit(rule) : undefined}
                onDelete={onDelete ? () => onDelete(rule) : undefined}
              />
            ),
          )}
        </ul>
      )}
    </section>
  )
}

// A rule created from "本书所有匹配处": already bound to this book, so the
// switch edits the rule itself (no override layer).
function BookScopedRow({
  rule,
  count,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: TextReplacementRes
  count?: number
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const _ = useTranslation()
  const effective = rule.effectiveEnabled ?? rule.enabled
  // No arrow when the replacement is empty: a bare pattern means 净化 (the
  // match is removed), never a literal "delete" text.
  const replacementSummary = rule.replacement?.trim() ? `→ ${rule.replacement}` : ''

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        {rule.name && (
          <p className={cn('truncate text-sm', !effective && 'text-stone-400 dark:text-stone-500')}>{rule.name}</p>
        )}
        <p className={cn('truncate font-mono text-xs text-stone-400 dark:text-stone-500', rule.name && 'mt-0.5')}>
          {rule.pattern}{replacementSummary && ` ${replacementSummary}`}
        </p>
      </div>
      {count !== undefined && <MatchCountBadge count={count} />}
      <StatusBadge effective={effective} bookScoped />
      <Toggle checked={effective} onChange={onToggle} ariaLabel={_('library.replacementsToggle')} />
      <RowActions onEdit={onEdit} onDelete={onDelete} />
    </li>
  )
}

function BookReplacementRow({
  rule,
  count,
  onToggle,
  onEdit,
  onDelete,
}: {
  rule: TextReplacementRes
  count?: number
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const _ = useTranslation()
  const effective = rule.effectiveEnabled ?? rule.enabled
  const override = !!rule.hasOverride
  // No arrow when the replacement is empty: a bare pattern means 净化 (the
  // match is removed), never a literal "delete" text.
  const replacementSummary = rule.replacement?.trim() ? `→ ${rule.replacement}` : ''

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        {rule.name && (
          <p className={cn('truncate text-sm', !effective && 'text-stone-400 dark:text-stone-500')}>{rule.name}</p>
        )}
        <p className={cn('truncate font-mono text-xs text-stone-400 dark:text-stone-500', rule.name && 'mt-0.5')}>
          {rule.pattern}{replacementSummary && ` ${replacementSummary}`}
        </p>
      </div>
      {count !== undefined && <MatchCountBadge count={count} />}
      <StatusBadge effective={effective} override={override} />
      <Toggle checked={effective} onChange={onToggle} ariaLabel={_('library.replacementsToggle')} />
      <RowActions onEdit={onEdit} onDelete={onDelete} />
    </li>
  )
}

// Point patch (P2): a single spot anchored in one chapter. The snapshot is the
// row's identity — it appears once, prefixed by its chapter; a name (when set)
// becomes the title above it.
function PointRow({
  patch,
  invalid,
  chapter,
  onToggle,
  onEdit,
  onDelete,
}: {
  patch: TextReplacementRes
  invalid: boolean
  chapter: string | null
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const _ = useTranslation()
  const snapshot = patch.originalText ?? ''
  // No arrow when the replacement is empty: a bare snapshot means 净化 (the
  // text is removed), never a literal "delete" text.
  const replacement = patch.replacement?.trim() ?? ''
  const prefix = [chapter, snapshot].filter(Boolean).join(' · ')

  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        {patch.name && (
          <p className={cn('truncate text-sm', (!patch.enabled || invalid) && 'text-stone-400 dark:text-stone-500')}>
            {patch.name}
          </p>
        )}
        <p className="mt-0.5 truncate font-mono text-xs text-stone-400 dark:text-stone-500">
          {prefix}
          {replacement && (
            <>
              <span className="text-stone-300 dark:text-stone-600"> → </span>
              {replacement}
            </>
          )}
        </p>
      </div>
      {invalid && (
        <span className="shrink-0 rounded border border-red-300 px-1.5 py-0.5 text-[11px] text-red-500 dark:border-red-800 dark:text-red-400">
          {_('reader.replacementsInvalidBadge')}
        </span>
      )}
      <Toggle checked={patch.enabled} onChange={onToggle} ariaLabel={_('settings.replacementsEnabled')} />
      <RowActions onEdit={onEdit} onDelete={onDelete} />
    </li>
  )
}

// Effective-state badge for this book: the global rule follows its global
// default or a per-book override; book-scoped rules just show their state.
function StatusBadge({ effective, override, bookScoped }: { effective: boolean; override?: boolean; bookScoped?: boolean }) {
  const _ = useTranslation()
  const key = bookScoped
    ? 'settings.replacementsBookRule'
    : override
      ? effective ? 'library.replacementsOverrideOn' : 'library.replacementsOverrideOff'
      : effective ? 'library.replacementsFollowGlobalOn' : 'library.replacementsFollowGlobalOff'
  return (
    <span
      className={cn(
        'shrink-0 rounded border px-1.5 py-0.5 text-[11px]',
        effective
          ? 'border-stone-200 text-stone-500 dark:border-stone-700 dark:text-stone-400'
          : 'border-stone-200 text-stone-400 dark:border-stone-700 dark:text-stone-500',
      )}
    >
      {_(key)}
    </span>
  )
}

function MatchCountBadge({ count }: { count: number }) {
  const _ = useTranslation()
  return (
    <span className="shrink-0 text-[11px] tabular-nums text-stone-400 dark:text-stone-500">
      {_('reader.replacementsMatches', { count })}
    </span>
  )
}

// Edit/delete sit next to the toggle — always visible (hover-reveal left
// invisible buttons occupying row space, which read as stray gaps).
function RowActions({ onEdit, onDelete }: { onEdit?: () => void; onDelete?: () => void }) {
  const _ = useTranslation()
  const actionBtn =
    'flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200'
  return (
    <>
      {onEdit && (
        <button
          type="button"
          onClick={onEdit}
          aria-label={_('library.edit')}
          title={_('library.edit')}
          className={actionBtn}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
          </svg>
        </button>
      )}
      {onDelete && (
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
      )}
    </>
  )
}
