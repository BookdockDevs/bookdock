import { useState } from 'react'

import type { TextTransformRes, TransformCreateReq, TransformUpdateReq } from '@bookdock/shared'

import { useCreateTransform, useUpdateTransform } from '@/api/hooks/useTransforms'
import { Button } from '@/components/ui/Button'
import Toggle from '@/components/ui/Toggle'
import { useTranslation } from '@/hooks/useTranslation'
import { useToastStore } from '@/stores/toast.store'
import { cn } from '@/lib/utils'

import type { SelectionInfo } from '../../reader/types'

interface TransformFormProps {
  /** Book context: unlocks the 本书规则 scope (and point creation from a selection) */
  bookId?: string
  /** Null = create mode. Point creation is available only when the anchors
   *  exist — from a fresh selection or an existing point patch. */
  initial?: TextTransformRes | null
  /** Create-from-selection: prefills the match field with the selected text */
  selection?: SelectionInfo
  onDone: () => void
}

type Scope = 'point' | 'book' | 'global'

type PatternError = 'required' | 'invalidRegex' | null

const SCOPES: { value: Scope; key: string }[] = [
  { value: 'point', key: 'annotation.replaceHereOnly' },
  { value: 'book', key: 'annotation.replaceBookMatches' },
  { value: 'global', key: 'annotation.replaceAllMatches' },
]

function initialScope(
  initial: TextTransformRes | null | undefined,
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

export default function TransformForm({ bookId, initial, selection, onDone }: TransformFormProps) {
  const _ = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const createTransform = useCreateTransform()
  const updateTransform = useUpdateTransform()

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
  const [caseSensitive, setCaseSensitive] = useState(initial?.caseSensitive ?? true)
  const [scope, setScope] = useState<Scope>(() => initialScope(initial, selection, pointAvailable, bookId))
  const [patternError, setPatternError] = useState<PatternError>(null)

  const saving = createTransform.isPending || updateTransform.isPending
  // Loose check: callers pass no `initial` prop for create mode (undefined)
  const editing = initial != null
  const isPoint = scope === 'point'
  const initialIsPoint = initial?.matchType === 'point'
  const initialIsBook = !!initial?.bookId
  // The scope segment is only meaningful when a non-global scope is reachable:
  // a book context (reader dialog), a selection (toolbar) or an existing point
  // patch. In the settings page (global-only) it would be three dead buttons.
  const showScope = !!bookId || !!selection || initial?.matchType === 'point'

  function onError(err: Error) {
    addToast(err.message, 'error')
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
            new RegExp(trimmed)
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
      const body: TransformUpdateReq = {
        name: name.trim() || null,
        group: group.trim() || null,
        replacement: replacement === '' ? null : replacement,
        caseSensitive,
      }
      if (isPoint) {
        body.originalText = trimmed
      } else {
        body.pattern = trimmed
        body.isRegex = isRegex
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
      updateTransform.mutate({ id: initial.id, body }, { onSuccess: onDone, onError })
    } else {
      const pointSnapshot = selection && trimmed === selectionText
        ? (selection.pointText?.trim() || trimmed)
        : trimmed
      const common = {
        replacement: replacement === '' ? null : replacement,
        caseSensitive,
        name: name.trim() || undefined,
        group: group.trim() || undefined,
      }
      const body: TransformCreateReq = scope === 'point'
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
          }
      createTransform.mutate(body, { onSuccess: onDone, onError })
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {showScope && (
        <div>
          <div className="mb-2 flex rounded-lg border border-stone-200 p-0.5 dark:border-stone-700">
            {SCOPES.map(({ value, key }) => (
              <button
                key={value}
                type="button"
                disabled={value === 'point' ? !pointAvailable : value === 'book' && !bookId}
                onClick={() => setScope(value)}
                className={cn(
                  'flex-1 rounded-md px-2 py-1.5 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                  scope === value
                    ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                    : 'text-stone-500 hover:text-stone-800 dark:hover:text-stone-200',
                )}
              >
                {_(key)}
              </button>
            ))}
          </div>
          {!pointAvailable && selection && (
            <p className="text-xs text-amber-600 dark:text-amber-400">{_('annotation.replaceHereUnavailable')}</p>
          )}
          {!bookId && (
            <p className="text-xs text-stone-400 dark:text-stone-500">{_('settings.transformsToBookHint')}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        <label className={cn('block min-w-0', scope !== 'global' && 'col-span-2')}>
          <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('settings.transformsName')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={_('settings.transformsNamePlaceholder')}
            className={inputClass}
          />
        </label>
        {/* 分组 is a grouping tool for GLOBAL rules only (the settings page
            groups by it); book-scoped rules and point patches never display it,
            so the field is hidden and the stored value is cleared. */}
        {scope === 'global' && (
          <label className="block min-w-0">
            <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('settings.transformsGroup')}</span>
            <input
              type="text"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
              placeholder={_('settings.transformsGroupPlaceholder')}
              className={inputClass}
            />
          </label>
        )}
      </div>

      <div className="min-w-0">
        <label className="block">
          <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">
            {_('settings.transformsPattern')}
            <span className="text-red-500"> *</span>
          </span>
          <textarea
            rows={2}
            value={pattern}
            onChange={(e) => {
              setPattern(e.target.value)
              setPatternError(null)
            }}
            className={textareaClass}
          />
        </label>
        {patternError === 'required' && (
          <p className="mt-1 text-xs text-red-500">{_('settings.transformsPatternRequired')}</p>
        )}
        {patternError === 'invalidRegex' && (
          <p className="mt-1 text-xs text-red-500">{_('settings.transformsRegexInvalid')}</p>
        )}
      </div>

      <div className="min-w-0">
        <label className="block">
          <span className="mb-1 block text-xs text-stone-400 dark:text-stone-500">{_('settings.transformsReplacement')}</span>
          <textarea
            rows={2}
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder={_('settings.transformsReplacementPlaceholder')}
            className={textareaClass}
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-x-6 gap-y-2">
        {!isPoint && (
          <Toggle label={_('settings.transformsRegex')} checked={isRegex} onChange={setIsRegex} />
        )}
        <Toggle label={_('settings.transformsCaseSensitive')} checked={caseSensitive} onChange={setCaseSensitive} />
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="secondary" size="sm" onClick={onDone} disabled={saving}>
          {_('library.cancel')}
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {_('library.save')}
        </Button>
      </div>
    </form>
  )
}

const inputClass = 'h-9 w-full rounded-lg border border-stone-200 bg-white px-2.5 text-sm text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500'

const textareaClass = 'w-full resize-none rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-sm leading-relaxed text-stone-700 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200 dark:focus:border-stone-500'
