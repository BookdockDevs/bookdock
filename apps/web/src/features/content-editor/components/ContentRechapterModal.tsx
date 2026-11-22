import { useEffect, useMemo, useState } from 'react'
import {
  normalizeTxtText,
  pickTxtTocRule,
  type TocRulePattern,
  type TocRuleRes,
} from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import TocRuleFormModal from '@/features/settings/components/TocRuleFormModal'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import type { EditorTocRuleSelection, EditorUnit } from '../lib/editor-draft'
import { previewTextChapters } from '../lib/text-tools'

type RuleEditorState =
  | { mode: 'create' }
  | { mode: 'edit-global'; rule: TocRuleRes }
  | { mode: 'edit-custom' }
  | null

interface ContentRechapterModalProps {
  initialText: string
  rules: TocRuleRes[]
  customPatterns?: TocRulePattern[]
  initialRuleId?: string | null
  unitCount: number
  onApply: (units: EditorUnit[], insertIndex: number, selection: EditorTocRuleSelection) => void
  onClose: () => void
}

export default function ContentRechapterModal({
  initialText,
  rules,
  customPatterns,
  initialRuleId,
  unitCount,
  onApply,
  onClose,
}: ContentRechapterModalProps) {
  const _ = useTranslation()

  const [savedRuleOverrides, setSavedRuleOverrides] = useState<Record<string, TocRuleRes>>({})
  const mergedRules = useMemo(() => {
    const byId = new Map(rules.map((r) => [r.id, r]))
    for (const [id, r] of Object.entries(savedRuleOverrides)) {
      byId.set(id, r)
    }
    return Array.from(byId.values())
  }, [rules, savedRuleOverrides])

  // Active target currently saved on the book
  const activeTarget: 'auto' | 'custom' | string = useMemo(() => {
    if (customPatterns && customPatterns.length > 0 && initialRuleId === 'custom') {
      return 'custom'
    }
    if (initialRuleId && mergedRules.some((r) => r.id === initialRuleId)) {
      return initialRuleId
    }
    return 'auto'
  }, [initialRuleId, customPatterns, mergedRules])

  // Selected target for previewing
  const [selectedTarget, setSelectedTarget] = useState<'auto' | 'custom' | string>(activeTarget)
  const [activeCustomPatterns, setActiveCustomPatterns] = useState<TocRulePattern[]>(() => customPatterns ?? [])
  const [excludedChapterIds, setExcludedChapterIds] = useState<string[]>([])
  const [ruleEditor, setRuleEditor] = useState<RuleEditorState>(null)

  // Auto-scored rule detection with safe rule filtering
  const validRules = useMemo(() => mergedRules.filter((r) => Array.isArray(r?.patterns)), [mergedRules])
  const normalizedText = useMemo(() => normalizeTxtText(initialText), [initialText])
  const autoRule = useMemo(() => (validRules.length > 0 ? pickTxtTocRule(validRules, normalizedText) : undefined), [normalizedText, validRules])
  const autoRuleObj = useMemo(() => mergedRules.find((r) => r.id === autoRule?.id), [autoRule, mergedRules])

  // Reset exclusions on target change
  useEffect(() => {
    setExcludedChapterIds([])
  }, [selectedTarget])

  // Compute live chapter preview for selected rule
  const { previewChapters, levelCounts, isFallback } = useMemo(() => {
    let patternsToUse: TocRulePattern[] = []
    let fallback = false

    if (selectedTarget === 'custom') {
      patternsToUse = activeCustomPatterns
    } else if (selectedTarget === 'auto') {
      if (autoRule && autoRule.patterns.length > 0) {
        patternsToUse = [...autoRule.patterns] as TocRulePattern[]
      } else {
        fallback = true
        patternsToUse = [{ level: 1, regex: '^第.+章', replacement: null, enabled: true }]
      }
    } else {
      const found = mergedRules.find((r) => r.id === selectedTarget)
      if (found) {
        patternsToUse = found.patterns
      }
    }

    if (patternsToUse.length === 0) {
      return {
        previewChapters: [
          { id: 'single-chapter', title: _('editor.singleChapterTitle') || '全书正文', content: initialText, level: 0 },
        ],
        levelCounts: { 1: 1 },
        isFallback: false,
      }
    }

    const rawChapters = previewTextChapters(initialText, patternsToUse)
    const counts: Record<number, number> = {}
    for (const ch of rawChapters) {
      const lvl = (ch.level ?? 0) + 1
      counts[lvl] = (counts[lvl] ?? 0) + 1
    }

    return {
      previewChapters: rawChapters,
      levelCounts: counts,
      isFallback: fallback,
    }
  }, [activeCustomPatterns, autoRule, initialText, mergedRules, selectedTarget, _])

  // Level counts after user exclusions
  const displayedStats = useMemo(() => {
    const counts = { ...levelCounts }
    let delta = 0
    for (const ch of previewChapters) {
      if (excludedChapterIds.includes(ch.id)) {
        delta -= 1
        const lvl = (ch.level ?? 0) + 1
        counts[lvl] = (counts[lvl] ?? 0) - 1
        if (counts[lvl]! <= 0) delete counts[lvl]
      }
    }
    return {
      total: previewChapters.length + delta,
      levelCounts: counts,
    }
  }, [excludedChapterIds, levelCounts, previewChapters])

  function handleToggleExclusion(chapterId: string) {
    setExcludedChapterIds((prev) =>
      prev.includes(chapterId) ? prev.filter((id) => id !== chapterId) : [...prev, chapterId],
    )
  }

  function handleApply() {
    if (previewChapters.length === 0) return

    // Apply exclusions: merge excluded chapters into preceding chapter
    const finalUnits: EditorUnit[] = []
    for (const ch of previewChapters) {
      const isExcluded = excludedChapterIds.includes(ch.id)
      if (isExcluded) {
        if (finalUnits.length > 0) {
          const last = finalUnits[finalUnits.length - 1]!
          last.content = `${last.content}\n\n${ch.title}\n\n${ch.content}`
        }
      } else {
        finalUnits.push({ ...ch })
      }
    }

    if (finalUnits.length === 0) {
      finalUnits.push(previewChapters[0]!)
    }

    let selection: EditorTocRuleSelection
    if (selectedTarget === 'custom') {
      selection = {
        ruleId: 'custom',
        patterns: activeCustomPatterns,
        label: _('library.tocRuleCustom') || '本书专属规则',
        auto: false,
      }
    } else if (selectedTarget === 'auto') {
      selection = autoRule && autoRuleObj
        ? { ruleId: autoRule.id, patterns: [...autoRule.patterns] as TocRulePattern[], label: autoRuleObj.name, auto: true }
        : { ruleId: null, patterns: null, label: null, auto: true }
    } else {
      const found = mergedRules.find((r) => r.id === selectedTarget)
      selection = found
        ? { ruleId: found.id, patterns: found.patterns, label: found.name, auto: false }
        : { ruleId: null, patterns: null, label: null, auto: false }
    }

    onApply(finalUnits, 0, selection)
    onClose()
  }

  const headerActions = (
    <button
      type="button"
      onClick={() => setRuleEditor({ mode: 'create' })}
      aria-label={_('settings.tocRulesNew') || '新建目录规则'}
      title={_('settings.tocRulesNew') || '新建目录规则'}
      className="flex h-7 w-7 items-center justify-center rounded-lg text-stone-400 transition-colors hover:bg-stone-100 hover:text-stone-700 dark:hover:bg-stone-800 dark:hover:text-stone-200"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )

  return (
    <>
      <Modal
        title={_('editor.rechapter') || '更换目录规则'}
        onClose={onClose}
        size="wide"
        actions={headerActions}
      >
        {/* 2-Column Layout identical to TocRulePicker */}
        <div className="flex flex-col gap-4 sm:min-h-[55vh] sm:flex-row sm:gap-6">
          {/* Left Column: Rule Selection List */}
          <div className="flex flex-col gap-1 sm:w-5/12 sm:border-r sm:border-stone-100 sm:pr-4 sm:dark:border-stone-800">
            <ul className="flex flex-col gap-1">
              {/* 1. Auto Split option */}
              <li>
                <button
                  type="button"
                  onClick={() => setSelectedTarget('auto')}
                  className={cn(
                    'flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                    selectedTarget === 'auto'
                      ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                      : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">{_('library.tocRuleNone') || '自动分章'}</span>
                  {activeTarget === 'auto' ? (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        selectedTarget === 'auto' ? 'text-white/70 dark:text-stone-700' : 'text-stone-400',
                      )}
                    >
                      {autoRuleObj ? autoRuleObj.name : (_('library.tocRuleAutoScored') || '自动匹配')}
                    </span>
                  ) : (
                    <span
                      className={cn(
                        'shrink-0 text-xs',
                        selectedTarget === 'auto' ? 'text-white/50 dark:text-stone-500' : 'text-stone-400',
                      )}
                    >
                      {autoRuleObj ? autoRuleObj.name : (_('library.tocRuleNoneHint') || '自动选择')}
                    </span>
                  )}
                </button>
              </li>

              {/* 2. Book Custom Rule option (if configured) */}
              {activeCustomPatterns && activeCustomPatterns.length > 0 && (
                <li>
                  <div
                    className={cn(
                      'group flex w-full items-center justify-between gap-1 rounded-lg px-3 py-1.5 transition-colors',
                      selectedTarget === 'custom'
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTarget('custom')}
                      className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-[13px]"
                    >
                      <span className="truncate">{_('library.tocRuleCustom') || '本书专属规则'}</span>
                      {activeTarget === 'custom' && (
                        <span
                          className={cn(
                            'text-xs',
                            selectedTarget === 'custom' ? 'text-white/70 dark:text-stone-700' : 'text-stone-400',
                          )}
                        >
                          {_('library.tocRulePinned') || '当前规则'}
                        </span>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        setRuleEditor({ mode: 'edit-custom' })
                      }}
                      title={_('library.tocRuleCustomEdit') || '编辑规则'}
                      aria-label={_('library.tocRuleCustomEdit') || '编辑规则'}
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity',
                        selectedTarget === 'custom'
                          ? 'opacity-100 text-white/80 hover:bg-white/20 hover:text-white dark:text-stone-700 dark:hover:bg-stone-900/20 dark:hover:text-stone-900'
                          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
                      )}
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                      </svg>
                    </button>
                  </div>
                </li>
              )}

              {/* 3. Global Rule presets */}
              {mergedRules.filter((r) => r.enabled).map((rule) => (
                <li key={rule.id}>
                  <div
                    className={cn(
                      'group flex w-full items-center justify-between gap-1 rounded-lg px-3 py-1.5 transition-colors',
                      selectedTarget === rule.id
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => setSelectedTarget(rule.id)}
                      className="flex min-w-0 flex-1 items-center gap-2 py-0.5 text-left text-[13px]"
                    >
                      <span className="min-w-0 flex-1 truncate">{rule.name || '—'}</span>
                      {activeTarget === rule.id && (
                        <span
                          className={cn(
                            'shrink-0 text-xs',
                            selectedTarget === rule.id ? 'text-white/70 dark:text-stone-700' : 'text-stone-400',
                          )}
                        >
                          {_('library.tocRulePinned') || '当前规则'}
                        </span>
                      )}
                    </button>
                    {rule.mine !== false && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setRuleEditor({ mode: 'edit-global', rule })
                        }}
                        title={_('settings.tocRulesEdit') || '编辑目录规则'}
                        aria-label={_('settings.tocRulesEdit') || '编辑目录规则'}
                        className={cn(
                          'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-opacity',
                          selectedTarget === rule.id
                            ? 'opacity-100 text-white/80 hover:bg-white/20 hover:text-white dark:text-stone-700 dark:hover:bg-stone-900/20 dark:hover:text-stone-900'
                            : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100 text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
                        )}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z" />
                        </svg>
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {mergedRules.length === 0 && (!activeCustomPatterns || activeCustomPatterns.length === 0) && (
              <p className="mt-2 text-xs text-stone-400 dark:text-stone-500">
                {_('library.tocRulePickerEmpty') || '暂无可用规则'}
              </p>
            )}
          </div>

          {/* Right Column: Preview Panel */}
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            {/* Header Summary */}
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-stone-50 px-3 py-2 text-xs dark:bg-stone-800/60">
              <div className="flex items-center gap-2 font-medium text-stone-800 dark:text-stone-100">
                <span>
                  {_('library.tocRulePreviewCurrentDiff', {
                    current: unitCount,
                    total: displayedStats.total,
                  }) || `当前 ${unitCount} 章 → 预览 ${displayedStats.total} 章`}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                {Object.entries(displayedStats.levelCounts).map(([lvl, count]) => (
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
            {isFallback && (
              <div className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400">
                ⚠️ {_('library.tocRulePreviewFallbackWarning') || '未匹配到预设分章规则，已采用默认规则'}
              </div>
            )}

            {/* Chapter tree preview */}
            <div className="min-h-0 max-h-[55vh] flex-1 overflow-y-auto rounded-xl border border-stone-100 p-2 custom-scrollbar dark:border-stone-800">
              {previewChapters.length === 0 ? (
                <p className="py-8 text-center text-xs text-stone-400">
                  {_('library.tocRulePreviewEmpty') || '未匹配到任何章节'}
                </p>
              ) : (
                <ul className="flex flex-col gap-0.5 text-xs">
                  {previewChapters.map((ch) => {
                    const isExcluded = excludedChapterIds.includes(ch.id)
                    const wordCount = ch.content?.length ?? 0
                    return (
                      <li key={ch.id}>
                        <button
                          type="button"
                          aria-pressed={isExcluded}
                          onClick={() => handleToggleExclusion(ch.id)}
                          className={cn(
                            'flex w-full items-center justify-between rounded px-2 py-1 text-left transition-colors',
                            (ch.level ?? 0) === 1 && 'pl-5',
                            (ch.level ?? 0) > 1 && 'pl-9',
                            isExcluded
                              ? 'text-stone-400 line-through dark:text-stone-500'
                              : 'text-stone-700 hover:bg-stone-50 dark:text-stone-300 dark:hover:bg-stone-800/60',
                          )}
                        >
                          <span className="truncate pr-2">{ch.title}</span>
                          <span className="shrink-0 text-[11px] no-underline text-stone-400">
                            {wordCount >= 1000
                              ? (_('library.tocRuleWordsK', { count: (wordCount / 1000).toFixed(1) }) || `${(wordCount / 1000).toFixed(1)}k 字`)
                              : (_('library.tocRuleWords', { count: wordCount }) || `${wordCount} 字`)}
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          </div>
        </div>

        {/* Footer actions */}
        <div className="mt-4 flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose}>
            {_('common.cancel') || '取消'}
          </Button>
          <Button
            variant="primary"
            disabled={previewChapters.length === 0}
            onClick={handleApply}
          >
            {_('editor.applyToDraft') || '应用到草稿'}
          </Button>
        </div>
      </Modal>

      {/* Global / Book-Specific TOC Rule Editor Sub-modal */}
      {ruleEditor !== null && (
        <TocRuleFormModal
          mode={ruleEditor.mode}
          rules={mergedRules}
          initialRule={ruleEditor.mode === 'edit-global' ? ruleEditor.rule : null}
          initialPatterns={ruleEditor.mode === 'edit-custom' ? activeCustomPatterns : null}
          onClose={() => setRuleEditor(null)}
          onGlobalSaved={(savedRule) => {
            setSavedRuleOverrides((prev) => ({ ...prev, [savedRule.id]: savedRule }))
            setSelectedTarget(savedRule.id)
          }}
          onCustomSaved={(patterns) => {
            setActiveCustomPatterns(patterns)
            setSelectedTarget('custom')
            setRuleEditor(null)
          }}
        />
      )}
    </>
  )
}
