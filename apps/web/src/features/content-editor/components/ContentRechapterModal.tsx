import { useEffect, useMemo, useRef, useState } from 'react'
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { arrayMove, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import {
  normalizeTxtText,
  pickTxtTocRule,
  tocRuleCreateSchema,
  type TocRulePattern,
  type TocRuleRes,
} from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import TocPatternRow, { type TocPatternError } from '@/features/settings/components/TocPatternRow'
import { useTranslation } from '@/hooks/useTranslation'
import { cn } from '@/lib/utils'
import type { EditorTocRuleSelection, EditorUnit } from '../lib/editor-draft'
import { previewTextChapters } from '../lib/text-tools'

interface PatternDraft {
  id: string
  regex: string
  replacement: string
  enabled: boolean
}

function toDrafts(patterns: readonly TocRulePattern[]): PatternDraft[] {
  return patterns.map((p, index) => ({
    id: `custom-pat-${index}-${Date.now()}`,
    regex: p.regex,
    replacement: p.replacement ?? '',
    enabled: p.enabled !== false,
  }))
}

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
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  // Active target currently saved on the book
  const activeTarget: 'auto' | 'custom' | string = useMemo(() => {
    if (customPatterns && customPatterns.length > 0 && initialRuleId === 'custom') {
      return 'custom'
    }
    if (initialRuleId && rules.some((r) => r.id === initialRuleId)) {
      return initialRuleId
    }
    return 'auto'
  }, [initialRuleId, customPatterns, rules])

  // Selected target for previewing
  const [selectedTarget, setSelectedTarget] = useState<'auto' | 'custom' | string>(activeTarget)
  const [activeCustomPatterns, setActiveCustomPatterns] = useState<TocRulePattern[]>(() => customPatterns ?? [])
  const [excludedChapterIds, setExcludedChapterIds] = useState<string[]>([])
  const [customEditorOpen, setCustomEditorOpen] = useState(false)

  // Custom editor internal drafts
  const [patternDrafts, setPatternDrafts] = useState<PatternDraft[]>(() =>
    toDrafts(
      activeCustomPatterns.length > 0
        ? activeCustomPatterns
        : [{ level: 1, regex: '', replacement: '', enabled: true }],
    ),
  )
  const nextPatternId = useRef(patternDrafts.length)
  const patternInputRefs = useRef<Record<string, HTMLInputElement | null>>({})
  const [patternErrors, setPatternErrors] = useState<TocPatternError[]>(patternDrafts.map(() => null))
  const [patternFormError, setPatternFormError] = useState('')

  // Auto-scored rule detection with safe rule filtering
  const validRules = useMemo(() => (rules ?? []).filter((r) => Array.isArray(r?.patterns)), [rules])
  const normalizedText = useMemo(() => normalizeTxtText(initialText), [initialText])
  const autoRule = useMemo(() => (validRules.length > 0 ? pickTxtTocRule(validRules, normalizedText) : undefined), [normalizedText, validRules])
  const autoRuleObj = useMemo(() => rules.find((r) => r.id === autoRule?.id), [autoRule, rules])

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
      const found = rules.find((r) => r.id === selectedTarget)
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
  }, [activeCustomPatterns, autoRule, initialText, rules, selectedTarget, _])

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
      const found = rules.find((r) => r.id === selectedTarget)
      selection = found
        ? { ruleId: found.id, patterns: found.patterns, label: found.name, auto: false }
        : { ruleId: null, patterns: null, label: null, auto: false }
    }

    onApply(finalUnits, 0, selection)
    onClose()
  }

  // Custom pattern editor methods
  function addCustomPattern() {
    const id = `custom-pat-${nextPatternId.current++}-${Date.now()}`
    setPatternDrafts((prev) => [...prev, { id, regex: '', replacement: '', enabled: true }])
    setPatternErrors((prev) => [...prev, null])
    setPatternFormError('')
  }

  function updateCustomPattern(index: number, patch: Partial<PatternDraft>) {
    setPatternDrafts((prev) => prev.map((p, i) => (i === index ? { ...p, ...patch } : p)))
    setPatternFormError('')
    if (patch.regex !== undefined) {
      setPatternErrors((prev) => prev.map((e, i) => (i === index ? null : e)))
    }
  }

  function removeCustomPattern(index: number) {
    setPatternDrafts((prev) => prev.filter((_, i) => i !== index))
    setPatternErrors((prev) => prev.filter((_, i) => i !== index))
    setPatternFormError('')
  }

  function handlePatternDragEnd(event: DragEndEvent) {
    const { active, over } = event
    if (!over || active.id === over.id) return
    const oldIndex = patternDrafts.findIndex((p) => p.id === active.id)
    const newIndex = patternDrafts.findIndex((p) => p.id === over.id)
    if (oldIndex < 0 || newIndex < 0) return
    setPatternDrafts((prev) => arrayMove(prev, oldIndex, newIndex))
    setPatternErrors((prev) => arrayMove(prev, oldIndex, newIndex))
  }

  function handleCopyFromTemplate(templateId: string) {
    if (!templateId) return
    const found = rules.find((r) => r.id === templateId)
    if (found && found.patterns.length > 0) {
      setPatternDrafts(toDrafts(found.patterns))
      setPatternErrors(found.patterns.map(() => null))
      setPatternFormError('')
    }
  }

  function handleSaveCustomPatterns() {
    const newErrors = patternDrafts.map((d) => {
      const trimmed = d.regex.trim()
      if (!trimmed) return 'required' as const
      try {
        new RegExp(trimmed)
      } catch {
        return 'invalidRegex' as const
      }
      return null
    })
    setPatternErrors(newErrors)
    const firstErrIndex = newErrors.findIndex((e) => e !== null)
    if (firstErrIndex >= 0) {
      patternInputRefs.current[patternDrafts[firstErrIndex]?.id ?? '']?.focus()
      setPatternFormError('')
      return
    }

    const patterns = patternDrafts.map((d, index) => ({
      level: index + 1,
      regex: d.regex.trim(),
      replacement: d.replacement === '' ? null : d.replacement,
      enabled: d.enabled,
    }))

    const parsed = tocRuleCreateSchema.safeParse({ name: '本书专属规则', patterns })
    if (!parsed.success) {
      setPatternFormError(patterns.length === 0 ? _('settings.tocRulesAtLeastOne') : _('settings.tocRulesInvalid'))
      return
    }

    setActiveCustomPatterns(parsed.data.patterns)
    setSelectedTarget('custom')
    setCustomEditorOpen(false)
  }

  const headerActions = (
    <button
      type="button"
      onClick={() => {
        if (activeCustomPatterns.length === 0) {
          setPatternDrafts([])
          setPatternErrors([])
        } else {
          setPatternDrafts(toDrafts(activeCustomPatterns))
          setPatternErrors(activeCustomPatterns.map(() => null))
        }
        setPatternFormError('')
        setCustomEditorOpen(true)
      }}
      aria-label={_('library.tocRuleNewCustom') || '新建专属规则'}
      title={_('library.tocRuleNewCustom') || '新建专属规则'}
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
                      'flex w-full items-center justify-between gap-1 rounded-lg px-3 py-1.5 transition-colors',
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
                        setPatternDrafts(toDrafts(activeCustomPatterns))
                        setPatternErrors(activeCustomPatterns.map(() => null))
                        setPatternFormError('')
                        setCustomEditorOpen(true)
                      }}
                      title={_('library.tocRuleCustomEdit') || '编辑规则'}
                      aria-label={_('library.tocRuleCustomEdit') || '编辑规则'}
                      className={cn(
                        'flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors',
                        selectedTarget === 'custom'
                          ? 'text-white/80 hover:bg-white/20 hover:text-white dark:text-stone-700 dark:hover:bg-stone-900/20 dark:hover:text-stone-900'
                          : 'text-stone-400 hover:bg-stone-200 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200',
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
              {rules.filter((r) => r.enabled).map((rule) => (
                <li key={rule.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedTarget(rule.id)}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                      selectedTarget === rule.id
                        ? 'bg-stone-900 text-white dark:bg-stone-100 dark:text-stone-900'
                        : 'text-stone-600 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-stone-800',
                    )}
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
                </li>
              ))}
            </ul>

            {rules.length === 0 && (!activeCustomPatterns || activeCustomPatterns.length === 0) && (
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

      {/* Book-Specific Custom TOC Rule Sub-modal */}
      {customEditorOpen && (
        <Modal
          title={_('library.tocRuleCustomModalTitle') || '编辑本书专属目录规则'}
          onClose={() => setCustomEditorOpen(false)}
          size="wide"
        >
          <div className="flex flex-col gap-4">
            {/* Copy from template dropdown */}
            {rules.length > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-xl bg-stone-50 px-3.5 py-2.5 dark:bg-stone-800/60">
                <span className="text-xs text-stone-600 dark:text-stone-300">
                  {_('library.tocRuleCopyTemplate') || '从已有规则复制模板…'}
                </span>
                <select
                  defaultValue=""
                  aria-label={_('library.copyFromTemplate') || '从已有规则复制模板'}
                  onChange={(e) => {
                    handleCopyFromTemplate(e.target.value)
                    e.target.value = ''
                  }}
                  className="rounded-lg border border-stone-200 bg-white px-2.5 py-1 text-xs text-stone-700 outline-none transition-colors hover:border-stone-300 focus:border-stone-400 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-200"
                >
                  <option value="" disabled>
                    {_('library.tocRuleCopyTemplate') || '选择模板…'}
                  </option>
                  {rules.map((rule) => (
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
                  {_('settings.tocRulesLevels') || '目录层级配置（按自上而下优先级匹配）'}
                </span>
                <button
                  type="button"
                  onClick={addCustomPattern}
                  aria-label={_('settings.tocRulesAddPattern') || '添加层级'}
                  title={_('settings.tocRulesAddPattern') || '添加层级'}
                  className="inline-flex items-center gap-1 text-xs font-medium text-stone-700 hover:text-stone-900 dark:text-stone-300 dark:hover:text-stone-100"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 5v14M5 12h14" />
                  </svg>
                  <span>{_('settings.tocRulesAddPattern') || '添加层级'}</span>
                </button>
              </div>

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handlePatternDragEnd}>
                <SortableContext items={patternDrafts.map((p) => p.id)} strategy={verticalListSortingStrategy}>
                  <div className="flex flex-col gap-2">
                    {patternDrafts.map((draft, index) => (
                      <TocPatternRow
                        key={draft.id}
                        id={draft.id}
                        level={index + 1}
                        regex={draft.regex}
                        replacement={draft.replacement}
                        enabled={draft.enabled}
                        disabled={false}
                        canRemove={patternDrafts.length > 1}
                        error={patternErrors[index] ?? null}
                        onChange={(patch) => updateCustomPattern(index, patch)}
                        onRemove={() => removeCustomPattern(index)}
                        inputRef={(el) => {
                          patternInputRefs.current[draft.id] = el
                        }}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>

              {patternFormError && (
                <div role="alert" className="rounded-lg bg-red-50 p-2.5 text-xs text-red-600 dark:bg-red-950/40 dark:text-red-400">
                  {patternFormError}
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-3 dark:border-stone-800">
              <Button variant="secondary" onClick={() => setCustomEditorOpen(false)}>
                {_('common.cancel') || '取消'}
              </Button>
              <Button variant="primary" onClick={handleSaveCustomPatterns}>
                {_('library.tocRuleSaveAndApply') || '保存并应用'}
              </Button>
            </div>
          </div>
        </Modal>
      )}
    </>
  )
}
