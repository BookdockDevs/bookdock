import { useEffect, useMemo, useRef, useState } from 'react'
import {
  normalizeTxtText,
  pickTxtTocRule,
  type TocRulePattern,
  type TocRuleRes,
} from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { formatBytes } from '@/lib/utils'
import { decodeEditorTxtFile } from '../hooks/useEditorContent'
import type { EditorTocRuleSelection, EditorUnit } from '../lib/editor-draft'
import { predictContinuationStartIndex, previewTextChapters } from '../lib/text-tools'

function compactWordCount(count: number): string {
  return count >= 10_000 ? `${(count / 10_000).toFixed(1)}万` : String(count)
}

interface ContentAppendModalProps {
  bookId: string
  initialText?: string
  existingUnits: readonly EditorUnit[]
  rules: TocRuleRes[]
  customPatterns?: TocRulePattern[]
  initialRuleId?: string | null
  unitCount: number
  defaultInsertIndex: number
  onApply: (units: EditorUnit[], insertIndex: number, selection: EditorTocRuleSelection) => void
  onClose: () => void
}

type InputSource = 'file' | 'text'

export default function ContentAppendModal({
  bookId,
  initialText = '',
  existingUnits,
  rules,
  customPatterns,
  initialRuleId,
  unitCount: _unitCount,
  defaultInsertIndex: _defaultInsertIndex,
  onApply,
  onClose,
}: ContentAppendModalProps) {
  const _ = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [source, setSource] = useState<InputSource>(initialText.trim() ? 'text' : 'file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState(initialText)
  const [fileError, setFileError] = useState<string | null>(null)
  const [selectedStartIndex, setSelectedStartIndex] = useState(0)
  const [historyExpanded, setHistoryExpanded] = useState(false)

  // Safe valid rules
  const validRules = useMemo(() => (rules ?? []).filter((r) => Array.isArray(r?.patterns)), [rules])

  // Determine effective TOC patterns to use for splitting added text
  const { effectivePatterns, effectiveSelection } = useMemo(() => {
    if (customPatterns && customPatterns.length > 0) {
      return {
        effectivePatterns: customPatterns,
        effectiveSelection: {
          ruleId: 'custom',
          patterns: customPatterns,
          label: _('library.tocRuleCustom') || '本书专属规则',
          auto: false,
        } satisfies EditorTocRuleSelection,
      }
    }

    if (initialRuleId && initialRuleId !== 'auto' && initialRuleId !== 'none') {
      const found = validRules.find((r) => r.id === initialRuleId)
      if (found) {
        return {
          effectivePatterns: found.patterns,
          effectiveSelection: {
            ruleId: found.id,
            patterns: found.patterns,
            label: found.name,
            auto: false,
          } satisfies EditorTocRuleSelection,
        }
      }
    }

    // Auto detection based on content
    const normalized = normalizeTxtText(text || '')
    const auto = validRules.length > 0 ? pickTxtTocRule(validRules, normalized) : undefined
    let matchedRule = auto ? validRules.find((r) => r.id === auto.id) : undefined
    if (!matchedRule && validRules.length > 0) {
      matchedRule = validRules.find((r) =>
        r.patterns.some((p) => {
          try { return new RegExp(p.regex, 'm').test(normalized) } catch { return false }
        }),
      ) ?? (validRules.length === 1 ? validRules[0] : undefined)
    }

    if (matchedRule && matchedRule.patterns.length > 0) {
      return {
        effectivePatterns: [...matchedRule.patterns] as TocRulePattern[],
        effectiveSelection: {
          ruleId: matchedRule.id,
          patterns: [...matchedRule.patterns] as TocRulePattern[],
          label: matchedRule.name,
          auto: true,
        } satisfies EditorTocRuleSelection,
      }
    }

    return {
      effectivePatterns: [{ level: 1, regex: '^第.+章', replacement: null, enabled: true }] as TocRulePattern[],
      effectiveSelection: {
        ruleId: null,
        patterns: null,
        label: null,
        auto: true,
      } satisfies EditorTocRuleSelection,
    }
  }, [customPatterns, initialRuleId, text, validRules, _])

  // Generate preview units automatically whenever text changes
  const candidateUnits = useMemo(() => {
    const raw = text.trim()
    if (!raw) return []
    return previewTextChapters(raw, effectivePatterns)
  }, [text, effectivePatterns])

  // Predict continuation start index whenever candidates or existing units change
  useEffect(() => {
    if (candidateUnits.length === 0) {
      setSelectedStartIndex(0)
      return
    }
    const predicted = predictContinuationStartIndex(existingUnits, candidateUnits)
    setSelectedStartIndex(Math.min(Math.max(0, predicted), candidateUnits.length))
  }, [candidateUnits, existingUnits])

  async function handleFile(uploaded?: File) {
    if (!uploaded) return
    setFileError(null)
    setFile(uploaded)
    try {
      const res = await decodeEditorTxtFile(bookId, uploaded)
      const decoded = res.data?.text ?? ''
      setText(decoded)
    } catch {
      try {
        const buf = await uploaded.arrayBuffer()
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buf)
        setText(decoded)
      } catch {
        setFileError(_('library.appendDecodeError') || '无法读取文件或识别编码，请检查文件后重试。')
      }
    }
  }

  function clearFile() {
    setFile(null)
    setText('')
    setFileError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  // Calculate stats matching AppendContentModal.tsx
  const appendStats = useMemo(() => {
    if (candidateUnits.length === 0) return null
    const originalChapterCount = existingUnits.length
    const originalWordCount = existingUnits.reduce((acc, u) => acc + u.content.length, 0)
    const candidates = candidateUnits
    const boundedIndex = Math.min(Math.max(0, selectedStartIndex), candidates.length)
    const chaptersToAppend = candidates.slice(boundedIndex)
    const addedWordCount = chaptersToAppend.reduce((acc, u) => acc + u.content.length, 0)

    return {
      originalChapterCount,
      originalWordCount,
      addedChapterCount: chaptersToAppend.length,
      addedWordCount,
      newChapterCount: originalChapterCount + chaptersToAppend.length,
      newWordCount: originalWordCount + addedWordCount,
      history: candidates.slice(0, boundedIndex),
      chapters: chaptersToAppend,
      selectedIndex: boundedIndex,
      appendedToLastChapter: chaptersToAppend.length === 0 && addedWordCount > 0,
    }
  }, [candidateUnits, existingUnits, selectedStartIndex])

  function handleApply() {
    if (candidateUnits.length === 0 || selectedStartIndex >= candidateUnits.length) return
    const unitsToInsert = candidateUnits.slice(selectedStartIndex)
    onApply(unitsToInsert, existingUnits.length, effectiveSelection)
    onClose()
  }

  const hasInput = Boolean(text.trim() || file)

  return (
    <Modal
      title={_('editor.appendContent') || '导入章节'}
      onClose={onClose}
      size="wide"
    >
      <div className="flex flex-col gap-5">
        {/* Source Tab Switch - 100% matching AppendContentModal */}
        <div className="flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" role="tablist">
          {(['file', 'text'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={source === tab}
              onClick={() => {
                setSource(tab)
                setHistoryExpanded(false)
              }}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${
                source === tab
                  ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100'
                  : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'
              }`}
            >
              {tab === 'file' ? (_('library.uploadFile') || '上传文件') : (_('library.pasteText') || '粘贴文本')}
            </button>
          ))}
        </div>

        {/* File Dropzone Tab - 100% matching AppendContentModal */}
        <div className={source === 'file' ? 'flex flex-col' : 'hidden'}>
          <div
            className={`flex h-[12.625rem] flex-col items-center justify-center rounded-2xl p-4 text-center transition-colors ${
              file
                ? 'border border-stone-200 bg-stone-50 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
                : 'border border-dashed border-stone-300 bg-stone-50 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              void handleFile(event.dataTransfer.files[0])
            }}
          >
            {file ? (
              <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm dark:border-stone-700 dark:bg-stone-900">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">
                  TXT
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{file.name}</p>
                  <p className="mt-0.5 text-xs text-stone-400">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  title={_('library.clear') || '清除'}
                  aria-label={_('library.clear') || '清除'}
                  className="shrink-0 rounded-lg p-1.5 text-stone-400 transition-colors hover:bg-stone-200/60 hover:text-stone-700 dark:hover:bg-stone-700 dark:hover:text-stone-200"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex flex-col items-center justify-center gap-2 text-sm text-stone-500 transition-colors hover:text-stone-700 dark:text-stone-400 dark:hover:text-stone-200"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-stone-200/70 text-stone-500 dark:bg-stone-700 dark:text-stone-300">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                </div>
                <div>
                  <span className="font-medium text-stone-700 dark:text-stone-200">
                    {_('library.selectTxtFile') || '选择 TXT 文件'}
                  </span>
                  <span className="mt-0.5 block text-xs text-stone-400">
                    {_('library.appendDropHint') || '支持 UTF-8 及 GB18030 编码文本，或将文件拖曳至此处'}
                  </span>
                </div>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              aria-label={_('library.selectTxtFile') || '选择 TXT 文件'}
              onChange={(event) => {
                void handleFile(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </div>
        </div>

        {/* Text Paste Tab - 100% matching AppendContentModal */}
        <div className={source === 'text' ? 'flex flex-col gap-1.5' : 'hidden'}>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={7}
            aria-label={_('library.pasteText') || '粘贴文本'}
            placeholder={_('editor.pasteTextPlaceholder') || '在此粘贴需要导入的内容…'}
            className="h-44 min-h-[11rem] max-h-[30rem] w-full resize-y rounded-2xl border border-stone-200 bg-white p-3 text-sm leading-relaxed text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          />
          <div className="flex h-5 items-center justify-end gap-2.5 px-1 text-xs text-stone-400">
            <span className="tabular-nums">{text.length} {_('library.characters') || '字符'}</span>
            {text && (
              <button
                type="button"
                title={_('library.clear') || '清除'}
                aria-label={_('library.clear') || '清除'}
                className="rounded p-0.5 text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
                onClick={() => setText('')}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {fileError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{fileError}</p>}

        {/* Preview Section - 100% matching AppendContentModal */}
        {hasInput && appendStats && (
          <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">
              {_('editor.importPreview') || '即时预览'}
            </h3>

            {appendStats && (
              <>
                {/* Stats row with emerald badge */}
                <div className="mt-3 flex items-center justify-between gap-3 text-sm [text-autospace:normal]">
                  <span className="text-stone-600 dark:text-stone-300">
                    {_('library.appendDiffBase', {
                      originalChapters: appendStats.originalChapterCount,
                      originalWords: compactWordCount(appendStats.originalWordCount),
                      newChapters: appendStats.newChapterCount,
                      newWords: compactWordCount(appendStats.newWordCount),
                    }) || `原 ${appendStats.originalChapterCount} 章 (${compactWordCount(appendStats.originalWordCount)}字) → 变更后 ${appendStats.newChapterCount} 章 (${compactWordCount(appendStats.newWordCount)}字)`}
                  </span>
                  {appendStats.addedChapterCount > 0 ? (
                    <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">
                      {_('library.appendDiffAdded', {
                        addedChapters: appendStats.addedChapterCount,
                        addedWords: compactWordCount(appendStats.addedWordCount),
                      }) || `+${appendStats.addedChapterCount} 章 (${compactWordCount(appendStats.addedWordCount)}字)`}
                    </span>
                  ) : appendStats.addedWordCount > 0 ? (
                    <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">
                      +{compactWordCount(appendStats.addedWordCount)}{_('library.characters') === '字符' ? '字' : ' words'}
                    </span>
                  ) : (
                    <span className="shrink-0 font-medium text-stone-400">{_('library.appendNoNewContent') || '无新增章节'}</span>
                  )}
                </div>

                {/* Skipped chapters accordion drawer */}
                {appendStats.history.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={historyExpanded}
                    onClick={() => setHistoryExpanded((expanded) => !expanded)}
                    className="mt-3 flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-xs text-stone-500 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
                  >
                    <span>
                      {_('library.appendSkippedChaptersHint', { count: appendStats.history.length }) || `已跳过前 ${appendStats.history.length} 个重复章节`}
                    </span>
                    <svg className={`h-3.5 w-3.5 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                )}

                {/* Interactive candidate chapters list with green flag indicator */}
                <div
                  role="list"
                  aria-label="分章预览"
                  className="mt-3 max-h-48 space-y-0.5 overflow-y-auto pr-2.5 custom-scrollbar"
                >
                  {(historyExpanded ? candidateUnits : appendStats.chapters).map((chapter, index) => {
                    const actualIndex = historyExpanded ? index : appendStats.selectedIndex + index
                    const isHistory = actualIndex < appendStats.selectedIndex
                    const isSelected = actualIndex === appendStats.selectedIndex && actualIndex < candidateUnits.length
                    return (
                      <button
                        key={`${chapter.title}-${actualIndex}`}
                        type="button"
                        onClick={() => setSelectedStartIndex(actualIndex)}
                        title={_(isSelected ? 'editor.currentStartChapter' : 'editor.setAsStartChapter') || (isSelected ? '当前导入起点' : '设为导入起点')}
                        className={`group flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors dark:hover:bg-stone-700/40 ${
                          isSelected
                            ? 'bg-emerald-50 text-stone-800 dark:bg-emerald-900/20 dark:text-stone-100'
                            : isHistory
                              ? 'text-stone-500 opacity-40 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/40'
                              : 'text-stone-700 hover:bg-stone-200/50 dark:text-stone-200'
                        }`}
                        style={{ paddingLeft: `${10 + Math.max(0, (chapter.level ?? 1) - 1) * 16}px` }}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-2">
                          <svg
                            className={`h-3.5 w-3.5 shrink-0 transition-opacity ${
                              isSelected ? 'text-emerald-700 opacity-100 dark:text-emerald-300' : 'text-stone-400 opacity-0 group-hover:opacity-100'
                            }`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            aria-hidden="true"
                          >
                            <path d="M5 3v18M5 4h11l-2 4 2 4H5" />
                          </svg>
                          <span className="truncate font-normal [text-autospace:normal]">{chapter.title}</span>
                        </span>
                        <span className="shrink-0 text-xs tabular-nums text-stone-400 [text-autospace:normal]">
                          {_('library.tocRuleWords', { count: chapter.content.length }) || `${chapter.content.length} 字`}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </>
            )}
          </section>
        )}

        {/* Footer actions - 100% matching AppendContentModal */}
        <div data-toast-obstacle="" className="flex items-center justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose}>
            {_('library.cancel') || '取消'}
          </Button>
          <Button
            onClick={handleApply}
            disabled={!hasInput || candidateUnits.length === 0 || selectedStartIndex >= candidateUnits.length}
          >
            {_('editor.confirmImportAndSave') || '导入到草稿'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
