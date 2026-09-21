import { useEffect, useMemo, useState } from 'react'

import type { Chapter, TocPreviewChapter, TocPreviewReq, TocPreviewRes, TocRulePattern } from '@bookdock/shared'

import { apiPost } from '@/api/client'
import { useReToc, useTocPreview, useTocRules } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import QueryErrorState from '@/components/ui/QueryErrorState'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

import BookCustomTocEditor from './BookCustomTocEditor'

interface TocRulePickerProps {
  bookId: string
  /** Currently pinned/auto-scored rule id from the book meta */
  currentRuleId?: string
  /** True when the id was chosen by auto-scoring rather than pinned */
  autoScored?: boolean
  /** Book-specific TOC patterns when present */
  customPatterns?: TocRulePattern[]
  /** Persisted per-book suppressed chapter boundary ids */
  excludedChapterIds?: string[]
  /** Persisted chapter levels, used to allow repairing an existing book. */
  currentChapters?: Array<Pick<Chapter, 'level'> & Partial<Pick<Chapter, 'id' | 'title' | 'wordCount'>>>
  onClose: () => void
}

export default function TocRulePicker({
  bookId,
  currentRuleId,
  autoScored,
  customPatterns,
  excludedChapterIds,
  currentChapters,
  onClose,
}: TocRulePickerProps) {
  const _ = useTranslation()
  const rulesQuery = useTocRules()
  const rules = useMemo(() => rulesQuery.data?.data ?? [], [rulesQuery.data?.data])
  const reToc = useReToc(bookId)

  const [customEditorOpen, setCustomEditorOpen] = useState(false)

  // Active target currently saved on the book
  const activeTarget: 'auto' | 'custom' | string = useMemo(() => {
    if (customPatterns && customPatterns.length > 0 && currentRuleId === 'custom') {
      return 'custom'
    }
    if (currentRuleId && rules.some((r) => r.id === currentRuleId)) {
      return currentRuleId
    }
    return 'auto'
  }, [currentRuleId, customPatterns, rules])

  // Selected target for previewing
  const [selectedTarget, setSelectedTarget] = useState<'auto' | 'custom' | string>(activeTarget)
  const [selectionReadyTarget, setSelectionReadyTarget] = useState<'auto' | 'custom' | string>(activeTarget)
  const [selectedExcludedIds, setSelectedExcludedIds] = useState<string[]>(() => excludedChapterIds ?? [])
  const activeExcludedIds = excludedChapterIds ?? []

  useEffect(() => {
    setSelectedTarget(activeTarget)
    setSelectionReadyTarget(activeTarget)
  }, [activeTarget])

  // Derive preview request from selected target
  const previewReq = useMemo<TocPreviewReq>(() => {
    const previewExcludedIds = selectedTarget === activeTarget ? (excludedChapterIds ?? []) : []
    if (selectedTarget === 'auto') return { tocRuleId: null, excludedChapterIds: previewExcludedIds, limit: 1000, offset: 0 }
    if (selectedTarget === 'custom') return { customPatterns, excludedChapterIds: previewExcludedIds, limit: 1000, offset: 0 }
    return { tocRuleId: selectedTarget, excludedChapterIds: previewExcludedIds, limit: 1000, offset: 0 }
  }, [activeTarget, customPatterns, excludedChapterIds, selectedTarget])

  const shouldPreview = Boolean(currentChapters?.length) && selectionReadyTarget === activeTarget
  const previewQuery = useTocPreview(bookId, previewReq, { enabled: Boolean(bookId) && shouldPreview })
  const preview = previewQuery.data?.data

  const [extraChapters, setExtraChapters] = useState<TocPreviewChapter[]>([])
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  // Reset extra chapters when target changes
  useEffect(() => {
    setExtraChapters([])
  }, [selectedTarget])

  useEffect(() => {
    setSelectedExcludedIds(selectedTarget === activeTarget ? (excludedChapterIds ?? []) : [])
  }, [activeTarget, excludedChapterIds, selectedTarget])

  useEffect(() => {
    if (preview) setSelectedExcludedIds(preview.excludedChapterIds)
  }, [preview])

  const currentLevelCounts = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const chapter of currentChapters ?? []) {
      counts[chapter.level] = (counts[chapter.level] ?? 0) + 1
    }
    return counts
  }, [currentChapters])

  const currentPreview = useMemo<TocPreviewRes | null>(() => {
    if (preview || !currentChapters?.length || currentChapters.some((chapter) => !chapter.id || !chapter.title)) return null

    return {
      ruleId: activeTarget === 'auto' || activeTarget === 'custom' ? null : activeTarget,
      autoScored: autoScored ?? false,
      fallback: false,
      totalChapters: currentChapters.length,
      matchedTotalChapters: currentChapters.length,
      currentTotalChapters: currentChapters.length,
      levelCounts: currentLevelCounts,
      excludedChapterIds: [],
      chapters: currentChapters.map((chapter) => ({
        id: chapter.id!,
        title: chapter.title!,
        level: chapter.level,
        wordCount: chapter.wordCount ?? 0,
        excluded: false,
        canExclude: false,
      })),
    }
  }, [activeTarget, autoScored, currentChapters, currentLevelCounts, preview])

  const displayedPreview = preview ?? currentPreview

  const allChapters = useMemo(() => {
    if (!displayedPreview) return []
    return [...displayedPreview.chapters, ...extraChapters]
  }, [displayedPreview, extraChapters])

  const displayedPreviewStats = useMemo(() => {
    if (!displayedPreview) return { totalChapters: 0, levelCounts: {} as Record<number, number> }
    const levelCounts = { ...displayedPreview.levelCounts }
    const baselineExcludedIds = new Set(displayedPreview.excludedChapterIds)
    let totalDelta = 0
    for (const chapter of allChapters) {
      const wasExcluded = baselineExcludedIds.has(chapter.id)
      const isExcluded = selectedExcludedIds.includes(chapter.id)
      if (wasExcluded === isExcluded) continue
      totalDelta += isExcluded ? -1 : 1
      levelCounts[chapter.level] = (levelCounts[chapter.level] ?? 0) + (isExcluded ? -1 : 1)
    }
    for (const [level, count] of Object.entries(levelCounts)) {
      if (count <= 0) delete levelCounts[Number(level)]
    }
    return {
      totalChapters: displayedPreview.totalChapters + totalDelta,
      levelCounts,
    }
  }, [allChapters, displayedPreview, selectedExcludedIds])

  const previewMatchesCurrent = useMemo(() => {
    if (!preview || !currentChapters) return true
    if (displayedPreviewStats.totalChapters !== currentChapters.length) return false
    const levels = new Set([...Object.keys(displayedPreviewStats.levelCounts), ...Object.keys(currentLevelCounts)])
    return [...levels].every((level) => displayedPreviewStats.levelCounts[Number(level)] === currentLevelCounts[Number(level)])
  }, [currentChapters, currentLevelCounts, displayedPreviewStats, preview])

  const handleLoadMore = async () => {
    if (!preview || isLoadingMore) return
    setIsLoadingMore(true)
    try {
      const res = await apiPost<{ data: { chapters: TocPreviewChapter[] } }>(`/books/${bookId}/toc-preview`, {
        ...previewReq,
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

  if (rulesQuery.isError) {
    return (
      <Modal title={_('library.tocRuleSection')} onClose={onClose} size="wide">
        <QueryErrorState className="py-4" isRetrying={rulesQuery.isFetching} onRetry={rulesQuery.refetch} />
      </Modal>
    )
  }

  const isDifferentFromActive = selectedTarget !== activeTarget
  const needsRebuild = Boolean(preview && currentChapters && !previewMatchesCurrent)
  const exclusionsChanged =
    activeExcludedIds.length !== selectedExcludedIds.length ||
    activeExcludedIds.some((id) => !selectedExcludedIds.includes(id))
  const canApply = isDifferentFromActive || needsRebuild || exclusionsChanged
  const isApplying = reToc.isPending

  function handleApply() {
    if (!canApply || isApplying) return
    const body = selectedTarget === 'auto'
      ? { tocRuleId: null, excludedChapterIds: selectedExcludedIds }
      : selectedTarget === 'custom'
        ? { customPatterns, excludedChapterIds: selectedExcludedIds }
        : { tocRuleId: selectedTarget, excludedChapterIds: selectedExcludedIds }

    reToc.mutate(body, {
      onSuccess: () => {
        notify.success(selectedTarget === 'auto' ? { key: 'library.tocRuleUnpinned' } : { key: 'library.tocRulePinSuccess' })
        onClose()
      },
      onError: (err) => {
        notify.error(getUserErrorNotification(err, 'library.tocRulePinFailed'))
      },
    })
  }

  const headerActions = (
    <button
      type="button"
      onClick={() => setCustomEditorOpen(true)}
      aria-label={_('library.tocRuleNewCustom')}
      title={_('library.tocRuleNewCustom')}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )

  return (
    <>
      <Modal title={_('library.tocRuleSection')} onClose={onClose} size="wide" actions={headerActions}>
        <div className="flex flex-col gap-4 sm:min-h-[55vh] sm:flex-row sm:gap-6">
          {/* Left Column: Rule Selection List */}
          <div className="flex flex-col gap-1 sm:w-5/12 sm:border-r sm:border-stone-100 sm:pr-4 sm:dark:border-stone-800">
            <ul className="flex flex-col gap-1">
              {/* 1. Auto Split option */}
              <li>
                <button
                  type="button"
                  disabled={isApplying}
                  onClick={() => setSelectedTarget('auto')}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50',
                    selectedTarget === 'auto'
                      ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{_('library.tocRuleNone')}</span>
                  {activeTarget === 'auto' ? (
                    <span className={cn('shrink-0 text-xs', selectedTarget === 'auto' ? 'text-white/70 dark:text-stone-700' : 'text-stone-400')}>
                      {autoScored ? _('library.tocRuleAutoScored') : _('library.tocRulePinned')}
                    </span>
                  ) : (
                    <span className={cn('shrink-0 text-xs', selectedTarget === 'auto' ? 'text-white/50 dark:text-stone-500' : 'text-stone-400')}>
                      {_('library.tocRuleNoneHint')}
                    </span>
                  )}
                </button>
              </li>

              {/* 2. Book Custom Rule option (if configured) */}
              {customPatterns && customPatterns.length > 0 && (
                <li>
                  <div
                    className={cn(
                      'flex w-full items-center justify-between gap-1 rounded-lg px-3 py-1.5 transition-colors',
                      selectedTarget === 'custom'
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    )}
                  >
                    <button
                      type="button"
                      disabled={isApplying}
                      onClick={() => setSelectedTarget('custom')}
                      className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-[13px] disabled:opacity-50"
                    >
                      <span className="truncate">{_('library.tocRuleCustom')}</span>
                      {activeTarget === 'custom' && (
                        <span className={cn('text-xs', selectedTarget === 'custom' ? 'text-white/70 dark:text-stone-700' : 'text-stone-400')}>
                          {_('library.tocRulePinned')}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setCustomEditorOpen(true)
                      }}
                      title={_('library.tocRuleCustomEdit')}
                      aria-label={_('library.tocRuleCustomEdit')}
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                        selectedTarget === 'custom'
                          ? 'text-white/80 hover:bg-white/20 hover:text-white dark:text-stone-700 dark:hover:bg-stone-900/20 dark:hover:text-stone-900'
                          : 'text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
                      )}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                  </div>
                </li>
              )}

              {/* 3. Global Rule presets */}
              {rules.map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    disabled={isApplying}
                    onClick={() => setSelectedTarget(rule.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors disabled:opacity-50',
                      selectedTarget === rule.id
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">{rule.name || '—'}</span>
                    {activeTarget === rule.id && (
                      <span className={cn('shrink-0 text-xs', selectedTarget === rule.id ? 'text-white/70 dark:text-stone-700' : 'text-stone-400')}>
                        {autoScored ? _('library.tocRuleAutoScored') : _('library.tocRulePinned')}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>

            {rules.length === 0 && (!customPatterns || customPatterns.length === 0) && (
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">{_('library.tocRulePickerEmpty')}</p>
            )}
          </div>

          {/* Right Column: Preview Panel */}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {!displayedPreview ? (
              <div className="flex flex-1 items-center justify-center p-8 text-xs text-stone-400">
                {shouldPreview ? _('library.tocRulePreviewLoading') : _('library.tocRuleCurrentLoading')}
              </div>
            ) : (
              <>
                {/* Header Summary */}
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/60">
                  <div className="flex items-center gap-2 font-medium text-stone-800 dark:text-stone-100">
                    <span>
                      {_('library.tocRulePreviewCurrentDiff', {
                        current: displayedPreview.currentTotalChapters,
                        total: displayedPreviewStats.totalChapters,
                      })}
                    </span>
                    {shouldPreview && previewQuery.isFetching && (
                      <span className="font-normal text-stone-400 dark:text-stone-500">
                        {_('library.tocRulePreviewLoading')}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5">
                    {Object.entries(displayedPreviewStats.levelCounts).map(([lvl, count]) => (
                      <span
                        key={lvl}
                        className="rounded bg-stone-200/70 px-1.5 py-0.5 text-[11px] text-stone-700 dark:bg-stone-700 dark:text-stone-300"
                      >
                        L{lvl}: {count}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Fallback Warning */}
                {displayedPreview.fallback && (
                  <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                    ⚠️ {_('library.tocRulePreviewFallbackWarning')}
                  </div>
                )}

                {/* Chapter tree preview */}
                <div className="min-h-0 max-h-[55vh] flex-1 overflow-y-auto rounded-xl border border-stone-100 p-2 custom-scrollbar dark:border-stone-800">
                  {allChapters.length === 0 ? (
                    <p className="py-8 text-center text-xs text-stone-400">{_('library.tocRulePreviewEmpty')}</p>
                  ) : (
                    <ul className="flex flex-col gap-0.5 text-xs">
                      {allChapters.map((ch) => {
                        const isExcluded = selectedExcludedIds.includes(ch.id)
                        return (
                        <li
                          key={ch.id}
                        >
                          <button
                            type="button"
                            disabled={!ch.canExclude || isApplying}
                            aria-pressed={isExcluded}
                            onClick={() => {
                              if (!ch.canExclude) return
                              setSelectedExcludedIds((prev) =>
                                prev.includes(ch.id) ? prev.filter((id) => id !== ch.id) : [...prev, ch.id],
                              )
                            }}
                            className={cn(
                              'flex w-full items-center justify-between rounded px-2 py-1 text-left transition-colors disabled:cursor-default',
                              ch.level > 1 && 'pl-5',
                              ch.level > 2 && 'pl-9',
                              isExcluded
                                ? 'text-stone-400 line-through dark:text-stone-500'
                                : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800/60',
                              !ch.canExclude && 'hover:bg-transparent',
                            )}
                          >
                            <span className="truncate pr-2">{ch.title}</span>
                            <span className="shrink-0 text-[11px] no-underline text-stone-400">
                              {ch.wordCount >= 1000
                                ? _('library.tocRuleWordsK', { count: (ch.wordCount / 1000).toFixed(1) })
                                : _('library.tocRuleWords', { count: ch.wordCount })}
                            </span>
                          </button>
                        </li>
                        )
                      })}
                    </ul>
                  )}
                  {preview && preview.matchedTotalChapters > allChapters.length && (
                    <div className="flex justify-center border-t border-stone-200 pt-2 dark:border-stone-800">
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
              </>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-4 flex flex-col gap-3 border-t border-stone-100 pt-3 sm:flex-row sm:items-center sm:justify-between dark:border-stone-800">
          <span className="text-[11px] text-stone-400 dark:text-stone-500">
            {_('library.tocRulePreviewResetWarning')}
          </span>
          <div className="flex shrink-0 items-center justify-end gap-2">
            <Button variant="secondary" onClick={onClose} disabled={isApplying}>
              {_('library.cancel')}
            </Button>
            <Button
              onClick={handleApply}
              disabled={isApplying || !canApply || previewQuery.isFetching}
            >
              {isApplying ? _('library.tocRuleApplying') : _('library.tocRuleApply')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Book-Specific Custom TOC Rule Editor */}
      {customEditorOpen && (
        <BookCustomTocEditor
          bookId={bookId}
          initialPatterns={customPatterns}
          onClose={() => setCustomEditorOpen(false)}
          onSaved={() => {
            setCustomEditorOpen(false)
            setSelectedTarget('custom')
          }}
        />
      )}
    </>
  )
}
