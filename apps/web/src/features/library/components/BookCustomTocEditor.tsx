import { useEffect, useMemo, useRef, useState } from 'react'

import type { TocPreviewChapter, TocPreviewReq, TocRulePattern, TocRuleRes } from '@bookdock/shared'

import { tocPreviewPost, useReToc, useTocPreview, useTocRules, type TocTarget } from '@/api/hooks/useTocRules'
import { Button } from '@/components/ui/Button'
import TocRuleFormModal, { type TocRuleFormMode } from '@/features/settings/components/TocRuleFormModal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { cn } from '@/lib/utils'

interface BookCustomTocEditorProps {
  target: TocTarget
  mode?: TocRuleFormMode
  initialRule?: TocRuleRes | null
  initialPatterns?: TocRulePattern[] | null
  onClose: () => void
  onSaved: () => void
  onGlobalSaved?: (rule: TocRuleRes) => void
}

export default function BookCustomTocEditor({
  target,
  mode,
  initialRule,
  initialPatterns,
  onClose,
  onSaved,
  onGlobalSaved,
}: BookCustomTocEditorProps) {
  const _ = useTranslation()
  const rulesQuery = useTocRules()
  const globalRules = rulesQuery.data?.data ?? []
  const reToc = useReToc(target)

  const resolvedMode: TocRuleFormMode =
    mode ?? (initialRule ? 'edit-global' : initialPatterns && initialPatterns.length > 0 ? 'edit-custom' : 'create')

  // Manual test trigger payload
  const [testPayload, setTestPayload] = useState<TocPreviewReq | null>(() => {
    if (resolvedMode === 'edit-global' && initialRule?.patterns.length) {
      return { customPatterns: initialRule.patterns, limit: 1000, offset: 0 }
    }
    if (resolvedMode === 'edit-custom' && initialPatterns && initialPatterns.length > 0) {
      return { customPatterns: initialPatterns, limit: 1000, offset: 0 }
    }
    return null
  })

  const previewQuery = useTocPreview(target, testPayload ?? {}, { enabled: Boolean(testPayload) })
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
      const res = await tocPreviewPost(target, { ...testPayload, offset: allChapters.length, limit: 1000 }) as {
        data: { chapters: TocPreviewChapter[] }
      }
      if (res?.data?.chapters?.length) {
        setExtraChapters((prev) => [...prev, ...res.data.chapters])
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingMore(false)
    }
  }

  function handleSaveCustom(patterns: TocRulePattern[]) {
    reToc.mutate(
      { customPatterns: patterns },
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

  const testMatchActionRef = useRef<() => void>(() => {})

  // Keyboard shortcut Ctrl+Enter or Cmd+Enter to test match
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault()
        testMatchActionRef.current()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <TocRuleFormModal
      mode={resolvedMode}
      rules={globalRules}
      initialRule={initialRule}
      initialPatterns={initialPatterns}
      externalSaving={reToc.isPending}
      onClose={onClose}
      onGlobalSaved={onGlobalSaved}
      onCustomSaved={handleSaveCustom}
      renderTestSection={({ validatePatterns, saving }) => {
        const triggerTestMatch = () => {
          const validated = validatePatterns()
          if (!validated) return
          setExtraChapters([])
          setTestPayload({ customPatterns: validated, limit: 1000, offset: 0 })
        }
        testMatchActionRef.current = triggerTestMatch

        return (
          <>
            <div className="flex items-center justify-between gap-3 border-t border-stone-100 pt-3 dark:border-stone-800">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={triggerTestMatch}
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
          </>
        )
      }}
    />
  )
}
