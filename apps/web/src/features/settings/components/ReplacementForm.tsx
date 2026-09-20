import { useEffect, useMemo, useRef, useState } from 'react'

import { compileReplacementRegex, type TextReplacementRes, type ReplacementCreateReq, type ReplacementUpdateReq } from '@bookdock/shared'

import { useCreateReplacement, useReplacements, useUpdateReplacement } from '@/api/hooks/useReplacements'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import type { SelectionInfo } from '../../reader/types'
import SettingsFormActions from './SettingsFormActions'
import SettingsFormField from './SettingsFormField'
import { settingsFormClass, settingsInputClass, settingsTextareaClass } from './settingsForm'

interface ReplacementFormProps {
  /** Book context: unlocks the 本书规则 scope (and point creation from a selection) */
  bookId?: string
  /** Null = create mode. Point creation is available only when the anchors
   *  exist — from a fresh selection or an existing point patch. */
  initial?: TextReplacementRes | null
  /** Create-from-selection: prefills the match field with the selected text */
  selection?: SelectionInfo
  /** Existing groups for auto-suggestion dropdown in global scope */
  groups?: string[]
  onDone: () => void
}

type Scope = 'point' | 'book' | 'global'
type ApplyTo = 'content' | 'title' | 'both'

type PatternError = 'required' | 'invalidRegex' | null

const SCOPES: { value: Scope; key: string }[] = [
  { value: 'point', key: 'annotation.replaceHereOnly' },
  { value: 'book', key: 'annotation.replaceBookMatches' },
  { value: 'global', key: 'annotation.replaceAllMatches' },
]

const APPLY_TO: { value: ApplyTo; key: string }[] = [
  { value: 'content', key: 'settings.replacementsApplyToContent' },
  { value: 'title', key: 'settings.replacementsApplyToTitle' },
  { value: 'both', key: 'settings.replacementsApplyToBoth' },
]

function initialScope(
  initial: TextReplacementRes | null | undefined,
  selection: SelectionInfo | undefined,
  pointAvailable: boolean,
  bookId: string | undefined,
): Scope {
  if (selection) return pointAvailable ? 'point' : 'book'
  if (!initial) {
    // Create from the rules list: the reader dialog is per-book, so 本书规则
    // is the natural default; without a book context (settings manager) global
    return bookId ? 'book' : 'global'
  }
  if (initial.matchType === 'point') return 'point'
  return initial.bookId ? 'book' : 'global'
}

