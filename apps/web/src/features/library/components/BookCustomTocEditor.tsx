import { useEffect, useMemo, useRef, useState } from 'react'

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'

import type { TocPreviewChapter, TocPreviewReq, TocRulePattern } from '@bookdock/shared'

import { apiPost } from '@/api/client'
import { useReToc, useTocPreview, useTocRules } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import TocPatternRow, { type TocPatternError } from '@/features/settings/components/TocPatternRow'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

interface BookCustomTocEditorProps {
  bookId: string
  initialPatterns?: TocRulePattern[] | null
  onClose: () => void
  onSaved: () => void
}

interface PatternDraft {
  id: string
  regex: string
  replacement: string
  enabled: boolean
}

function toDrafts(patterns: TocRulePattern[]): PatternDraft[] {
  return patterns.map((p, index) => ({
    id: `custom-pat-${index}-${Date.now()}`,
    regex: p.regex,
    replacement: p.replacement ?? '',
    enabled: p.enabled !== false,
  }))
}

export default function BookCustomTocEditor({
  bookId,
  initialPatterns,
  onClose,
  onSaved,
}: BookCustomTocEditorProps) {
  const _ = useTranslation()
  const rulesQuery = useTocRules()
  const globalRules = rulesQuery.data?.data ?? []
  const reToc = useReToc(bookId)

  const defaultPatterns = initialPatterns && initialPatterns.length > 0
    ? initialPatterns
    : [{ level: 1, regex: '', replacement: '', enabled: true }]

  const [drafts, setDrafts] = useState<PatternDraft[]>(() => toDrafts(defaultPatterns))
  const nextPatternId = useRef(drafts.length)
  const patternInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [errors, setErrors] = useState<TocPatternError[]>(drafts.map(() => null))

  // Manual test trigger payload (Option A)
  const [testPayload, setTestPayload] = useState<TocPreviewReq | null>(() => {
    if (initialPatterns && initialPatterns.length > 0) {
      return { customPatterns: initialPatterns, limit: 1000, offset: 0 }
    }
    return null
  })

  const previewQuery = useTocPreview(bookId, testPayload ?? {}, { enabled: Boolean(testPayload) })
  const preview = previewQuery.data?.data

  const [extraChapters, setExtraChapters] = useState<TocPreviewChapter[]>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  const allChapters = useMemo(() => {
    if (!preview) return []
    return [...preview.chapters, ...extraChapters]
  }, [preview, extraChapters])

  const handleLoadMore = async () => {
    if (!preview || !testPayload || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await apiPost<{ data: { chapters: TocPreviewChapter[] } }>(`/books/${bookId}/toc-preview`, {
        ...testPayload,
        offset: allChapters.length,
        limit: 1000,
      })
      if (res?.data?.chapters?.length) {
        setExtraChapters((prev) => [...prev, ...res.data.chapters])
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingMore(false)
    }
  }

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))
  const saving = reToc.isPending

  function setDraft(index: number, patch: Partial<Pick<PatternDraft, 'regex' | 'replacement'>>) {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, ...patch } : d)))
    if (patch.regex !== undefined) {
      setErrors((prev) => prev.map((e, i) => (i === index ? null : e)))
    }
  }

  function addPattern() {
    const id = `custom-pat-${nextPatternId.current++}-${Date.now()}`
    setDrafts((prev) => [...prev, { id, regex: '', replacement: '', enabled: true }])
    setErrors((prev) => [...prev, null])
  }

  function removePattern(index: number) {
    if (drafts.length <= 1) return
    setDrafts((prev) => prev.filter((_, i) => i !== index))
    setErrors((prev) => prev.filter((_, i) => i !== index))
  }

  function onDragEnd({ active, over }: DragEndEvent) {
    if (saving || !over || active.id === over.id) return
    const oldIndex = drafts.findIndex((draft) => draft.id === active.id)
    const newIndex = drafts.findIndex((draft) => draft.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setDrafts((current) => arrayMove(current, oldIndex, newIndex))
    setErrors((current) => arrayMove(current, oldIndex, newIndex))
  }

  function validatePatterns(): TocRulePattern[] | null {
    const newErrors = drafts.map((d) => {
      const trimmed = d.regex.trim()
      if (!trimmed) return 'required' as const
      try {
        new RegExp(trimmed)
      } catch {
        return 'invalidRegex' as const
      }
      return null
    })
    setErrors(newErrors)
    const firstErrIndex = newErrors.findIndex((e) => e !== null)
    if (firstErrIndex >= 0) {
      patternInputRefs.current[drafts[firstErrIndex]?.id ?? '']?.focus()
      return null
    }
    return drafts.map((d, index) => ({
      level: index + 1,
      regex: d.regex.trim(),
      replacement: d.replacement === '' ? null : d.replacement,
      enabled: d.enabled,
    }))
  }

  function handleTestMatch() {
    const validated = validatePatterns()
    if (!validated) return
    setExtraChapters([])
    setTestPayload({ customPatterns: validated, limit: 1000, offset: 0 })
  }

  function handleCopyFromTemplate(ruleId: string) {
    if (!ruleId) return
    const found = globalRules.find((r) => r.id === ruleId)
    if (found && found.patterns.length > 0) {
      setDrafts(toDrafts(found.patterns))
      setErrors(found.patterns.map(() => null))
    }
  }

  function handleSaveAndApply() {
    const validated = validatePatterns()
    if (!validated) return
    reToc.mutate(
      { customPatterns: validated },
      {
        onSuccess: () => {
          notify.success({ key: 'library.tocRulePinSuccess' })
          onSaved()
          onClose()
        },
        onError: (err) => {
          notify.error(getUserErrorNotification(err, 'library.tocRulePinFailed'))
        },
      },
    )
  }

  const handleTestMatchRef = useRef(handleTestMatch)
  handleTestMatchRef.current = handleTestMatch

  // Keyboard shortcut Ctrl+Enter or Cmd+Enter to test match
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        handleTestMatchRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const title = initialPatterns && initialPatterns.length > 0
    ? _('library.tocRuleCustomEdit')
    : _('library.tocRuleCustomNew')

  return (
    <Modal title={title} onClose={onClose} size="wide">
      <div className="flex flex-col gap-5">
        {/* Template copy selector */}
        {globalRules.length > 0 && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3.5 py-2.5 dark:bg-stone-800/60">
            <span className="text-xs text-stone-600 dark:text-stone-300">
              {_('library.tocRuleCopyTemplate')}
            </span>
            <select
              defaultValue=""
              onChange={(e) => {
                handleCopyFromTemplate(e.target.value)
                e.target.value = ''
              }}
              disabled={saving}
              className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700 outline-none transition-colors hover:border-stone-300 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
            >
              <option value="" disabled>
                {_('library.tocRuleCopyTemplate')}
              </option>
              {globalRules.map((rule) => (
                <option key={rule.id} value={rule.id}>
                  {rule.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Pattern list */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-stone-700 dark:text-stone-200">
              {_('settings.tocRulesLevels')}
            </span>
            <button
              type="button"
              onClick={addPattern}
              disabled={saving}
              aria-label={_('settings.tocRulesAddPattern')}
              title={_('settings.tocRulesAddPattern')}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-stone-800 dark:hover:text-stone-200"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>

          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={drafts.map((d) => d.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-2">
                {drafts.map((draft, index) => (
                  <TocPatternRow
                    key={draft.id}
                    id={draft.id}
                    level={index + 1}
                    regex={draft.regex}
                    replacement={draft.replacement}
                    error={errors[index] ?? null}
                    disabled={saving}
                    canRemove={drafts.length > 1}
                    inputRef={(element) => {
                      patternInputRefs.current[draft.id] = element
                    }}
                    onChange={(patch) => setDraft(index, patch)}
                    onRemove={() => removePattern(index)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        </div>

        {/* Action button to test match manually (Option A) */}
        <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3 dark:border-stone-800">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleTestMatch}
            disabled={previewQuery.isFetching || saving}
            className="flex items-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
            <span>{previewQuery.isFetching ? _('library.tocRuleTesting') : _('library.tocRuleTestMatch')}</span>
          </Button>

          {preview && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-medium text-stone-700 dark:text-stone-200">
                {_('library.tocRulePreviewChapters', { count: preview.totalChapters })}
              </span>
              {Object.entries(preview.levelCounts).map(([lvl, count]) => (
                <span
                  key={lvl}
                  className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] text-stone-600 dark:bg-stone-800 dark:text-stone-300"
                >
                  L{lvl}: {count}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Preview feedback box */}
        {previewQuery.isFetching && !preview && (
          <div className="flex items-center justify-center rounded-xl border border-stone-200 p-8 text-xs text-stone-400 dark:border-stone-800">
            {_('library.tocRulePreviewLoading')}
          </div>
        )}

        {preview && (
          <div className="flex flex-col gap-2 rounded-xl border border-stone-200 bg-stone-50/50 p-3.5 dark:border-stone-800 dark:bg-stone-900/50">
            {preview.fallback && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                ⚠️ {_('library.tocRulePreviewFallbackWarning')}
              </div>
            )}

            <div className="max-h-[55vh] overflow-y-auto custom-scrollbar">
              {allChapters.length === 0 ? (
                <p className="py-4 text-center text-xs text-stone-400">{_('library.tocRulePreviewEmpty')}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-xs">
                  {allChapters.map((ch, idx) => (
                    <li
                      key={idx}
                      className={cn(
                        'flex items-center justify-between rounded px-2 py-1 text-stone-700 dark:text-stone-300',
                        ch.level > 1 && 'pl-5 text-stone-600 dark:text-stone-400',
                        ch.level > 2 && 'pl-9 text-stone-500 dark:text-stone-500',
                      )}
                    >
                      <span className="truncate pr-2">{ch.title}</span>
                      <span className="shrink-0 text-[11px] text-stone-400">
                        {ch.wordCount >= 1000
                          ? _('library.tocRuleWordsK', { count: (ch.wordCount / 1000).toFixed(1) })
                          : _('library.tocRuleWords', { count: ch.wordCount })}
                      </span>
                    </li>
                      ))}
                </ul>
              )}
              {preview.matchedTotalChapters > allChapters.length && (
                <div className="border-t border-stone-200 pt-2 text-center dark:border-stone-800">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={isLoadingMore}
                    className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 text-xs text-stone-600 transition-colors hover:bg-stone-50 disabled:opacity-50 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-300 dark:hover:bg-stone-700"
                  >
                    {isLoadingMore
                      ? _('library.tocRulePreviewLoading')
                      : _('library.tocRulePreviewLoadMore', {
                          current: allChapters.length,
                          total: preview.matchedTotalChapters,
                        })}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer actions */}
        <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {_('library.cancel')}
          </Button>
          <Button onClick={handleSaveAndApply} disabled={saving}>
            {saving ? `${_('library.tocRuleApplying')}` : _('library.tocRuleSaveAndApply')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
