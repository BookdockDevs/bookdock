import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import { LibrarySearchError, librarySearchCategoryName, librarySearchFormats, librarySearchStatuses, parseLibrarySearch, printLibrarySearch, quoteLibrarySearch, type LibrarySearchNames } from '@bookdock/shared'

import { ApiError } from '@/api/client'
import { useTranslation } from '@/hooks/useTranslation'

interface LibrarySearchInputProps {
  query: string
  placeholder: string
  names?: LibrarySearchNames
  context?: string
  appliedError?: unknown
  onSubmit: (source: string, signal: AbortSignal) => Promise<unknown>
  onClear?: () => void
}

export default function LibrarySearchInput({ query, placeholder, names, context, appliedError, onSubmit, onClear }: LibrarySearchInputProps) {
  const _ = useTranslation()
  const [draft, setDraft] = useState(query)
  const [error, setError] = useState<{ message: string; start: number; end: number }>()
  const [pending, setPending] = useState(false)
  const [focused, setFocused] = useState(false)
  const [completionDismissed, setCompletionDismissed] = useState(false)
  const [cursor, setCursor] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [composing, setComposing] = useState(false)
  const [showPending, setShowPending] = useState(false)
  const [activeSuggestion, setActiveSuggestion] = useState(-1)
  const listId = useId()
  const list = useRef<HTMLDivElement>(null)
  const insertionCaret = useRef<number | undefined>(undefined)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const callbacks = useRef({ onSubmit, onClear })
  useEffect(() => { callbacks.current = { onSubmit, onClear } }, [onSubmit, onClear])
  const input = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const controller = useRef<AbortController | undefined>(undefined)
  const submittedDisplay = useRef<string | undefined>(undefined)
  const cancel = useCallback(() => { generation.current++; controller.current?.abort(); clearTimeout(timer.current); submittedDisplay.current = undefined }, [])
  useEffect(() => {
    const ownApply = submittedDisplay.current === query
    cancel(); if (!ownApply) setDraft(query)
    setError(undefined); setPending(false); setDirty(false); setCompletionDismissed(true)
  }, [query, names?.shared, cancel])
  useEffect(() => cancel, [cancel])
  useEffect(() => { cancel(); setPending(false); setDirty(false) }, [context, cancel])
  useEffect(() => {
    setShowPending(false)
    if (!pending) return
    const delay = setTimeout(() => setShowPending(true), 200)
    return () => clearTimeout(delay)
  }, [pending])
  useEffect(() => {
    if (!(appliedError instanceof ApiError) || appliedError.code !== 'VALIDATION_ERROR') return
    const issue = appliedError.details as { message?: string; start?: number; end?: number } | undefined
    if (issue?.message) setError({ message: issue.message, start: issue.start ?? 0, end: issue.end ?? query.length })
  }, [appliedError, query])
  const before = draft.slice(0, cursor)
  const match = /(?:^|[\s(&|!])(tag|shelf|category|author|format|status):([^\s&|!()]*)$/.exec(before)
  const field = match?.[1]
  const prefix = (match?.[2] ?? '').replace(/^"|"$/g, '')
  const choices = field === 'tag' ? names?.tags.map((entry) => entry.name) ?? []
    : field === 'shelf' && !names?.shared ? names?.categories.map((entry) => entry.name) ?? []
      : field === 'category' && names?.shared ? names.categories.map((entry) => librarySearchCategoryName(names.categories, entry.id))
        : field === 'author' ? names?.authors ?? []
        : field === 'format' ? librarySearchFormats
          : field === 'status' && !names?.shared ? librarySearchStatuses : []
  const suggestions = choices.includes(prefix) ? [] : [...new Set(choices)].filter((value) => value.includes(prefix)).slice(0, 8)
  const suggestionKey = JSON.stringify(suggestions)
  const completionOpen = focused && !composing && !pending && !completionDismissed && suggestions.length > 0
  useEffect(() => { setActiveSuggestion(-1) }, [suggestionKey])
  useEffect(() => {
    if (completionOpen && activeSuggestion >= 0) list.current?.children[activeSuggestion]?.scrollIntoView?.({ block: 'nearest' })
  }, [completionOpen, activeSuggestion])
  useLayoutEffect(() => {
    if (insertionCaret.current === undefined) return
    input.current?.setSelectionRange(insertionCaret.current, insertionCaret.current)
    insertionCaret.current = undefined
  }, [draft])
  const acceptSuggestion = (value: string) => {
    cancel(); setPending(false); setError(undefined); setDirty(true); setCompletionDismissed(true); setActiveSuggestion(-1)
    const from = cursor - (match?.[2].length ?? 0)
    const replacement = quoteLibrarySearch(value)
    insertionCaret.current = from + replacement.length
    setDraft(draft.slice(0, from) + replacement + draft.slice(cursor)); setCursor(insertionCaret.current)
    input.current?.focus()
  }
  const clear = useCallback(() => {
    cancel(); setDirty(false); setPending(false); setError(undefined); setDraft(''); setCompletionDismissed(true)
    if (callbacks.current.onClear) callbacks.current.onClear()
    else void callbacks.current.onSubmit('', new AbortController().signal)
    input.current?.focus()
  }, [cancel])
  const submit = useCallback(async (explicit = true) => {
    if (pending) return
    clearTimeout(timer.current)
    setDirty(false)
    if (!draft.trim()) { clear(); return }
    if (!explicit) {
      try { parseLibrarySearch(draft) } catch { return }
    }
    if (explicit) setCompletionDismissed(true)
    const current = ++generation.current
    setPending(true)
    setError(undefined)
    controller.current = new AbortController()
    try {
      const parsed = parseLibrarySearch(draft)
      submittedDisplay.current = parsed ? printLibrarySearch(parsed) : ''
      await callbacks.current.onSubmit(draft, controller.current.signal)
    } catch (failure) {
      if (current !== generation.current) return
      if (!explicit && (failure instanceof LibrarySearchError || (failure instanceof ApiError && failure.code === 'VALIDATION_ERROR'))) return
      const details = failure instanceof ApiError ? failure.details as { message?: string; start?: number; end?: number } | undefined : undefined
      setError(failure instanceof LibrarySearchError ? failure : { message: details?.message ?? (failure instanceof Error ? failure.message : '搜索失败'), start: details?.start ?? 0, end: details?.end ?? draft.length })
    } finally { if (current === generation.current) { setPending(false); submittedDisplay.current = undefined } }
  }, [draft, pending, clear])
  useEffect(() => {
    if (!dirty || composing || (completionOpen && activeSuggestion >= 0)) return
    timer.current = setTimeout(() => { void submit(false) }, 300)
    return () => clearTimeout(timer.current)
  }, [dirty, composing, submit, completionOpen, activeSuggestion])
  return <div className="relative min-w-0 flex-1 sm:min-w-48 sm:max-w-72 md:max-w-80">
    <input ref={input} type="text" role="combobox" aria-autocomplete="list" aria-expanded={completionOpen} aria-controls={completionOpen ? listId : undefined} aria-activedescendant={completionOpen && activeSuggestion >= 0 ? `${listId}-${activeSuggestion}` : undefined} aria-label={placeholder} aria-invalid={!!error} aria-describedby={error ? 'library-search-error' : undefined} value={draft}
      onChange={(event) => { cancel(); setPending(false); setError(undefined); setDirty(true); setCompletionDismissed(false); setActiveSuggestion(-1); setDraft(event.target.value); setCursor(event.target.selectionStart ?? event.target.value.length) }}
      onCompositionStart={() => { cancel(); setPending(false); setComposing(true) }} onCompositionEnd={() => { setComposing(false); setDirty(true) }}
      onSelect={(event) => { const next = event.currentTarget.selectionStart ?? draft.length; if (next !== cursor) setActiveSuggestion(-1); setCursor(next) }}
      onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      onKeyDown={(event) => {
        if (composing || event.nativeEvent.isComposing || event.keyCode === 229) return
        if (completionOpen && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
          event.preventDefault()
          setActiveSuggestion((current) => current < 0 ? (event.key === 'ArrowDown' ? 0 : suggestions.length - 1) : (current + (event.key === 'ArrowDown' ? 1 : -1) + suggestions.length) % suggestions.length)
        } else if (completionOpen && (event.key === 'Tab' && !event.shiftKey || event.key === 'Enter' && activeSuggestion >= 0)) {
          event.preventDefault(); acceptSuggestion(suggestions[Math.max(0, activeSuggestion)])
        } else if (event.key === 'Enter') { event.preventDefault(); void submit() }
        else if (event.key === 'Escape') { setCompletionDismissed(true); setActiveSuggestion(-1) }
      }}
      placeholder={placeholder} className={`h-10 w-full rounded-xl border border-stone-200 bg-white pl-3 ${draft || query ? 'pr-16' : 'pr-9'} text-sm text-stone-700 outline-none focus:border-stone-400 dark:border-stone-800 dark:bg-stone-900 dark:text-stone-200`} />
    {(draft || query) && <button type="button" aria-label={_('library.searchClear')} title={_('library.searchClear')} onClick={clear} className="absolute right-9 top-1 flex h-8 w-7 items-center justify-center rounded-lg text-stone-400 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200"><svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>}
    <button type="button" aria-label={_('library.searchSubmit')} title={_('library.searchSubmit')} disabled={pending} onClick={() => void submit()} className="absolute right-1 top-1 flex h-8 w-8 items-center justify-center rounded-lg text-stone-500 hover:bg-stone-100 hover:text-stone-700 focus-visible:outline-2 focus-visible:outline-stone-400 disabled:cursor-wait dark:text-stone-400 dark:hover:bg-stone-800 dark:hover:text-stone-200">
      {showPending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-stone-200 border-t-stone-500 motion-reduce:animate-none dark:border-stone-700 dark:border-t-stone-400" role="status" aria-label={_('library.searchValidating')} />
        : <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>}
    </button>
    {error && <p id="library-search-error" role="alert" className="mt-1 text-xs text-red-600 dark:text-red-400">{error.message} · {_('library.searchNotApplied')}<button type="button" title={_('library.searchErrorPosition', { start: error.start + 1, end: Math.max(error.start + 1, error.end) })} onClick={() => { input.current?.focus(); input.current?.setSelectionRange(error.start, error.end) }} className="ml-2 underline">{_('library.searchLocateError')}</button></p>}
    {completionOpen && <div ref={list} id={listId} role="listbox" className="absolute top-11 z-30 max-h-64 w-full overflow-auto rounded-xl border border-stone-200 bg-white p-1 shadow-lg dark:border-stone-700 dark:bg-stone-900" aria-label={_('library.searchCompletion')}>
      {suggestions.map((value, index) => <button key={value} id={`${listId}-${index}`} type="button" role="option" aria-selected={activeSuggestion === index} tabIndex={-1} onMouseMove={() => setActiveSuggestion(index)} onMouseDown={(event) => event.preventDefault()} onClick={() => acceptSuggestion(value)} className={`block w-full truncate rounded-lg px-3 py-2 ${activeSuggestion === index ? 'bg-stone-100 dark:bg-stone-800' : ''} text-left text-sm text-stone-700 dark:text-stone-200`}>{value}</button>)}
    </div>}
  </div>
}