export default function ReplacementForm({ bookId, initial, selection, groups, onDone }: ReplacementFormProps) {
  const _ = useTranslation()
  const createReplacement = useCreateReplacement()
  const updateReplacement = useUpdateReplacement()
  const replacementsQuery = useReplacements()

  const existingGroups = useMemo(() => {
    if (groups) return groups
    const set = new Set<string>()
    for (const r of replacementsQuery?.data?.data ?? []) {
      const g = r.group?.trim()
      if (g) set.add(g)
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b))
  }, [groups, replacementsQuery?.data])

  const [groupDropdownOpen, setGroupDropdownOpen] = useState(false)
  const groupContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!groupDropdownOpen) return
    function handleClickOutside(event: MouseEvent) {
      if (groupContainerRef.current && !groupContainerRef.current.contains(event.target as Node)) {
        setGroupDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [groupDropdownOpen])

  const selectionText = selection ? (selection.rawText ?? selection.text).trim() : ''
  // Point patches need a section and a text offset. The snapshot can span
  // multiple text nodes; the renderer supplies the concatenated text for the
  // point matcher while the visible field keeps the user's original text.
  const pointAvailable = selection
    ? selection.startOffset !== undefined && !!selection.sectionHref && !!(selection.pointText ?? selection.text).trim()
    : initial?.matchType === 'point'

  const [name, setName] = useState(initial?.name ?? '')
  const [group, setGroup] = useState(initial?.group ?? '')
  // For pattern scopes this is the pattern; for point the snapshot (originalText)
  const [pattern, setPattern] = useState(selectionText || initial?.pattern || initial?.originalText || '')
  const [replacement, setReplacement] = useState(initial?.replacement ?? '')
  const [isRegex, setIsRegex] = useState(initial?.isRegex ?? false)
  const [applyTo, setApplyTo] = useState<ApplyTo>(initial?.applyTo ?? 'content')
  const [scope, setScope] = useState<Scope>(() => initialScope(initial, selection, pointAvailable, bookId))
  const [patternError, setPatternError] = useState<PatternError>(null)

  const filteredGroups = useMemo(() => {
    const q = group.trim().toLowerCase()
    if (!q) return existingGroups
    return existingGroups.filter((g) => g.toLowerCase().includes(q))
  }, [existingGroups, group])

  const saving = createReplacement.isPending || updateReplacement.isPending
  // Loose check: callers pass no `initial` prop for create mode (undefined)
  const editing = initial != null
  const isPoint = scope === 'point'
  const initialIsPoint = initial?.matchType === 'point'
  const initialIsBook = !!initial?.bookId
  // The scope segment is only meaningful when a non-global scope is reachable:
  // a book context (reader dialog), a selection (toolbar) or an existing point
  // patch. In the settings page (global-only) it would be three dead buttons.
  const showScope = !!bookId || !!selection || initial?.matchType === 'point'

  function onError(err: unknown) {
    notify.error(getUserErrorNotification(err, 'settings.replacementOperationFailed'))
  }

  function onSaved() {
    notify.success({ key: 'toast.replacementSaved' })
    onDone()
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const trimmed = pattern.trim()
    if (editing && isPoint) {
      if (!trimmed) {
        setPatternError('required')
        return
      }
    } else {
      const error = (() => {
        if (!trimmed) return 'required' as const
        if (isRegex) {
          try {
            compileReplacementRegex(trimmed)
          } catch {
            return 'invalidRegex' as const
          }
        }
        return null
      })()
      setPatternError(error)
      if (error) return
    }

    if (editing) {
      const body: ReplacementUpdateReq = {
        name: isPoint ? null : (name.trim() || null),
        group: isPoint || scope === 'book' ? null : (group.trim() || null),
        replacement: replacement === '' ? null : replacement,
      }
      if (isPoint) {
        body.originalText = trimmed
      } else {
        body.pattern = trimmed
        body.isRegex = isRegex
        body.applyTo = applyTo
        if (initialIsPoint) {
          // point → pattern: the snapshot becomes the pattern; anchors are
          // cleared server-side. Scope: keep the patch's book, or promote.
          body.matchType = 'pattern'
          if (scope === 'global') body.bookId = null
        } else if (scope === 'global' && initialIsBook) {
          body.bookId = null
        } else if (scope === 'book' && !initialIsBook) {
          body.bookId = bookId
        }
      }
      updateReplacement.mutate({ id: initial.id, body }, { onSuccess: onSaved, onError })
    } else {
      const pointSnapshot = selection && trimmed === selectionText
        ? (selection.pointText?.trim() || trimmed)
        : trimmed
      const common = {
        replacement: replacement === '' ? null : replacement,
        name: scope === 'point' ? undefined : (name.trim() || undefined),
        group: scope === 'global' ? (group.trim() || undefined) : undefined,
      }
      const body: ReplacementCreateReq = scope === 'point'
        ? {
            ...common,
            matchType: 'point',
            bookId: bookId!,
            spineHref: selection!.sectionHref!,
            textOffset: selection!.startOffset!,
            originalText: pointSnapshot,
          }
        : {
            ...common,
            matchType: 'pattern',
            ...(scope === 'book' ? { bookId } : {}),
            pattern: trimmed,
            isRegex,
            applyTo,
          }
      createReplacement.mutate(body, { onSuccess: onSaved, onError })
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className={settingsFormClass}>
      {showScope && (
        <div className="space-y-1.5">
          <div className="flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" role="group" aria-label={_('settings.fontsScope')}>
            {SCOPES.map(({ value, key }) => {
              const selected = scope === value
              const disabled = saving || (value === 'point' ? !pointAvailable : value === 'book' && !bookId)
              return (
                <button
                  key={value}
                  type="button"
                  disabled={disabled}
                  onClick={() => setScope(value)}
                  aria-pressed={selected}
                  className={cn(
                    'flex h-9 flex-1 items-center justify-center rounded-lg px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                    selected
                      ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                      : 'text-stone-500 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100',
                  )}
                >
                  {_(key)}
                </button>
              )
            })}
          </div>
          {!pointAvailable && selection && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{_('annotation.replaceHereUnavailable')}</p>
          )}
          {!bookId && (
            <p className="text-xs text-stone-400 dark:text-stone-500">{_('settings.replacementsToBookHint')}</p>
          )}
        </div>
      )}

      {scope !== 'point' && (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          <SettingsFormField label={_('settings.replacementsName')} className={scope !== 'global' ? 'sm:col-span-2' : undefined}>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={saving}
              className={settingsInputClass}
            />
          </SettingsFormField>
          {/* 分组 is a grouping tool for GLOBAL rules only (the settings page
              groups by it); book-scoped rules and point patches never display it,
              so the field is hidden and the stored value is cleared. */}
          {scope === 'global' && (
          <SettingsFormField label={_('settings.replacementsGroup')}>
            <div ref={groupContainerRef} className="relative">
              <input
                type="text"
                value={group}
                onChange={(e) => {
                  setGroup(e.target.value)
                  setGroupDropdownOpen(true)
                }}
                onFocus={() => {
                  if (existingGroups.length > 0) setGroupDropdownOpen(true)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setGroupDropdownOpen(false)
                  }
                }}
                disabled={saving}
                className={cn(settingsInputClass, existingGroups.length > 0 && 'pr-8')}
              />
              {existingGroups.length > 0 && (
                <button
                  type="button"
                  tabIndex={-1}
                  disabled={saving}
                  onClick={() => setGroupDropdownOpen((v) => !v)}
                  aria-label={_('settings.replacementsGroup')}
                  className="absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-stone-400 hover:text-stone-600 dark:text-stone-500 dark:hover:text-stone-300"
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className={cn('transition-transform', groupDropdownOpen && 'rotate-180')}
                  >
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
              )}

              {groupDropdownOpen && filteredGroups.length > 0 && (
                <div
                  role="listbox"
                  className="absolute top-full z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-800"
                >
                  {filteredGroups.map((g) => {
                    const isSelected = g === group.trim()
                    return (
                      <button
                        key={g}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        onClick={() => {
                          setGroup(g)
                          setGroupDropdownOpen(false)
                        }}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs font-medium transition-colors',
                          isSelected
                            ? 'bg-stone-100 text-stone-900 dark:bg-stone-700 dark:text-stone-100'
                            : 'text-stone-600 hover:bg-stone-50 hover:text-stone-900 dark:text-stone-300 dark:hover:bg-stone-700/50 dark:hover:text-stone-100',
                        )}
                      >
                        <span className="truncate">{g}</span>
                        {isSelected && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="shrink-0 text-stone-900 dark:text-stone-100"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </SettingsFormField>
        )}
      </div>
      )}

      <div className="min-w-0">
        <SettingsFormField
          label={_('settings.replacementsPattern')}
          required
          error={patternError === 'required' ? _('settings.replacementsPatternRequired') : patternError === 'invalidRegex' ? _('settings.replacementsRegexInvalid') : undefined}
        >
          <textarea
            rows={2}
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value)
              setPatternError(null)
            }}
            disabled={saving}
            aria-invalid={patternError !== null || undefined}
            className={settingsTextareaClass}
          />
        </SettingsFormField>
      </div>

      <div className="min-w-0">
        <SettingsFormField label={_('settings.replacementsReplacement')}>
          <textarea
            rows={2}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={_('settings.replacementsReplacementPlaceholder')}
            disabled={saving}
            className={settingsTextareaClass}
          />
        </SettingsFormField>
      </div>

      {!isPoint && (
        <div className="space-y-3 rounded-xl border border-stone-200/80 bg-stone-50/60 p-3.5 dark:border-stone-800 dark:bg-stone-800/40">
          <div className="space-y-1.5">
            <span className="block text-xs font-medium text-stone-500 dark:text-stone-400">
              {_('settings.replacementsApplyTo')}
            </span>
            <div className="flex rounded-xl bg-stone-200/60 p-1 dark:bg-stone-900/60" role="group" aria-label={_('settings.replacementsApplyTo')}>
              {APPLY_TO.map(({ value, key }) => {
                const selected = applyTo === value
                return (
                  <button
                    key={value}
                    type="button"
                    disabled={saving}
                    onClick={() => setApplyTo(value)}
                    aria-pressed={selected}
                    className={cn(
                      'flex h-8 flex-1 items-center justify-center rounded-lg px-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                      selected
                        ? 'bg-white text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                        : 'text-stone-500 hover:bg-stone-200 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-stone-700 dark:hover:text-stone-100',
                    )}
                  >
                    {_(key)}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="flex flex-col gap-1 pt-0.5">
            <Toggle
              label={_('settings.replacementsRegex')}
              checked={isRegex}
              onChange={setIsRegex}
              disabled={saving}
            />
            {isRegex && (
              <p className="text-xs text-stone-400 dark:text-stone-500">
                {_('settings.replacementsRegexHint')}
              </p>
            )}
          </div>
        </div>
      )}

      <SettingsFormActions onCancel={onDone} cancelDisabled={saving} saveDisabled={saving} />
    </form>
  )
}
