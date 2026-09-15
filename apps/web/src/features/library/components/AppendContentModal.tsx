import { useEffect, useMemo, useRef, useState } from 'react'

import type { AppendContentPreviewRes } from '@bookdock/shared'

import { Button } from '@/components/ui/Button'
import Modal from '@/components/ui/Modal'
import { useTranslation } from '@/hooks/useTranslation'
import { getUserErrorNotification } from '@/lib/error-message'
import { notify } from '@/lib/notifications'
import { formatBytes } from '@/lib/utils'

import { useAppendBookContent, useAppendBookContentPreview, type AppendContentInput } from '../hooks'

interface AppendContentModalProps {
  bookId: string
  onClose: () => void
}

type InputSource = 'file' | 'text'

interface PreviewCache {
  preview: AppendContentPreviewRes
  selectedStartIndex: number
}

function compactWordCount(count: number): string {
  return count >= 10_000 ? `${(count / 10_000).toFixed(1)}万` : String(count)
}

export default function AppendContentModal({ bookId, onClose }: AppendContentModalProps) {
  const _ = useTranslation()
  const previewMutation = useAppendBookContentPreview()
  const appendMutation = useAppendBookContent()
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const requestIdRef = useRef(0)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const fileCacheRef = useRef<{ file: File; data: PreviewCache } | null>(null)
  const textCacheRef = useRef<{ text: string; data: PreviewCache } | null>(null)
  const [source, setSource] = useState<InputSource>('file')
  const [file, setFile] = useState<File | null>(null)
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<AppendContentPreviewRes | null>(null)
  const [selectedStartIndex, setSelectedStartIndex] = useState(0)
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => () => {
    if (previewTimerRef.current) clearTimeout(previewTimerRef.current)
  }, [])

  function clearScheduledPreview() {
    if (previewTimerRef.current) {
      clearTimeout(previewTimerRef.current)
      previewTimerRef.current = null
    }
    requestIdRef.current += 1
  }

  function schedulePreview(input: Omit<AppendContentInput, 'bookId'> | null, targetSource: InputSource) {
    clearScheduledPreview()
    setPreviewError(null)
    previewMutation.reset()

    if (!input || (!input.file && !input.text?.trim())) {
      setPreview(null)
      setSelectedStartIndex(0)
      setHistoryExpanded(false)
      if (targetSource === 'file') fileCacheRef.current = null
      else textCacheRef.current = null
      return
    }

    if (targetSource === 'file' && input.file && fileCacheRef.current?.file === input.file) {
      setPreview(fileCacheRef.current.data.preview)
      setSelectedStartIndex(fileCacheRef.current.data.selectedStartIndex)
      setHistoryExpanded(false)
      return
    }

    if (targetSource === 'text' && input.text && textCacheRef.current?.text === input.text.trim()) {
      setPreview(textCacheRef.current.data.preview)
      setSelectedStartIndex(textCacheRef.current.data.selectedStartIndex)
      setHistoryExpanded(false)
      return
    }

    const requestId = requestIdRef.current
    previewTimerRef.current = setTimeout(() => {
      previewTimerRef.current = null
      previewMutation.mutate(
        { bookId, ...input },
        {
          onSuccess: (result) => {
            if (requestId !== requestIdRef.current) return
            const nextStartIndex = Math.min(
              Math.max(0, result.data.predictedStartIndex),
              result.data.candidateChapters.length,
            )
            const data: PreviewCache = { preview: result.data, selectedStartIndex: nextStartIndex }
            if (targetSource === 'file' && input.file) {
              fileCacheRef.current = { file: input.file, data }
            } else if (targetSource === 'text' && input.text) {
              textCacheRef.current = { text: input.text.trim(), data }
            }
            setPreview(result.data)
            setSelectedStartIndex(nextStartIndex)
            setHistoryExpanded(false)
          },
          onError: (error) => {
            if (requestId !== requestIdRef.current) return
            setPreviewError(getUserErrorNotification(error, 'errors.loadFailed').key)
          },
        },
      )
    }, 350)
  }

  function inputFor(nextSource = source): Omit<AppendContentInput, 'bookId'> | null {
    if (nextSource === 'file') return file ? { file } : null
    return text.trim() ? { text } : null
  }

  function handleFile(nextFile: File | undefined) {
    if (!nextFile) return
    if (!nextFile.name.toLowerCase().endsWith('.txt')) {
      notify.error({ key: 'errors.unsupportedFormat' })
      return
    }
    setFile(nextFile)
    setSource('file')
    schedulePreview({ file: nextFile }, 'file')
  }

  function handleTextChange(nextText: string) {
    setText(nextText)
    setSource('text')
    if (!nextText.trim()) {
      textCacheRef.current = null
      clearScheduledPreview()
      setPreview(null)
      setSelectedStartIndex(0)
      setHistoryExpanded(false)
      setPreviewError(null)
    } else {
      schedulePreview({ text: nextText }, 'text')
    }
  }

  function clearFile() {
    fileCacheRef.current = null
    setFile(null)
    if (source === 'file') {
      clearScheduledPreview()
      setPreview(null)
      setSelectedStartIndex(0)
      setHistoryExpanded(false)
      setPreviewError(null)
    }
  }

  function changeSource(nextSource: InputSource) {
    setSource(nextSource)
    clearScheduledPreview()
    setPreviewError(null)

    if (nextSource === 'file') {
      if (file && fileCacheRef.current?.file === file) {
        setPreview(fileCacheRef.current.data.preview)
        setSelectedStartIndex(fileCacheRef.current.data.selectedStartIndex)
      } else if (file) {
        schedulePreview({ file }, 'file')
      } else {
        setPreview(null)
        setSelectedStartIndex(0)
      }
    } else {
      const trimmed = text.trim()
      if (trimmed && textCacheRef.current?.text === trimmed) {
        setPreview(textCacheRef.current.data.preview)
        setSelectedStartIndex(textCacheRef.current.data.selectedStartIndex)
      } else if (trimmed) {
        schedulePreview({ text }, 'text')
      } else {
        setPreview(null)
        setSelectedStartIndex(0)
      }
    }
    setHistoryExpanded(false)
  }

  function handleStartChange(nextIndex: number) {
    if (!preview) return
    const boundedIndex = Math.max(0, Math.min(nextIndex, preview.candidateChapters.length))
    setSelectedStartIndex(boundedIndex)
    if (source === 'file' && file && fileCacheRef.current?.file === file) {
      fileCacheRef.current.data.selectedStartIndex = boundedIndex
    } else if (source === 'text' && text.trim() && textCacheRef.current?.text === text.trim()) {
      textCacheRef.current.data.selectedStartIndex = boundedIndex
    }
  }

  const appendStats = useMemo(() => {
    if (!preview) return null
    const candidates = preview.candidateChapters
    const predictedIndex = Math.min(Math.max(0, preview.predictedStartIndex), candidates.length)
    const selectedIndex = Math.min(Math.max(0, selectedStartIndex), candidates.length)
    const defaultAddedWords = candidates.slice(predictedIndex).reduce((sum, chapter) => sum + chapter.wordCount, 0)
    const selectedAddedWords = candidates.slice(selectedIndex).reduce((sum, chapter) => sum + chapter.wordCount, 0)
    const defaultAddedChapters = Math.max(0, preview.addedChapterCount)
    const selectedAddedChapters = Math.max(
      0,
      defaultAddedChapters + (candidates.length - selectedIndex) - (candidates.length - predictedIndex),
    )
    const addedWordCount = Math.max(0, preview.addedWordCount + selectedAddedWords - defaultAddedWords)
    return {
      addedChapterCount: selectedAddedChapters,
      addedWordCount,
      newChapterCount: preview.originalChapterCount + selectedAddedChapters,
      newWordCount: preview.originalWordCount + addedWordCount,
      history: candidates.slice(0, selectedIndex),
      chapters: candidates.slice(selectedIndex),
      selectedIndex,
      selectedStartOffset: candidates[selectedIndex]?.startOffset ?? preview.candidateTextLength,
      appendedToLastChapter: selectedAddedChapters === 0 && addedWordCount > 0,
    }
  }, [preview, selectedStartIndex])

  function handleSave() {
    const input = inputFor()
    if (!input || appendMutation.isPending) return
    clearScheduledPreview()
    const addedCount = appendStats?.addedChapterCount
    const startOffset = appendStats?.selectedStartOffset
    appendMutation.mutate(
      { bookId, ...input, ...(startOffset !== undefined ? { startOffset } : {}) },
      {
        onSuccess: () => {
          notify.success(addedCount != null && addedCount > 0
            ? { key: 'library.appendSuccess', params: { count: addedCount } }
            : { key: 'library.appendSuccessNoChapter' })
          onClose()
        },
        onError: (error) => notify.error(getUserErrorNotification(error, 'errors.operationFailed')),
      },
    )
  }

  const hasInput = Boolean(inputFor())
  const isSaving = appendMutation.isPending

  return (
    <Modal title={_('library.appendContent')} onClose={isSaving ? () => undefined : onClose} size="wide">
      <div className="flex flex-col gap-5">
        <div className="flex rounded-xl bg-stone-100 p-1 dark:bg-stone-800" role="tablist">
          {(['file', 'text'] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={source === tab}
              onClick={() => changeSource(tab)}
              className={`flex-1 rounded-lg px-3 py-2 text-sm transition-colors ${source === tab ? 'bg-white font-medium text-stone-900 shadow-sm dark:bg-stone-700 dark:text-stone-100' : 'text-stone-500 hover:text-stone-800 dark:text-stone-400 dark:hover:text-stone-200'}`}
            >
              {tab === 'file' ? _('library.uploadFile') : _('library.pasteText')}
            </button>
          ))}
        </div>

        <div className={source === 'file' ? 'flex flex-col gap-1.5' : 'hidden'}>
          <div
            className={`flex h-44 flex-col items-center justify-center rounded-2xl p-4 text-center transition-colors ${file
              ? 'border border-stone-200 bg-stone-50 hover:border-stone-400 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
              : 'border border-dashed border-stone-300 bg-stone-50 hover:border-stone-500 dark:border-stone-700 dark:bg-stone-800/50 dark:hover:border-stone-500'
            }`}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault()
              handleFile(event.dataTransfer.files[0])
            }}
          >
            {file ? (
              <div className="flex w-full max-w-xl items-center gap-3 rounded-xl border border-stone-200 bg-white px-4 py-3 text-left shadow-sm dark:border-stone-700 dark:bg-stone-900">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-stone-100 text-xs font-semibold text-stone-600 dark:bg-stone-800 dark:text-stone-300">TXT</div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-stone-800 dark:text-stone-100">{file.name}</p>
                  <p className="mt-0.5 text-xs text-stone-400">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={clearFile}
                  title={_('library.clear')}
                  aria-label={_('library.clear')}
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
                  <span className="font-medium text-stone-700 dark:text-stone-200">{_('library.selectTxtFile')}</span>
                  <span className="mt-0.5 block text-xs text-stone-400">{_('library.appendDropHint')}</span>
                </div>
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,text/plain"
              className="sr-only"
              onChange={(event) => {
                handleFile(event.target.files?.[0])
                event.currentTarget.value = ''
              }}
            />
          </div>
          <div className="h-5" aria-hidden="true" />
        </div>

        <div className={source === 'text' ? 'flex flex-col gap-1.5' : 'hidden'}>
          <textarea
            value={text}
            onChange={(event) => handleTextChange(event.target.value)}
            rows={7}
            aria-label={_('library.pasteText')}
            placeholder={_('library.pasteTextPlaceholder')}
            className="h-44 min-h-[11rem] max-h-[30rem] w-full resize-y rounded-2xl border border-stone-200 bg-white p-3 text-sm leading-relaxed text-stone-800 outline-none transition-colors placeholder:text-stone-400 focus:border-stone-500 dark:border-stone-700 dark:bg-stone-800 dark:text-stone-100"
          />
          <div className="flex h-5 items-center justify-end gap-2.5 px-1 text-xs text-stone-400">
            <span className="tabular-nums">{text.length} {_('library.characters')}</span>
            {text && (
              <button
                type="button"
                title={_('library.clear')}
                aria-label={_('library.clear')}
                className="rounded p-0.5 text-stone-400 transition-colors hover:text-stone-700 dark:hover:text-stone-200"
                onClick={() => handleTextChange('')}
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {hasInput && (
          <section className="rounded-2xl border border-stone-200 bg-stone-50 p-4 dark:border-stone-700 dark:bg-stone-800/50">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-stone-400">{_('library.appendPreview')}</h3>
            {previewMutation.isPending ? (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-stone-400">
                <svg className="h-4 w-4 animate-spin text-stone-400" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 1-9 9" className="opacity-80" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                <span>{_('library.appendPreviewLoading')}</span>
              </div>
            ) : previewError ? (
              <p className="mt-3 text-sm text-red-600 dark:text-red-400">{_(previewError)}</p>
            ) : preview ? (
              <>
                <div className="mt-3 flex items-center justify-between gap-3 text-sm [text-autospace:normal]">
                  <span className="text-stone-600 dark:text-stone-300">
                    {_('library.appendDiffBase', {
                      originalChapters: preview.originalChapterCount,
                      originalWords: compactWordCount(preview.originalWordCount),
                      newChapters: appendStats?.newChapterCount ?? preview.newChapterCount,
                      newWords: compactWordCount(appendStats?.newWordCount ?? preview.newWordCount),
                    })}
                  </span>
                  {appendStats && appendStats.addedChapterCount > 0 ? (
                    <span className="shrink-0 font-semibold text-emerald-600 dark:text-emerald-400">
                      {_('library.appendDiffAdded', {
                        addedChapters: appendStats.addedChapterCount,
                        addedWords: compactWordCount(appendStats.addedWordCount),
                      })}
                    </span>
                  ) : appendStats && appendStats.addedWordCount > 0 ? (
                    <span className="shrink-0 font-medium text-amber-600 dark:text-amber-400">
                      +{compactWordCount(appendStats.addedWordCount)}{_('library.characters') === '字符' ? '字' : ' words'}
                    </span>
                  ) : (
                    <span className="shrink-0 font-medium text-stone-400">{_('library.appendNoNewContent')}</span>
                  )}
                </div>
                {appendStats && appendStats.history.length > 0 && (
                  <button
                    type="button"
                    aria-expanded={historyExpanded}
                    onClick={() => setHistoryExpanded((expanded) => !expanded)}
                    className="mt-3 flex w-full items-center justify-between rounded-xl border border-stone-200 bg-white px-3 py-2 text-left text-xs text-stone-500 transition-colors hover:bg-stone-100 dark:border-stone-700 dark:bg-stone-900 dark:text-stone-400 dark:hover:bg-stone-800"
                  >
                    <span>{_('library.appendSkippedChaptersHint', { count: appendStats.history.length })}</span>
                    <svg className={`h-3.5 w-3.5 transition-transform ${historyExpanded ? 'rotate-180' : ''}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
                      <path d="m6 9 6 6 6-6" />
                    </svg>
                  </button>
                )}
                {appendStats && (historyExpanded ? preview.candidateChapters : appendStats.chapters).length > 0 ? (
                  <div className="mt-3 max-h-48 space-y-0.5 overflow-y-auto pr-2.5 custom-scrollbar">
                    {(historyExpanded ? preview.candidateChapters : appendStats.chapters).map((chapter, index) => {
                      const actualIndex = historyExpanded ? index : appendStats.selectedIndex + index
                      const isHistory = actualIndex < appendStats.selectedIndex
                      const isSelected = actualIndex === appendStats.selectedIndex && actualIndex < preview.candidateChapters.length
                      return (
                        <button
                          key={`${chapter.title}-${chapter.startOffset}`}
                          type="button"
                          onClick={() => handleStartChange(actualIndex)}
                          title={_(isSelected ? 'library.currentStartChapter' : 'library.setAsStartChapter')}
                          className={`group flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors dark:hover:bg-stone-700/40 ${
                            isSelected
                              ? 'bg-emerald-50 text-stone-800 dark:bg-emerald-900/20 dark:text-stone-100'
                              : isHistory
                                ? 'text-stone-500 opacity-40 hover:bg-stone-100 dark:text-stone-400 dark:hover:bg-stone-800/40'
                                : 'text-stone-700 hover:bg-stone-200/50 dark:text-stone-200'
                          }`}
                          style={{ paddingLeft: `${10 + Math.max(0, chapter.level - 1) * 16}px` }}
                        >
                          <span className="flex min-w-0 flex-1 items-center gap-2">
                            <svg
                              className={`h-3.5 w-3.5 shrink-0 transition-opacity ${isSelected ? 'text-emerald-700 dark:text-emerald-300' : 'text-stone-400 opacity-0 group-hover:opacity-100'}`}
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
                            {_('library.tocRuleWords', { count: chapter.wordCount })}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                ) : appendStats?.appendedToLastChapter ? (
                  <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900/60 dark:bg-amber-900/20 dark:text-amber-200">
                    {_('library.appendMergedToLastWarning')}
                  </p>
                ) : null}
              </>
            ) : null}
          </section>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-stone-100 pt-4 dark:border-stone-800">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>{_('library.cancel')}</Button>
          <Button onClick={handleSave} disabled={!hasInput || isSaving}>
            {isSaving ? (
              <>
                <svg className="mr-1.5 h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle cx="12" cy="12" r="9" className="opacity-25" stroke="currentColor" strokeWidth="3" />
                  <path d="M21 12a9 9 0 0 1-9 9" className="opacity-80" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                </svg>
                {_('library.saving')}
              </>
            ) : _('library.confirmAppendAndSave')}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
