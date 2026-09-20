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
  /** Jump to the anchored position when chapter is clicked in a point patch */
  onJump?: (spineHref: string, textOffset?: number | null, replacement?: string | null) => void
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
  onJump,
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
      { onError: (err) => notify.error(getUserErrorNotification(err, 'library.replacementUpdateFailed')) },
    )
  }

  function onBookRuleToggle(rule: TextReplacementRes) {
    updateReplacement.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'library.replacementUpdateFailed')) },
    )
  }

  function onPointToggle(rule: TextReplacementRes) {
    updateReplacement.mutate(
      { id: rule.id, body: { enabled: !rule.enabled } },
      { onError: (err) => notify.error(getUserErrorNotification(err, 'library.replacementUpdateFailed')) },
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
                onJump={onJump}
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
  const replacement = rule.replacement?.trim() ?? ''

  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/40',
        !effective && 'opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        {rule.name ? (
          <>
            <p
              className={cn(
                'truncate text-sm font-medium',
                !effective ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-200',
              )}
            >
              {rule.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-stone-400 dark:text-stone-500">
              <span className={cn(!replacement && 'line-through')}>{rule.pattern}</span>
              {replacement && (
                <>
                  <span> → </span>
                  <span className={cn(effective && 'text-emerald-600 dark:text-emerald-400')}>{replacement}</span>
                </>
              )}
            </p>
          </>
        ) : (
          <p
            className={cn(
              'truncate font-mono text-sm font-medium',
              !effective ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-200',
            )}
          >
            <span className={cn(!replacement && 'line-through')}>{rule.pattern}</span>
            {replacement && (
              <>
                <span className="font-normal text-stone-400 dark:text-stone-500"> → </span>
                <span className={cn(effective ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500')}>
                  {replacement}
                </span>
              </>
            )}
          </p>
        )}
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
  const replacement = rule.replacement?.trim() ?? ''

  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/40',
        !effective && 'opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        {rule.name ? (
          <>
            <p
              className={cn(
                'truncate text-sm font-medium',
                !effective ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-200',
              )}
            >
              {rule.name}
            </p>
            <p className="mt-0.5 truncate font-mono text-xs text-stone-400 dark:text-stone-500">
              <span className={cn(!replacement && 'line-through')}>{rule.pattern}</span>
              {replacement && (
                <>
                  <span> → </span>
                  <span className={cn(effective && 'text-emerald-600 dark:text-emerald-400')}>{replacement}</span>
                </>
              )}
            </p>
          </>
        ) : (
          <p
            className={cn(
              'truncate font-mono text-sm font-medium',
              !effective ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-200',
            )}
          >
            <span className={cn(!replacement && 'line-through')}>{rule.pattern}</span>
            {replacement && (
              <>
                <span className="font-normal text-stone-400 dark:text-stone-500"> → </span>
                <span className={cn(effective ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500')}>
                  {replacement}
                </span>
              </>
            )}
          </p>
        )}
      </div>
      {count !== undefined && <MatchCountBadge count={count} />}
      <StatusBadge effective={effective} override={override} />
      <Toggle checked={effective} onChange={onToggle} ariaLabel={_('library.replacementsToggle')} />
      <RowActions onEdit={onEdit} onDelete={onDelete} />
    </li>
  )
}

// Point patch (P2): a single spot anchored in one chapter. Point patches
// do not require naming — the original snapshot and replacement form the row's
// primary content, with chapter navigation below.
function PointRow({
  patch,
  invalid,
  chapter,
  onJump,
  onToggle,
  onEdit,
  onDelete,
}: {
  patch: TextReplacementRes
  invalid: boolean
  chapter: string | null
  onJump?: (spineHref: string, textOffset?: number | null, replacement?: string | null) => void
  onToggle: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  const _ = useTranslation()
  const snapshot = patch.originalText ?? ''
  // No arrow when the replacement is empty: a bare snapshot with strikethrough
  // signifies deletion of the text, never a literal "delete" badge.
  const replacement = patch.replacement?.trim() ?? ''
  const effective = patch.enabled && !invalid

  return (
    <li
      className={cn(
        'group flex items-center gap-3 rounded-xl p-2.5 transition-colors hover:bg-stone-50 dark:hover:bg-stone-800/40',
        !effective && 'opacity-60',
      )}
    >
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            !effective ? 'text-stone-400 dark:text-stone-500' : 'text-stone-800 dark:text-stone-200',
          )}
        >
          <span className={cn(!replacement && 'line-through')}>{snapshot}</span>
          {replacement && (
            <>
              <span className="font-normal text-stone-400 dark:text-stone-500"> → </span>
              <span className={cn(effective ? 'text-emerald-600 dark:text-emerald-400' : 'text-stone-400 dark:text-stone-500')}>
                {replacement}
              </span>
            </>
          )}
        </p>
        {chapter && (
          <div className="mt-1 flex items-center gap-1.5">
            {onJump && patch.spineHref ? (
              <button
                type="button"
                onClick={() => onJump(patch.spineHref!, patch.textOffset, patch.replacement)}
                className="inline-flex max-w-full items-center rounded-full border border-stone-200/80 bg-stone-100/70 px-2 py-0.5 text-[11px] text-stone-500 transition-colors hover:border-stone-300 hover:bg-stone-200/70 dark:border-stone-700/80 dark:bg-stone-800/60 dark:text-stone-400 dark:hover:border-stone-600 dark:hover:bg-stone-800"
              >
                <span className="truncate">{chapter}</span>
              </button>
            ) : (
              <span className="inline-flex max-w-full items-center rounded-full border border-stone-200/80 bg-stone-100/70 px-2 py-0.5 text-[11px] text-stone-500 dark:border-stone-700/80 dark:bg-stone-800/60 dark:text-stone-400 truncate">
                {chapter}
              </span>
            )}
          </div>
        )}
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
